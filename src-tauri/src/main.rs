// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod update;

use std::{
    ffi::OsString,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    time::{Duration, UNIX_EPOCH},
};

use tauri::{
    AppHandle, Emitter, Listener, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder,
};

/// State shared between the server watcher and the app lifecycle.
/// All fields sit behind `Arc` so a clone of the struct is a cheap, owned,
/// `'static` handle that can be moved into background threads.
#[derive(Clone)]
struct ServerState {
    /// The `dsh web` child process (node.exe running the bundled CLI).
    child: Arc<Mutex<Option<Child>>>,
    /// True once the WebView successfully navigated to the running server.
    ready: Arc<AtomicBool>,
    /// True when the app is deliberately shutting down (suppresses the died dialog).
    exiting: Arc<AtomicBool>,
    /// True until the server child is stored (or boot gives up). Distinguishes
    /// "not spawned yet" from "exit path took the child".
    starting: Arc<AtomicBool>,
}

/// Emitted by the watcher thread when the server process exits on its own.
const SERVER_DIED_EVENT: &str = "dsh-server-died";
/// Emitted by the boot thread when the server fails to become ready.
const SERVER_START_FAILED_EVENT: &str = "dsh-server-start-failed";

/// Init script injected into every page: routes `target="_blank"` anchors and
/// `window.open` through the `dsh-ext://` scheme so the Rust side can open
/// them in the system browser instead of a new WebView window.
/// Frameless chrome (drag region + window controls) injected into splash
/// and the official Web UI. Lives beside this file so the Rust source stays
/// the window lifecycle, not the HTML/CSS.
const DESKTOP_CHROME_SCRIPT: &str = include_str!("desktop-chrome.js");

fn desktop_bridge_script() -> String {
    let version = format!("{:?}", env!("CARGO_PKG_VERSION"));
    format!(
        "(function () {{\n\
  if (window.__DSH_DESKTOP__) return;\n\
  var version = {version};\n\
  window.__DSH_DESKTOP_VERSION__ = version;\n\
  window.__DSH_DESKTOP__ = {{\n\
    version: version,\n\
    checkUpdate: function () {{\n\
      return window.__TAURI__.core.invoke('dsh_check_update');\n\
    }},\n\
    installUpdate: function () {{\n\
      return window.__TAURI__.core.invoke('dsh_install_update');\n\
    }}\n\
  }};\n\
}})();\n"
    )
}

const INIT_SCRIPT: &str = r#"
(function () {
  if (window.__dshExtInit) return;
  window.__dshExtInit = true;
  var openExternal = function (raw) {
    try {
      var u = new URL(raw, window.location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        window.location.href = 'dsh-ext://open/' + encodeURIComponent(u.href);
      }
    } catch (e) {}
  };
  document.addEventListener('click', function (event) {
    var el = event.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (el && el.target === '_blank' && el.href) {
      event.preventDefault();
      event.stopPropagation();
      openExternal(el.href);
    }
  }, true);
  window.open = function (url) {
    openExternal(String(url));
    return null;
  };
})();
"#;

const RUNTIME_DIR_NAME: &str = "bundle-runtime";
const RUNTIME_ZIP_NAME: &str = "bundle-runtime.zip";
const RUNTIME_STAMP_NAME: &str = ".dsh-desktop-runtime-stamp";
const DSH_BIN_REL: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
/// Completeness probe: `commander` is a direct dependency of `@deepseek-ai/dsh`.
/// A truncated installer extract omits it while still leaving `bin.js` in place.
const COMMANDER_REL: &str = "node_modules/@deepseek-ai/dsh/node_modules/commander/package.json";

/// Tauri's `resource_dir()` returns `\\?\`-prefixed verbatim paths on
/// Windows; child processes (node, tar) reject those.
fn normalize_path(path: &Path) -> PathBuf {
    PathBuf::from(dunce::simplified(path).to_string_lossy().replace('/', "\\"))
}

fn resource_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(normalize_path(&dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(normalize_path(dir));
        }
    }
    roots.push(normalize_path(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."),
    ));
    roots
}

fn runtime_complete(root: &Path) -> bool {
    root.join("node.exe").is_file()
        && root.join(DSH_BIN_REL).is_file()
        && root.join(COMMANDER_REL).is_file()
}

fn zip_stamp(zip: &Path) -> String {
    match std::fs::metadata(zip) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            format!("{}:{modified}", meta.len())
        }
        Err(_) => String::new(),
    }
}

fn find_zip(app: &AppHandle) -> Option<PathBuf> {
    // Only packaged locations — not the build-machine source tree baked into
    // `CARGO_MANIFEST_DIR`, which would point at the developer's clone.
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(normalize_path(&dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(normalize_path(dir));
        }
    }
    roots.into_iter().find_map(|root| {
        let zip = root.join(RUNTIME_ZIP_NAME);
        zip.is_file().then(|| normalize_path(&zip))
    })
}

fn parent_is_writable(dir: &Path) -> bool {
    let Some(parent) = dir.parent() else {
        return false;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return false;
    }
    let probe = parent.join(".dsh-desktop-write-probe");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

fn staging_path(dest: &Path) -> PathBuf {
    dest.with_file_name(format!(
        "{}.extracting",
        dest.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(RUNTIME_DIR_NAME)
    ))
}

fn tar_program() -> PathBuf {
    #[cfg(windows)]
    {
        let system_root =
            std::env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
        let system32 = PathBuf::from(system_root).join("System32").join("tar.exe");
        if system32.is_file() {
            return system32;
        }
    }
    PathBuf::from("tar")
}

fn format_tar_error(status: ExitStatus, stderr: &str) -> String {
    let header = format!("tar failed to unpack the DeepSeek Harness runtime ({status})");
    let stderr = stderr.trim();
    if stderr.is_empty() {
        header
    } else {
        format!("{header}\n{stderr}")
    }
}

/// Stop a leftover `dest\node.exe` so the unpacked tree can replace it.
///
/// A crashed or uninstalled desktop instance can leave the bundled server
/// running. Windows tar then fails with `Can't unlink already-existing object:
/// Permission denied` on `./node.exe` (the first zip member) and never writes
/// the stamp, even if the rest of the tree extracted.
fn stop_runtime_node(dest: &Path) {
    let node = normalize_path(&dest.join("node.exe"));
    if !node.is_file() {
        return;
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let path = node.to_string_lossy().into_owned();
        let mut command = Command::new("powershell.exe");
        command.creation_flags(0x0800_0000);
        let _ = command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:DSH_RUNTIME_NODE } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
            ])
            .env("DSH_RUNTIME_NODE", path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        std::thread::sleep(Duration::from_millis(400));
    }
}

fn remove_dir_retry(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let mut last = None;
    for _ in 0..8 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(_) if !path.exists() => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
    Err(format!(
        "failed to replace the runtime directory: {}",
        last.map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".into())
    ))
}

/// Unpack `bundle-runtime.zip` into a fresh sibling directory, then replace
/// `dest`. Extracting onto a dirty tree fails when leftover `node.exe` is
/// still running; a staging directory keeps tar off that lock.
fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    let staging = staging_path(dest);
    if staging.exists() {
        remove_dir_retry(&staging)?;
    }
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("failed to create the runtime directory: {e}"))?;

    let mut command = Command::new(tar_program());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let zip_arg = zip.to_string_lossy();
    let staging_arg = staging.to_string_lossy();
    let output = command
        .args(["-xf", zip_arg.as_ref(), "-C", staging_arg.as_ref()])
        .output()
        .map_err(|e| format!("failed to start tar to unpack the runtime: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&staging);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format_tar_error(output.status, &stderr));
    }

    stop_runtime_node(dest);
    remove_dir_retry(dest)?;
    std::fs::rename(&staging, dest)
        .map_err(|e| format!("failed to replace the runtime directory: {e}"))?;
    Ok(())
}

/// Resolve `node.exe` and `dsh/lib/bin.js`.
///
/// Production ships one `bundle-runtime.zip` (NSIS cannot reliably extract
/// the ~33k-file unpacked tree). The zip is unpacked next to itself on first
/// launch, or into the app local data directory when the resource dir is not
/// writable. `tauri dev` has no zip and uses the unpacked `bundle-runtime/`.
fn ensure_runtime(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    if let Some(zip) = find_zip(app) {
        let alongside = zip
            .parent()
            .ok_or_else(|| "bundle-runtime.zip has no parent directory".to_string())?
            .join(RUNTIME_DIR_NAME);
        let dest = if parent_is_writable(&alongside) {
            alongside
        } else {
            let local = app
                .path()
                .app_local_data_dir()
                .map_err(|e| format!("failed to resolve the app data directory: {e}"))?;
            normalize_path(&local).join(RUNTIME_DIR_NAME)
        };
        let stamp_path = dest.join(RUNTIME_STAMP_NAME);
        let expected = zip_stamp(&zip);
        let current = std::fs::read_to_string(&stamp_path).unwrap_or_default();
        if current.trim() != expected || !runtime_complete(&dest) {
            extract_zip(&zip, &dest)?;
            std::fs::write(&stamp_path, &expected)
                .map_err(|e| format!("failed to write the runtime stamp: {e}"))?;
            if !runtime_complete(&dest) {
                return Err(
                    "the unpacked runtime is missing node.exe, the dsh CLI, or commander"
                        .to_string(),
                );
            }
        }
        return Ok((
            normalize_path(&dest.join("node.exe")),
            normalize_path(&dest.join(DSH_BIN_REL)),
        ));
    }

    for root in resource_roots(app) {
        let runtime = root.join(RUNTIME_DIR_NAME);
        if runtime_complete(&runtime) {
            return Ok((
                normalize_path(&runtime.join("node.exe")),
                normalize_path(&runtime.join(DSH_BIN_REL)),
            ));
        }
    }
    Err("bundled runtime not found (no complete bundle-runtime/ and no bundle-runtime.zip)".into())
}

/// Parse the readiness line `dsh web: http://127.0.0.1:PORT ...`.
fn port_of_readiness_line(line: &str) -> Option<u16> {
    let rest = line.strip_prefix("dsh web: http://127.0.0.1:")?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// Spawn `node <dsh>/lib/bin.js web --host 127.0.0.1 --port 0` and watch its
/// stdout for the readiness line carrying the real bound port.
///
/// `CREATE_NO_WINDOW` gives the console-subsystem node process a hidden
/// console instead of letting a visible one be created — without it, the
/// harness boot flashes a blank terminal window on Windows 11.
fn spawn_server(node: &Path, bin: &Path) -> Result<(Child, Receiver<Result<u16, String>>), String> {
    let workdir = node
        .parent()
        .ok_or_else(|| "node.exe has no parent directory".to_string())?;
    let mut command = Command::new(node);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: run node with a hidden console so neither it nor
        // console tools it spawns ever allocates a visible console window.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .arg(bin)
        .args(["web", "--host", "127.0.0.1", "--port", "0"])
        .current_dir(workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start the DeepSeek Harness server (node): {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "server stdout is not piped".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "server stderr is not piped".to_string())?;

    // Drain stderr continuously so a chatty server can never block on a full pipe.
    let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    {
        let sink = Arc::clone(&stderr_lines);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut buf) = sink.lock() {
                    buf.push(line);
                }
            }
        });
    }

    let (tx, rx) = mpsc::channel::<Result<u16, String>>();
    std::thread::spawn(move || {
        let mut reported = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !reported {
                if let Some(port) = port_of_readiness_line(&line) {
                    reported = true;
                    if tx.send(Ok(port)).is_err() {
                        return;
                    }
                }
            }
        }
        if !reported {
            let tail = stderr_lines
                .lock()
                .map(|buf| buf.iter().rev().take(20).cloned().collect::<Vec<_>>())
                .unwrap_or_default()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            let message = if tail.trim().is_empty() {
                "the server exited without reporting a port".to_string()
            } else {
                tail
            };
            let _ = tx.send(Err(message));
        }
    });

    Ok((child, rx))
}

/// Wait for the server's readiness report.
fn wait_for_port(rx: Receiver<Result<u16, String>>, timeout: Duration) -> Result<u16, String> {
    match rx.recv_timeout(timeout) {
        Ok(Ok(port)) => Ok(port),
        Ok(Err(message)) => Err(format!(
            "the DeepSeek Harness server failed to start:\n{message}"
        )),
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err("timed out waiting for the DeepSeek Harness server to become ready".to_string())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("the server process ended before reporting readiness".to_string())
        }
    }
}

/// Terminate the server child process (Windows: TerminateProcess; the harness
/// has no HTTP shutdown route).
fn stop_server(state: &ServerState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Open a URL in the system default browser.
fn open_in_browser(target: &str) {
    if let Ok(decoded) = urlencoding::decode(target) {
        let _ = tauri_plugin_opener::open_url(decoded.into_owned(), None::<&str>);
    }
}

/// Decide whether a top-level navigation is allowed inside the app WebView.
/// The app server (127.0.0.1) and the embedded splash/error pages
/// (tauri.localhost) stay in-app; everything else opens in the system browser.
fn allow_navigation(_app: &AppHandle, url: &Url) -> bool {
    match url.scheme() {
        "dsh-ext" => {
            if let Some(target) = url.path().strip_prefix("/open/") {
                open_in_browser(target);
            }
            false
        }
        "http" | "https" => {
            let host = url.host_str().unwrap_or("");
            if host == "127.0.0.1" || host == "tauri.localhost" {
                true
            } else {
                open_in_browser(url.as_str());
                false
            }
        }
        _ => true,
    }
}

/// Show a blocking error dialog (must run on the main thread).
fn show_error(app: &AppHandle, title: &str, message: &str) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    let _ = app
        .dialog()
        .message(message.to_string())
        .title(title.to_string())
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch: focus the existing window instead of starting over.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            update::dsh_check_update,
            update::dsh_install_update,
        ])
        .register_uri_scheme_protocol("dsh-ext", |_ctx, _request| {
            tauri::http::Response::builder()
                .status(204)
                .body(Vec::new())
                .unwrap()
        })
        .setup(|app| {
            app.manage(ServerState {
                child: Arc::new(Mutex::new(None)),
                ready: Arc::new(AtomicBool::new(false)),
                exiting: Arc::new(AtomicBool::new(false)),
                starting: Arc::new(AtomicBool::new(true)),
            });

            // React to server failures reported from background threads.
            {
                let handle = app.handle().clone();
                app.listen(SERVER_START_FAILED_EVENT, move |event| {
                    let message = event.payload().to_string();
                    let message = serde_json::from_str::<String>(&message).unwrap_or(message);
                    show_error(&handle, "DeepSeek Harness", &message);
                    handle.exit(1);
                });
            }
            {
                let handle = app.handle().clone();
                app.listen(SERVER_DIED_EVENT, move |_event| {
                    if let Some(state) = handle.try_state::<ServerState>() {
                        if state.exiting.load(Ordering::SeqCst) {
                            return;
                        }
                        state.exiting.store(true, Ordering::SeqCst);
                    }
                    show_error(
                        &handle,
                        "DeepSeek Harness",
                        "The DeepSeek Harness server stopped unexpectedly. The app will close.",
                    );
                    handle.exit(1);
                });
            }

            // Watch the server process: report it if it dies on its own.
            // The child stays inside the mutex so the exit path can always
            // kill it; death is detected by polling try_wait.
            {
                let state = ServerState::clone(app.state::<ServerState>().inner());
                let handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    let status = {
                        let mut guard = match state.child.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        match guard.as_mut() {
                            Some(child) => match child.try_wait() {
                                Ok(Some(status)) => Some(status),
                                Ok(None) => None,
                                Err(_) => return,
                            },
                            None => {
                                if state.exiting.load(Ordering::SeqCst)
                                    || !state.starting.load(Ordering::SeqCst)
                                {
                                    return;
                                }
                                None
                            }
                        }
                    };
                    if status.is_some() {
                        if state.ready.load(Ordering::SeqCst) {
                            let _ = handle.emit(SERVER_DIED_EVENT, ());
                        }
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(800));
                });
            }

            // Splash window while the server boots.
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("DeepSeek Harness")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(900.0, 560.0)
                    .center()
                    .decorations(false)
                    .shadow(true)
                    .initialization_script(INIT_SCRIPT)
                    .initialization_script(DESKTOP_CHROME_SCRIPT)
                    .initialization_script(desktop_bridge_script())
                    .on_navigation({
                        let handle = app.handle().clone();
                        move |url| allow_navigation(&handle, url)
                    })
                    .build()
                    .map_err(|e| e.to_string())?;

            // Unpack the runtime if needed, start the server, navigate to it.
            {
                let window = window.clone();
                let state = ServerState::clone(app.state::<ServerState>().inner());
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let boot = (|| {
                        if state.exiting.load(Ordering::SeqCst) {
                            return Err("the app is closing".to_string());
                        }
                        let (node, bin) = ensure_runtime(&handle)?;
                        if state.exiting.load(Ordering::SeqCst) {
                            return Err("the app is closing".to_string());
                        }
                        let (child, rx) = spawn_server(&node, &bin)?;
                        {
                            let mut guard = state
                                .child
                                .lock()
                                .map_err(|_| "server state lock was poisoned".to_string())?;
                            if state.exiting.load(Ordering::SeqCst) {
                                let mut child = child;
                                let _ = child.kill();
                                let _ = child.wait();
                                return Err("the app is closing".to_string());
                            }
                            *guard = Some(child);
                        }
                        wait_for_port(rx, Duration::from_secs(120))
                    })();
                    state.starting.store(false, Ordering::SeqCst);
                    match boot {
                        Ok(port) => {
                            let target = format!("http://127.0.0.1:{port}/");
                            match Url::parse(&target) {
                                Ok(url) => {
                                    if window.navigate(url).is_err() {
                                        let _ = window
                                            .eval(&format!("window.location.replace({target:?});"));
                                    }
                                    state.ready.store(true, Ordering::SeqCst);
                                }
                                Err(e) => {
                                    let message = format!("invalid server URL {target:?}: {e}");
                                    let _ = handle.emit(SERVER_START_FAILED_EVENT, message);
                                }
                            }
                        }
                        Err(message) => {
                            if !state.exiting.load(Ordering::SeqCst) {
                                let _ = handle.emit(SERVER_START_FAILED_EVENT, message);
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the DeepSeek Harness desktop app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<ServerState>() {
                    state.exiting.store(true, Ordering::SeqCst);
                    stop_server(&state);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "dsh-desktop-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_runtime_tree(root: &Path, node_contents: &[u8]) {
        std::fs::create_dir_all(root.join("node_modules/@deepseek-ai/dsh/lib")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/@deepseek-ai/dsh/node_modules/commander"))
            .unwrap();
        std::fs::write(root.join("node.exe"), node_contents).unwrap();
        std::fs::write(root.join(DSH_BIN_REL), b"bin").unwrap();
        std::fs::write(root.join(COMMANDER_REL), b"{}").unwrap();
    }

    fn pack_zip(src: &Path, zip: &Path) {
        let status = Command::new(tar_program())
            .args(["-a", "-cf"])
            .arg(zip)
            .arg("-C")
            .arg(src)
            .arg(".")
            .status()
            .unwrap();
        assert!(status.success(), "failed to pack test zip");
    }

    #[test]
    fn staging_path_uses_extracting_suffix() {
        let dest = PathBuf::from(r"C:\Users\admin\AppData\Local\DeepSeek Harness\bundle-runtime");
        assert_eq!(
            staging_path(&dest),
            PathBuf::from(
                r"C:\Users\admin\AppData\Local\DeepSeek Harness\bundle-runtime.extracting"
            )
        );
    }

    #[test]
    fn tar_error_includes_stderr_from_locked_unlink() {
        let status = Command::new("cmd")
            .args(["/c", "exit", "1"])
            .status()
            .unwrap();
        let msg = format_tar_error(
            status,
            "./node.exe: Can't unlink already-existing object: Permission denied\n",
        );
        assert!(msg.contains("exit code: 1"));
        assert!(msg.contains("Can't unlink already-existing object: Permission denied"));
    }

    #[test]
    fn extract_zip_replaces_a_dirty_dest() {
        let tmp = unique_temp("extract-dirty");
        let src = tmp.join("src");
        let dest = tmp.join("bundle-runtime");
        write_runtime_tree(&src, b"new-node");
        write_runtime_tree(&dest, b"old-node");
        let zip = tmp.join("bundle-runtime.zip");
        pack_zip(&src, &zip);
        extract_zip(&zip, &dest).unwrap();
        assert_eq!(std::fs::read(dest.join("node.exe")).unwrap(), b"new-node");
        assert!(runtime_complete(&dest));
        assert!(!staging_path(&dest).exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(windows)]
    #[test]
    fn extract_zip_replaces_dest_with_locked_node_exe() {
        use std::os::windows::process::CommandExt;

        let tmp = unique_temp("extract-locked");
        let src = tmp.join("src");
        let dest = tmp.join("bundle-runtime");
        write_runtime_tree(&src, b"new-node");
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::copy(r"C:\Windows\System32\cmd.exe", dest.join("node.exe")).unwrap();
        let mut locker = Command::new(dest.join("node.exe"));
        locker.creation_flags(0x0800_0000);
        let child = locker
            .args(["/c", "ping", "-n", "40", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let zip = tmp.join("bundle-runtime.zip");
        pack_zip(&src, &zip);
        let pid = child.id();
        let result = extract_zip(&zip, &dest);
        if result.is_err() {
            let _ = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        result.unwrap();
        assert_eq!(std::fs::read(dest.join("node.exe")).unwrap(), b"new-node");
        assert!(runtime_complete(&dest));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

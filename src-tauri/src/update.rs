//! Desktop update channel: fetch `latest.json`, compare semver, download and launch NSIS.

use std::{
    collections::BTreeMap,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const CHANNEL_CONFIG: &str = include_str!("../update-channel.json");
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const WINDOWS_X64: &str = "windows-x64";
const MANIFEST_ENV: &str = "DSH_DESKTOP_UPDATE_MANIFEST";
const PROGRESS_EVENT: &str = "dsh-update-progress";

static LAST_PLAN: Mutex<Option<InstallPlan>> = Mutex::new(None);
static IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelConfig {
    manifest_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelDocument {
    schema_version: u32,
    #[allow(dead_code)]
    channel: String,
    latest: String,
    releases: Vec<Release>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    version: String,
    notes: Notes,
    #[serde(default)]
    artifacts: BTreeMap<String, Artifact>,
}

/// Bilingual installer notes from the channel index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notes {
    /// Simplified Chinese notes.
    pub zh: String,
    /// English notes.
    pub en: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Artifact {
    kind: ArtifactKind,
    filename: String,
    url: String,
    sha256: String,
    size: u64,
}

/// Installer kind recorded on a channel artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactKind {
    /// Full NSIS setup.exe (the implemented install path).
    Nsis,
    /// Reserved zip that would replace `bundle-runtime.zip` only.
    RuntimeZip,
}

/// Result returned to `window.__DSH_DESKTOP__.checkUpdate()`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CheckResult {
    /// Installed semver is already `latest`.
    Current { current: String },
    /// A newer artifact is published.
    Available {
        current: String,
        latest: String,
        notes: Notes,
        size: u64,
        kind: ArtifactKind,
    },
    /// The channel cannot be used (missing URL, bad JSON, missing artifact).
    Unavailable { current: String, reason: String },
}

#[derive(Debug, Clone)]
struct InstallPlan {
    kind: ArtifactKind,
    filename: String,
    url: String,
    sha256: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

/// Fetch the channel index and compare it with this shell's semver.
/// @returns `current`, `available`, or `unavailable`.
#[tauri::command]
pub async fn dsh_check_update(app: AppHandle) -> Result<CheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || check_blocking(&app))
        .await
        .map_err(|e| format!("update check worker failed: {e}"))?
}

/// Download the last available NSIS artifact, verify SHA-256, launch it silently into the current install directory, then exit.
/// @returns `Ok(())` immediately before the process exits; rejects if no plan, hash mismatch, or a second install is running.
#[tauri::command]
pub async fn dsh_install_update(app: AppHandle) -> Result<(), String> {
    if IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return Err("an update is already in progress".into());
    }
    let outcome = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || install_blocking(&app)
    })
    .await
    .map_err(|e| format!("update install worker failed: {e}"));
    match outcome {
        Ok(Ok(())) => {
            app.exit(0);
            Ok(())
        }
        Ok(Err(error)) => {
            IN_FLIGHT.store(false, Ordering::SeqCst);
            Err(error)
        }
        Err(error) => {
            IN_FLIGHT.store(false, Ordering::SeqCst);
            Err(error)
        }
    }
}

fn check_blocking(app: &AppHandle) -> Result<CheckResult, String> {
    match load_plan(app) {
        Ok((result, plan)) => {
            *LAST_PLAN
                .lock()
                .map_err(|_| "update state lock was poisoned".to_string())? = plan;
            Ok(result)
        }
        Err(reason) => Ok(CheckResult::Unavailable {
            current: CURRENT.to_string(),
            reason,
        }),
    }
}

fn install_blocking(app: &AppHandle) -> Result<(), String> {
    let plan = {
        let guard = LAST_PLAN
            .lock()
            .map_err(|_| "update state lock was poisoned".to_string())?;
        guard.clone()
    };
    let plan = match plan {
        Some(plan) => plan,
        None => {
            let (_, plan) = load_plan(app)?;
            plan.ok_or_else(|| "no newer installer is available".to_string())?
        }
    };
    if plan.kind != ArtifactKind::Nsis {
        return Err(
            "this release is not an NSIS installer; runtime-zip install is not implemented".into(),
        );
    }
    let filename = safe_filename(&plan.filename)?.to_string();
    let dest_dir = std::env::temp_dir().join("dsh-desktop-update");
    std::fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("failed to create the download directory: {e}"))?;
    let dest = dest_dir.join(&filename);
    download_verified(app, &plan.url, &plan.sha256, &dest)?;
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .ok_or_else(|| "cannot resolve the current install directory".to_string())?;
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "launch",
            received: 0,
            total: None,
        },
    );
    launch_nsis(&dest, &install_dir)
}

fn load_plan(app: &AppHandle) -> Result<(CheckResult, Option<InstallPlan>), String> {
    let source = manifest_source(app)?;
    let text = read_text(&source)?;
    evaluate(CURRENT, &text)
}

fn configured_manifest_url() -> String {
    serde_json::from_str::<ChannelConfig>(CHANNEL_CONFIG)
        .map(|config| config.manifest_url)
        .unwrap_or_default()
}

fn manifest_source(app: &AppHandle) -> Result<String, String> {
    let env_override = std::env::var(MANIFEST_ENV).ok();
    let exe_dir = std::env::current_exe().ok().and_then(|exe| {
        exe.parent()
            .map(|dir| PathBuf::from(dir.to_string_lossy().as_ref()))
    });
    let debug_releases = if cfg!(debug_assertions) {
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("releases"),
        )
    } else {
        None
    };
    let resource_dir = app.path().resource_dir().ok();
    resolve_manifest_source(
        exe_dir.as_deref(),
        resource_dir.as_deref(),
        debug_releases.as_deref(),
        env_override.as_deref(),
        &configured_manifest_url(),
    )
}

/// Pick the channel index URL or path.
fn resolve_manifest_source(
    exe_dir: Option<&Path>,
    resource_dir: Option<&Path>,
    debug_releases_dir: Option<&Path>,
    env_override: Option<&str>,
    configured_url: &str,
) -> Result<String, String> {
    if let Some(value) = env_override.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(value.to_string());
    }
    if !configured_url.trim().is_empty() {
        return Ok(configured_url.trim().to_string());
    }
    for dir in [exe_dir, resource_dir, debug_releases_dir]
        .into_iter()
        .flatten()
    {
        let candidate = dir.join("latest.json");
        if candidate.is_file() {
            return Ok(candidate.to_string_lossy().into_owned());
        }
    }
    Err("the update channel is not configured (set DSH_DESKTOP_UPDATE_MANIFEST or ship latest.json next to the app)".into())
}

/// Compare `current` with a channel index document.
fn evaluate(current: &str, json: &str) -> Result<(CheckResult, Option<InstallPlan>), String> {
    let current_semver = parse_semver(current)?;
    let document: ChannelDocument = serde_json::from_str(json)
        .map_err(|e| format!("update manifest is not valid JSON: {e}"))?;
    if document.schema_version != 1 {
        return Err(format!(
            "unsupported update schemaVersion {}",
            document.schema_version
        ));
    }
    let latest_semver = parse_semver(&document.latest)?;
    if current_semver >= latest_semver {
        return Ok((
            CheckResult::Current {
                current: current.to_string(),
            },
            None,
        ));
    }
    let release = document
        .releases
        .iter()
        .find(|entry| entry.version == document.latest)
        .ok_or_else(|| {
            format!(
                "latest version {} is missing from releases",
                document.latest
            )
        })?;
    let artifact = release
        .artifacts
        .get(WINDOWS_X64)
        .ok_or_else(|| format!("release {} has no {WINDOWS_X64} artifact", document.latest))?;
    if artifact.url.trim().is_empty() || artifact.sha256.trim().is_empty() {
        return Err(format!(
            "release {} is missing url or sha256",
            document.latest
        ));
    }
    safe_filename(&artifact.filename)?;
    let plan = InstallPlan {
        kind: artifact.kind,
        filename: artifact.filename.clone(),
        url: artifact.url.clone(),
        sha256: artifact.sha256.trim().to_ascii_lowercase(),
    };
    Ok((
        CheckResult::Available {
            current: current.to_string(),
            latest: document.latest.clone(),
            notes: release.notes.clone(),
            size: artifact.size,
            kind: artifact.kind,
        },
        Some(plan),
    ))
}

/// Parse `major.minor.patch` with no pre-release suffix.
fn parse_semver(text: &str) -> Result<(u64, u64, u64), String> {
    let text = text.trim();
    let mut parts = text.split('.');
    let major = parse_part(parts.next(), text)?;
    let minor = parse_part(parts.next(), text)?;
    let patch = parse_part(parts.next(), text)?;
    if parts.next().is_some() {
        return Err(format!("unsupported version {text}"));
    }
    Ok((major, minor, patch))
}

fn parse_part(part: Option<&str>, original: &str) -> Result<u64, String> {
    let part = part.ok_or_else(|| format!("unsupported version {original}"))?;
    if part.is_empty() || !part.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("unsupported version {original}"));
    }
    part.parse()
        .map_err(|_| format!("unsupported version {original}"))
}

/// Map a `file:` URL or local path to a filesystem path; HTTP(S) returns `None`.
fn local_path(source: &str) -> Option<PathBuf> {
    let source = source.trim();
    if source.starts_with("http://") || source.starts_with("https://") {
        return None;
    }
    if let Ok(url) = tauri::Url::parse(source) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
        if url.scheme() == "http" || url.scheme() == "https" {
            return None;
        }
    }
    Some(PathBuf::from(source))
}

fn read_text(source: &str) -> Result<String, String> {
    String::from_utf8(read_bytes(source)?).map_err(|e| format!("update manifest is not UTF-8: {e}"))
}

fn read_bytes(source: &str) -> Result<Vec<u8>, String> {
    if let Some(path) = local_path(source) {
        return std::fs::read(&path).map_err(|e| format!("failed to read {}: {e}", path.display()));
    }
    http_get(source)
}

const DEFAULT_PROXY_PORT: u16 = 7897;
const PROXY_PORT_ENV: &str = "DSH_PROXY_PORT";
const PROXY_URL_ENV: &str = "DSH_PROXY_URL";

fn dsh_home() -> PathBuf {
    if let Ok(home) = std::env::var("DSH_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    let user = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"));
    PathBuf::from(user.unwrap_or_default()).join(".dsh")
}

fn strip_yaml_comment(line: &str) -> String {
    let mut out = String::new();
    let mut in_quote = false;
    for ch in line.chars() {
        if ch == '"' {
            in_quote = !in_quote;
        }
        if ch == '#' && !in_quote {
            break;
        }
        out.push(ch);
    }
    out
}

fn unquote_yaml(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        return value[1..value.len() - 1].to_string();
    }
    value.to_string()
}

fn parse_port_str(value: &str) -> Option<u16> {
    value.parse().ok().filter(|port| (1..=65535).contains(port))
}

/// Read `http-proxy.port` from a user-settings document.
pub(crate) fn parse_http_proxy_port_yaml(text: &str) -> Option<u16> {
    let mut in_section = false;
    for raw in text.lines() {
        let indent = raw.len() - raw.trim_start().len();
        let trimmed = strip_yaml_comment(raw).trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if indent == 0 {
            in_section = trimmed == "http-proxy:" || trimmed.starts_with("http-proxy:");
            if let Some(rest) = trimmed.strip_prefix("http-proxy:") {
                let rest = rest.trim();
                if rest.starts_with('{') {
                    if let Some(port) = rest.split("port:").nth(1) {
                        let token = port
                            .trim()
                            .trim_start_matches('{')
                            .trim_end_matches('}')
                            .split([',', ' ', '}'])
                            .next()
                            .unwrap_or("");
                        return parse_port_str(&unquote_yaml(token));
                    }
                }
            }
            continue;
        }
        if in_section {
            if let Some(value) = trimmed.strip_prefix("port:") {
                return parse_port_str(&unquote_yaml(value));
            }
        }
    }
    None
}

pub(crate) fn parse_proxy_url_port(value: &str) -> Option<u16> {
    let after_scheme = value.trim().split_once("://")?.1;
    let hostport = after_scheme.split('/').next()?;
    let port = if hostport.starts_with('[') {
        hostport.rsplit_once("]:")?.1
    } else {
        hostport.rsplit_once(':')?.1
    };
    parse_port_str(port)
}

pub(crate) fn resolve_proxy_port(
    env_port: Option<&str>,
    env_url: Option<&str>,
    settings_yaml: Option<&str>,
) -> u16 {
    if let Some(port) = env_port.and_then(parse_port_str) {
        return port;
    }
    if let Some(port) = env_url.and_then(parse_proxy_url_port) {
        return port;
    }
    if let Some(port) = settings_yaml.and_then(parse_http_proxy_port_yaml) {
        return port;
    }
    DEFAULT_PROXY_PORT
}

fn live_proxy_port() -> u16 {
    let yaml = std::fs::read_to_string(dsh_home().join("settings.yaml")).ok();
    resolve_proxy_port(
        std::env::var(PROXY_PORT_ENV).ok().as_deref(),
        std::env::var(PROXY_URL_ENV).ok().as_deref(),
        yaml.as_deref(),
    )
}

pub(crate) fn is_loopback_http_url(url: &str) -> bool {
    let Some((_, rest)) = url.split_once("://") else {
        return false;
    };
    let hostport = rest.split('/').next().unwrap_or(rest);
    let host = if hostport.starts_with('[') {
        hostport
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    } else {
        hostport
            .rsplit_once(':')
            .map(|(h, _)| h.to_string())
            .unwrap_or_else(|| hostport.to_string())
            .to_ascii_lowercase()
    };
    matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1" | "0.0.0.0")
}

fn http_call(url: &str, proxy_timeout: Duration) -> Result<ureq::Response, String> {
    let direct = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(8))
        .build();
    match direct.get(url).call() {
        Ok(response) => Ok(response),
        Err(direct_err) => {
            if is_loopback_http_url(url) {
                return Err(format!("failed to fetch {url}: {direct_err}"));
            }
            let port = live_proxy_port();
            let proxy = ureq::Proxy::new(&format!("http://127.0.0.1:{port}"))
                .map_err(|e| format!("invalid HTTP proxy on port {port}: {e}"))?;
            let agent = ureq::AgentBuilder::new()
                .proxy(proxy)
                .timeout_connect(Duration::from_secs(10))
                .timeout(proxy_timeout)
                .build();
            agent.get(url).call().map_err(|proxy_err| {
                format!(
                    "failed to fetch {url}: {direct_err}; proxy http://127.0.0.1:{port} also failed: {proxy_err}"
                )
            })
        }
    }
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let response = http_call(url, Duration::from_secs(60))?;
    let mut bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("failed to read {url}: {e}"))?;
    Ok(bytes)
}

fn download_verified(
    app: &AppHandle,
    source: &str,
    expected_sha256: &str,
    dest: &Path,
) -> Result<(), String> {
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "download",
            received: 0,
            total: None,
        },
    );
    if let Some(path) = local_path(source) {
        let bytes =
            std::fs::read(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                phase: "download",
                received: bytes.len() as u64,
                total: Some(bytes.len() as u64),
            },
        );
        verify_and_write(app, &bytes, expected_sha256, dest)?;
        return Ok(());
    }
    let response = http_call(source, Duration::from_secs(600))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok());
    let mut reader = response.into_reader();
    let mut file =
        File::create(dest).map_err(|e| format!("failed to create {}: {e}", dest.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = [0_u8; 65_536];
    let mut received = 0_u64;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("failed to download {source}: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n])
            .map_err(|e| format!("failed to write {}: {e}", dest.display()))?;
        received += n as u64;
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                phase: "download",
                received,
                total,
            },
        );
    }
    drop(file);
    let actual = hex_encode(&hasher.finalize());
    if actual != expected_sha256.to_ascii_lowercase() {
        let _ = std::fs::remove_file(dest);
        return Err("downloaded installer SHA-256 does not match the channel index".into());
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "verify",
            received,
            total: Some(received),
        },
    );
    Ok(())
}

fn verify_and_write(
    app: &AppHandle,
    bytes: &[u8],
    expected_sha256: &str,
    dest: &Path,
) -> Result<(), String> {
    let actual = sha256_hex(bytes);
    if actual != expected_sha256.to_ascii_lowercase() {
        return Err("downloaded installer SHA-256 does not match the channel index".into());
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        Progress {
            phase: "verify",
            received: bytes.len() as u64,
            total: Some(bytes.len() as u64),
        },
    );
    std::fs::write(dest, bytes).map_err(|e| format!("failed to write {}: {e}", dest.display()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_encode(&Sha256::digest(bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn safe_filename(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("artifact filename is not a plain file name".into());
    }
    Ok(name)
}

fn launch_nsis(installer: &Path, install_dir: &Path) -> Result<(), String> {
    let mut command = Command::new(installer);
    command.arg("/S");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.raw_arg(format!("/D={}", install_dir.display()));
    }
    #[cfg(not(windows))]
    {
        command.arg(format!("/D={}", install_dir.display()));
    }
    command
        .spawn()
        .map_err(|e| format!("failed to start the installer: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn available_json(latest: &str, url: &str, sha: &str) -> String {
        format!(
            r#"{{
              "schemaVersion": 1,
              "channel": "stable",
              "latest": "{latest}",
              "releases": [{{
                "version": "{latest}",
                "releasedAt": "2026-08-16T00:00:00Z",
                "notes": {{ "zh": "中文", "en": "English" }},
                "artifacts": {{
                  "windows-x64": {{
                    "kind": "nsis",
                    "filename": "DeepSeek-Harness_{latest}_x64-setup.exe",
                    "url": "{url}",
                    "sha256": "{sha}",
                    "size": 12
                  }}
                }}
              }}]
            }}"#
        )
    }

    #[test]
    fn parse_semver_accepts_triples_and_rejects_junk() {
        assert_eq!(parse_semver("0.2.0").unwrap(), (0, 2, 0));
        assert_eq!(parse_semver("0.2.10").unwrap(), (0, 2, 10));
        assert!(parse_semver("0.2").is_err());
        assert!(parse_semver("0.2.0-beta").is_err());
        assert!(parse_semver("v0.2.0").is_err());
        assert!(parse_semver("").is_err());
    }

    #[test]
    fn evaluate_current_when_latest_matches_or_is_older() {
        let json = r#"{
          "schemaVersion": 1,
          "channel": "stable",
          "latest": "0.2.0",
          "releases": [{ "version": "0.2.0", "notes": { "zh": "", "en": "" } }]
        }"#;
        let (result, plan) = evaluate("0.2.0", json).unwrap();
        assert!(matches!(result, CheckResult::Current { .. }));
        assert!(plan.is_none());
        let (result, plan) = evaluate("0.3.0", json).unwrap();
        assert!(matches!(result, CheckResult::Current { .. }));
        assert!(plan.is_none());
    }

    #[test]
    fn evaluate_available_when_latest_is_newer() {
        let json = available_json("0.2.1", "file:///C:/setup.exe", "abcd");
        let (result, plan) = evaluate("0.2.0", &json).unwrap();
        match result {
            CheckResult::Available {
                latest,
                size,
                kind,
                notes,
                ..
            } => {
                assert_eq!(latest, "0.2.1");
                assert_eq!(size, 12);
                assert_eq!(kind, ArtifactKind::Nsis);
                assert_eq!(notes.zh, "中文");
            }
            other => panic!("expected available, got {other:?}"),
        }
        assert_eq!(
            plan.unwrap().filename,
            "DeepSeek-Harness_0.2.1_x64-setup.exe"
        );
    }

    #[test]
    fn evaluate_rejects_bad_schema_missing_artifact_and_bad_filename() {
        assert!(evaluate(
            "0.2.0",
            r#"{"schemaVersion":2,"channel":"stable","latest":"0.2.1","releases":[]}"#
        )
        .is_err());
        let missing = r#"{
          "schemaVersion": 1,
          "channel": "stable",
          "latest": "0.2.1",
          "releases": [{ "version": "0.2.1", "notes": { "zh": "", "en": "" } }]
        }"#;
        assert!(evaluate("0.2.0", missing).is_err());
        let empty_url = available_json("0.2.1", "", "abcd");
        assert!(evaluate("0.2.0", &empty_url).is_err());
        let slash = available_json("0.2.1", "file:///C:/setup.exe", "abcd")
            .replace("DeepSeek-Harness_0.2.1_x64-setup.exe", "../evil.exe");
        assert!(evaluate("0.2.0", &slash).is_err());
    }

    #[test]
    fn evaluate_accepts_reserved_runtime_zip_kind() {
        let json = available_json("0.2.1", "file:///C:/runtime.zip", "abcd")
            .replace("\"kind\": \"nsis\"", "\"kind\": \"runtime-zip\"");
        let (result, plan) = evaluate("0.2.0", &json).unwrap();
        match result {
            CheckResult::Available { kind, .. } => assert_eq!(kind, ArtifactKind::RuntimeZip),
            other => panic!("expected available, got {other:?}"),
        }
        assert_eq!(plan.unwrap().kind, ArtifactKind::RuntimeZip);
    }

    #[test]
    fn local_path_distinguishes_http_from_files() {
        assert!(local_path("https://example.com/latest.json").is_none());
        assert!(local_path("http://127.0.0.1/latest.json").is_none());
        let path = local_path(env!("CARGO_MANIFEST_DIR")).unwrap();
        assert!(path.is_dir());
    }

    #[test]
    fn resolve_manifest_source_prefers_env_then_config_then_files() {
        let tmp = std::env::temp_dir().join("dsh-desktop-update-test");
        std::fs::create_dir_all(&tmp).unwrap();
        let beside = tmp.join("latest.json");
        std::fs::write(&beside, "{}").unwrap();
        assert_eq!(
            resolve_manifest_source(Some(&tmp), None, None, Some("C:/override.json"), "").unwrap(),
            "C:/override.json"
        );
        assert_eq!(
            resolve_manifest_source(
                Some(&tmp),
                None,
                None,
                None,
                "https://example.com/latest.json"
            )
            .unwrap(),
            "https://example.com/latest.json"
        );
        assert_eq!(
            resolve_manifest_source(Some(&tmp), None, None, None, "").unwrap(),
            beside.to_string_lossy()
        );
        std::fs::remove_file(&beside).unwrap();
        assert!(resolve_manifest_source(Some(&tmp), None, None, None, "").is_err());
    }

    #[test]
    fn sha256_hex_is_lowercase() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn resolve_proxy_port_prefers_env_then_url_then_yaml_then_default() {
        assert_eq!(
            resolve_proxy_port(
                Some("8888"),
                Some("http://127.0.0.1:1"),
                Some("http-proxy:\n  port: 2\n")
            ),
            8888
        );
        assert_eq!(
            resolve_proxy_port(
                None,
                Some("http://127.0.0.1:9050"),
                Some("http-proxy:\n  port: 2\n")
            ),
            9050
        );
        assert_eq!(
            resolve_proxy_port(
                None,
                None,
                Some("ui-theme:\n  preference: dark\nhttp-proxy:\n  port: 8118 # clash\n")
            ),
            8118
        );
        assert_eq!(
            resolve_proxy_port(None, None, Some("http-proxy: { port: 1234 }\n")),
            1234
        );
        assert_eq!(
            resolve_proxy_port(Some("nope"), None, None),
            DEFAULT_PROXY_PORT
        );
        assert_eq!(resolve_proxy_port(None, None, None), DEFAULT_PROXY_PORT);
        assert_eq!(parse_proxy_url_port("http://[::1]:7897/"), Some(7897));
        assert_eq!(
            parse_http_proxy_port_yaml("http-proxy:\n  port: \"9050\"\n"),
            Some(9050)
        );
    }

    #[test]
    fn loopback_http_urls_skip_the_proxy() {
        assert!(is_loopback_http_url("http://127.0.0.1:3080/latest.json"));
        assert!(is_loopback_http_url("https://localhost/x"));
        assert!(is_loopback_http_url("http://[::1]:9/"));
        assert!(!is_loopback_http_url("https://raw.githubusercontent.com/x"));
        assert!(!is_loopback_http_url("not-a-url"));
    }
}

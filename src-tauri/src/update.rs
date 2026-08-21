//! Desktop update channel: fetch the personal GitHub Release, compare semver,
//! verify its installer digest, and launch NSIS.

use std::{
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
use tauri::{AppHandle, Emitter};

const CHANNEL_CONFIG: &str = include_str!("../update-channel.json");
const CURRENT: &str = env!("CARGO_PKG_VERSION");
const PERSONAL_RELEASES_API: &str =
    "https://api.github.com/repos/fsw2781890522/dsh-desktop/releases/latest";
const PROGRESS_EVENT: &str = "dsh-update-progress";

static LAST_PLAN: Mutex<Option<InstallPlan>> = Mutex::new(None);
static IN_FLIGHT: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelConfig {
    release_api_url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseDocument {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

/// Release notes shown in the update row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notes {
    /// Simplified Chinese notes.
    pub zh: String,
    /// English notes.
    pub en: String,
}

/// Installer kind represented by a GitHub Release asset.
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
    /// The personal GitHub Release cannot be used (bad JSON or missing artifact).
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

/// Fetch the personal GitHub Release and compare it with this shell's semver.
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
    let source = release_source(app)?;
    let text = read_text(&source)?;
    evaluate_github_release(CURRENT, &text)
}

fn configured_release_api_url() -> String {
    serde_json::from_str::<ChannelConfig>(CHANNEL_CONFIG)
        .map(|config| config.release_api_url)
        .unwrap_or_default()
}

fn release_source(_app: &AppHandle) -> Result<String, String> {
    resolve_release_source(&configured_release_api_url())
}

/// Return the sole configured GitHub Releases API source.
fn resolve_release_source(configured_url: &str) -> Result<String, String> {
    let configured_url = configured_url.trim();
    if configured_url == PERSONAL_RELEASES_API {
        return Ok(configured_url.to_string());
    }
    if configured_url.is_empty() {
        return Err("the personal GitHub Releases update source is not configured".into());
    }
    Err(format!(
        "update source must be the personal GitHub Releases API: {PERSONAL_RELEASES_API}"
    ))
}

fn evaluate_github_release(
    current: &str,
    json: &str,
) -> Result<(CheckResult, Option<InstallPlan>), String> {
    let current_semver = parse_semver(current)?;
    let document: GitHubReleaseDocument = serde_json::from_str(json)
        .map_err(|e| format!("GitHub Releases response is not valid JSON: {e}"))?;
    let latest = document
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&document.tag_name);
    let latest_semver = parse_semver(latest)
        .map_err(|e| format!("GitHub Release tag {} is invalid: {e}", document.tag_name))?;
    if current_semver >= latest_semver {
        return Ok((
            CheckResult::Current {
                current: current.to_string(),
            },
            None,
        ));
    }

    let asset = document
        .assets
        .iter()
        .find(|asset| asset.name.ends_with("_x64-setup.exe"))
        .ok_or_else(|| {
            format!(
                "GitHub Release {} has no x64 NSIS installer",
                document.tag_name
            )
        })?;
    validate_release_asset_url(&document.tag_name, &asset.browser_download_url)?;
    let digest = normalize_sha256_digest(asset.digest.as_deref(), &asset.name)?;
    safe_filename(&asset.name)?;
    let notes = document.body.unwrap_or_default();
    let plan = InstallPlan {
        kind: ArtifactKind::Nsis,
        filename: asset.name.clone(),
        url: asset.browser_download_url.clone(),
        sha256: digest,
    };
    Ok((
        CheckResult::Available {
            current: current.to_string(),
            latest: latest.to_string(),
            notes: Notes {
                zh: notes.clone(),
                en: notes,
            },
            size: asset.size,
            kind: ArtifactKind::Nsis,
        },
        Some(plan),
    ))
}

fn validate_release_asset_url(tag: &str, url: &str) -> Result<(), String> {
    let expected_prefix =
        format!("https://github.com/fsw2781890522/dsh-desktop/releases/download/{tag}/");
    if url.starts_with(&expected_prefix) {
        Ok(())
    } else {
        Err(format!(
            "GitHub Release asset URL is outside the personal repository: {url}"
        ))
    }
}

fn normalize_sha256_digest(value: Option<&str>, asset_name: &str) -> Result<String, String> {
    let digest = value
        .and_then(|value| value.strip_prefix("sha256:"))
        .map(str::trim)
        .filter(|value| value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()))
        .ok_or_else(|| format!("GitHub Release asset {asset_name} has no valid SHA-256 digest"))?;
    Ok(digest.to_ascii_lowercase())
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
    String::from_utf8(read_bytes(source)?)
        .map_err(|e| format!("GitHub Releases response is not UTF-8: {e}"))
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
    match direct
        .get(url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "dsh-desktop")
        .call()
    {
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
            agent
                .get(url)
                .set("Accept", "application/vnd.github+json")
                .set("User-Agent", "dsh-desktop")
                .call()
                .map_err(|proxy_err| {
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
        return Err(
            "downloaded installer SHA-256 does not match the published GitHub Release".into(),
        );
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
        return Err(
            "downloaded installer SHA-256 does not match the published GitHub Release".into(),
        );
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

    fn github_release_json(tag: &str, asset_name: &str, url: &str, digest: Option<&str>) -> String {
        let digest = digest
            .map(|value| format!(r#""{value}""#))
            .unwrap_or_else(|| "null".to_string());
        format!(
            r#"{{
              "tag_name": "{tag}",
              "name": "DeepSeek Harness {tag}",
              "body": "中文说明\\n\\nEnglish notes",
              "assets": [{{
                "name": "{asset_name}",
                "browser_download_url": "{url}",
                "size": 123,
                "digest": {digest}
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
    fn evaluate_github_release_reports_current_for_latest_published_release() {
        let json = github_release_json(
            "v0.3.1",
            "DeepSeek.Harness_0.3.1_x64-setup.exe",
            "https://github.com/fsw2781890522/dsh-desktop/releases/download/v0.3.1/DeepSeek.Harness_0.3.1_x64-setup.exe",
            Some("sha256:4ba04a152c53b6d72bf92a997f6e94467437872004a62db22812858fbf709070"),
        );
        let (result, plan) = evaluate_github_release("0.3.1", &json).unwrap();
        assert!(matches!(result, CheckResult::Current { .. }));
        assert!(plan.is_none());
    }

    #[test]
    fn evaluate_github_release_uses_only_published_release_asset() {
        let json = github_release_json(
            "v0.3.2",
            "DeepSeek.Harness_0.3.2_x64-setup.exe",
            "https://github.com/fsw2781890522/dsh-desktop/releases/download/v0.3.2/DeepSeek.Harness_0.3.2_x64-setup.exe",
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        let (result, plan) = evaluate_github_release("0.3.1", &json).unwrap();
        match result {
            CheckResult::Available {
                latest,
                size,
                notes,
                ..
            } => {
                assert_eq!(latest, "0.3.2");
                assert_eq!(size, 123);
                assert_eq!(notes.zh, "中文说明\\n\\nEnglish notes");
            }
            other => panic!("expected available, got {other:?}"),
        }
        let plan = plan.unwrap();
        assert_eq!(plan.url, "https://github.com/fsw2781890522/dsh-desktop/releases/download/v0.3.2/DeepSeek.Harness_0.3.2_x64-setup.exe");
        assert_eq!(
            plan.sha256,
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );
    }

    #[test]
    fn evaluate_github_release_rejects_missing_sha256_or_installer_asset() {
        let missing_digest = github_release_json(
            "v0.3.2",
            "DeepSeek.Harness_0.3.2_x64-setup.exe",
            "https://example.invalid/setup.exe",
            None,
        );
        assert!(evaluate_github_release("0.3.1", &missing_digest).is_err());

        let missing_installer = github_release_json(
            "v0.3.2",
            "SHA256SUMS",
            "https://example.invalid/SHA256SUMS",
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        assert!(evaluate_github_release("0.3.1", &missing_installer).is_err());

        let external_asset = github_release_json(
            "v0.3.2",
            "DeepSeek.Harness_0.3.2_x64-setup.exe",
            "https://example.invalid/DeepSeek.Harness_0.3.2_x64-setup.exe",
            Some("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        assert!(evaluate_github_release("0.3.1", &external_asset).is_err());
    }

    #[test]
    fn local_path_distinguishes_http_from_files() {
        assert!(local_path("https://example.com/latest.json").is_none());
        assert!(local_path("http://127.0.0.1/latest.json").is_none());
        let path = local_path(env!("CARGO_MANIFEST_DIR")).unwrap();
        assert!(path.is_dir());
    }

    #[test]
    fn resolve_release_source_uses_configured_personal_release_only() {
        assert_eq!(
            resolve_release_source(PERSONAL_RELEASES_API).unwrap(),
            PERSONAL_RELEASES_API
        );
        assert!(resolve_release_source("").is_err());
        assert!(resolve_release_source(
            "https://raw.githubusercontent.com/fsw2781890522/dsh-desktop/main/releases/latest.json"
        )
        .is_err());
    }

    #[test]
    fn embedded_release_source_is_the_personal_api() {
        assert_eq!(configured_release_api_url(), PERSONAL_RELEASES_API);
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

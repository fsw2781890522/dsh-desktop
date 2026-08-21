# Desktop update channel

English | [中文](update-channel.zh.md)

The desktop construction repo owns how a running app discovers a newer installer. The Settings row in DeepSeek Harness only calls `window.__DSH_DESKTOP__.checkUpdate()` / `installUpdate()`; it does not fetch this document itself.

## Release source

Production builds fetch only the latest non-draft, non-prerelease release from
the personal repository's GitHub Releases API:

`https://api.github.com/repos/fsw2781890522/dsh-desktop/releases/latest`

The app uses the release `tag_name` (for example `v0.3.2`) as the version and
selects the asset whose name ends in `_x64-setup.exe`. GitHub's `digest` field
must contain a `sha256:` value; the installer is downloaded from that same
release asset URL and verified against that digest. Release notes are shown in
the Settings row.

`releases/latest.json` remains a tracked local release ledger and schema example
for packaging/review; it is not read by production update checks. The `main`
branch, a local file beside the executable, and environment overrides cannot
advertise an update.

## How the app finds the release

The fixed source is recorded in [`../src-tauri/update-channel.json`](../src-tauri/update-channel.json).
If that personal Releases API URL is missing, the check fails visibly; there is
no fallback to branch contents or local files.

## Proxy fallback

Release discovery and installer download use the same direct-then-proxy transport rule as `@deepseek-ai/dsh-http-proxy`. Direct connect is budgeted at five seconds (eight seconds overall); a transport failure retries through `http://127.0.0.1:{port}`. The port is `DSH_PROXY_PORT`, then the port in `DSH_PROXY_URL`, then `http-proxy.port` in `$DSH_HOME/settings.yaml` or `%USERPROFILE%\.dsh\settings.yaml`, then `7897`. The proxy changes transport only; it cannot change the GitHub Releases URL or response source. This is product HTTP: it does not register or enable `web_search` / `web_fetch` / `tool-web`.

## Publishing a version

`scripts/build.ps1` runs `scripts/publish-release.ps1` after a successful NSIS build. That script copies the installer into `releases/<version>/`, writes `SHA256SUMS`, and upserts that version in `latest.json` for local review. A version is not discoverable until a matching non-draft GitHub Release exists in `fsw2781890522/dsh-desktop` with the installer asset uploaded. Installer binaries stay out of git; the personal GitHub Release is the production source of truth.

Install uses NSIS `/S` with `/D=` set to the directory of the running exe (typically `%LOCALAPPDATA%\DeepSeek Harness`). User data stays in `~/.dsh`.

## Changelog

Human-readable history: [`../CHANGELOG.md`](../CHANGELOG.md) / [`../CHANGELOG.zh.md`](../CHANGELOG.zh.md). The Settings row shows the body from the personal GitHub Release for the newer version.

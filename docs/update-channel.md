# Desktop update channel

English | [中文](update-channel.zh.md)

The desktop construction repo owns how a running app discovers a newer installer. The Settings row in DeepSeek Harness only calls `window.__DSH_DESKTOP__.checkUpdate()` / `installUpdate()`; it does not fetch this document itself.

## Channel index

`releases/latest.json` is the document the app fetches. JSON Schema: [`../releases/channel.schema.json`](../releases/channel.schema.json).

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "latest": "0.2.1",
  "releases": [
    {
      "version": "0.2.1",
      "releasedAt": "2026-08-16T11:22:00Z",
      "notes": { "zh": "…", "en": "…" },
      "artifacts": {
        "windows-x64": {
          "kind": "nsis",
          "filename": "DeepSeek Harness_0.2.1_x64-setup.exe",
          "url": "https://example.invalid/DeepSeek-Harness_0.2.1_x64-setup.exe",
          "sha256": "…",
          "size": 123
        }
      }
    }
  ]
}
```

Rules:

- `schemaVersion` is `1`. Other values are an explicit failure.
- `latest` and each `version` are `major.minor.patch` with no pre-release suffix.
- When the installed shell version is greater than or equal to `latest`, the app reports current and does not require artifacts.
- When `latest` is newer, that release must include `artifacts.windows-x64` with a non-empty `url` and `sha256`. `kind` is `nsis` (implemented) or `runtime-zip` (reserved).
- `url` may be `https:`, `http:`, or `file:`.

## How the app finds the index

1. Environment variable `DSH_DESKTOP_UPDATE_MANIFEST` (path or URL), when non-empty.
2. `manifestUrl` in [`../src-tauri/update-channel.json`](../src-tauri/update-channel.json), when non-empty.
3. `latest.json` next to the executable, then next to the Tauri resource dir.
4. Debug builds only: `releases/latest.json` in this repository.

An empty configuration is an error shown in Settings, not a silent skip.

## Publishing a version

`scripts/build.ps1` runs `scripts/publish-release.ps1` after a successful NSIS build. That script copies the installer into `releases/<version>/`, writes `SHA256SUMS`, and upserts that version in `latest.json`. It never deletes another version's directory. Installer binaries stay out of git; `latest.json`, notes, and checksums are tracked.

Install uses NSIS `/S` with `/D=` set to the directory of the running exe (typically `%LOCALAPPDATA%\DeepSeek Harness`). User data stays in `~/.dsh`.

## Changelog

Human-readable history: [`../CHANGELOG.md`](../CHANGELOG.md) / [`../CHANGELOG.zh.md`](../CHANGELOG.zh.md). The Settings row shows `notes` from the channel index for the newer version.

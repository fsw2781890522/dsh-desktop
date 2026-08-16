# Changelog

All notable desktop-shell releases are recorded here. The running app reads the same notes from `releases/latest.json`.

## 0.2.1 — 2026-08-16

- Check for updates uses the same direct-then-proxy HTTP path as the harness (`127.0.0.1:{port}`, default 7897). This does not enable agent web tools.

## 0.2.0 — 2026-08-16

- Settings can check the update channel and install a newer NSIS package into the current install directory.
- Installers are copied to `releases/<version>/` instead of overwriting a single setup.exe.
- User data stays in `~/.dsh`.

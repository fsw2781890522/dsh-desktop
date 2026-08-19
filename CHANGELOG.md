# Changelog

All notable desktop-shell releases are recorded here. The running app reads the same notes from `releases/latest.json`.

## 0.3.1 — 2026-08-19

- Ships `@liustack/modlens@3.21.1` (vision for text-only models) and `dsh-better-sidebar@0.13.1` (right-side workbench) in the bundled runtime. A first launch appends them to the web profile bundle list when they are missing; user `cordis.patch.yml` is left unchanged. ModLens still needs an engine key in `~/.modlens/config.json`.
- Frameless chrome keeps minimize / maximize / close in the Web UI header row as 28px circular rail buttons matching the better-sidebar cluster (even 4px gap, top 3px). Session log, the cluster, and the caption buttons line up left-to-right; the blank-session hero can drag from the top 36px.
- Check for updates, the local HTTP proxy, and agent web tools stay on separate planes. User data remains in `~/.dsh`.

## 0.3.0 — 2026-08-18

- Rebases the bundled harness onto official `@deepseek-ai/dsh@0.1.0-rc.7` while keeping the desktop-specific work: frameless Tauri chrome, sidebar glass with a transparency slider, proxy-port fallback, default models, Anchored Standard, prompt navigation, collapsed “已处理” process runs, and no session-list bottom fade above Settings.
- Check for updates, the local HTTP proxy, and agent web tools stay on separate planes. User data remains in `~/.dsh`.
- First-launch completeness accepts npm’s hoisted `commander` next to `@deepseek-ai/`, not only a nested copy under the dsh package.
- Native Acrylic stays after the window loses focus: the shell reapplies a persistent composition attribute instead of Windows 11’s transient backdrop.
- Confirmation dialogs opened from Settings, including provider delete, paint above the Settings overlay.

## 0.2.3 — 2026-08-17

- Open sessions now load their complete history in one request; the chat view no longer exposes the unreliable “Load earlier” control.
- Prompt navigation includes steering/interjection prompts, and the sidebar uses a readable light/dark glass treatment with a 60% semantic fill and 40% background sampling.
- The settings dialog remains the topmost full-viewport layer above composer, prompt navigation, and sidebar glass; history loading is centered in the session view with larger status text.
- The factory `Anchored Standard` preset remains the new-session default while appearing in the Custom preset section.
- Removed the session-list bottom fade that obscured content; native Acrylic is reapplied after focus loss and the sidebar glass remains theme-aware.
- Added a sidebar-transparency slider under General Settings; stats previews and regular tooltips now use theme-aware floating surfaces, including in light mode.
- Kept the lower splash progress/status area for runtime extraction, making the slower first launch after reinstall understandable.
- Direct HTTP no longer aborts a live model SSE body after the 5s header budget, which had caused repeated “model request retried” failures on a reachable API.

## 0.2.2 — 2026-08-16

- First-launch unpack extracts into a staging directory, stops a leftover `bundle-runtime/node.exe`, then replaces the runtime folder so Windows `tar` is not blocked by an orphan Node process.

## 0.2.1 — 2026-08-16

- Check for updates uses the same direct-then-proxy HTTP path as the harness (`127.0.0.1:{port}`, default 7897). This does not enable agent web tools.

## 0.2.0 — 2026-08-16

- Settings can check the update channel and install a newer NSIS package into the current install directory.
- Installers are copied to `releases/<version>/` instead of overwriting a single setup.exe.
- User data stays in `~/.dsh`.

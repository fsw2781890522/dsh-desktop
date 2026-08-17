# Changelog

All notable desktop-shell releases are recorded here. The running app reads the same notes from `releases/latest.json`.

## 0.2.3 — 2026-08-17

- Open sessions now load their complete history in one request; the chat view no longer exposes the unreliable “Load earlier” control.
- Prompt navigation includes steering/interjection prompts, and the sidebar uses a readable light/dark glass treatment with a 60% semantic fill and 40% background sampling.
- The settings dialog remains the topmost full-viewport layer above composer, prompt navigation, and sidebar glass; history loading is centered in the session view with larger status text.
- The factory `Anchored Standard` preset remains the new-session default while appearing in the Custom preset section.
- Removed the session-list bottom fade that obscured content; native Acrylic is reapplied after focus loss and the sidebar glass remains theme-aware.
- Added a sidebar-transparency slider under General Settings; stats previews and regular tooltips now use theme-aware floating surfaces, including in light mode.
- Kept the lower splash progress/status area for runtime extraction, making the slower first launch after reinstall understandable.

## 0.2.2 — 2026-08-16

- First-launch unpack extracts into a staging directory, stops a leftover `bundle-runtime/node.exe`, then replaces the runtime folder so Windows `tar` is not blocked by an orphan Node process.

## 0.2.1 — 2026-08-16

- Check for updates uses the same direct-then-proxy HTTP path as the harness (`127.0.0.1:{port}`, default 7897). This does not enable agent web tools.

## 0.2.0 — 2026-08-16

- Settings can check the update channel and install a newer NSIS package into the current install directory.
- Installers are copied to `releases/<version>/` instead of overwriting a single setup.exe.
- User data stays in `~/.dsh`.

# DeepSeek Harness Desktop (Windows)

The official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI
wrapped as a native Windows desktop application with [Tauri](https://tauri.app/).

## How it works

The official frontend is a Web UI served by the `dsh web` command
(a Node.js server that injects `window.__DSH_BOOT__` and serves the built
frontend plus the `/api` backend). This project does **not** reimplement any of
that — it packages the official, published `@deepseek-ai/dsh` npm package
together with a standalone `node.exe` and serves it inside a native window:

1. `scripts/bundle-runtime.ps1` copies `node.exe` + `@deepseek-ai/dsh` into
   `bundle-runtime/` (used by `tauri dev`), overlays `factory/agent-presets/`
   into the shipped roster (`config/agent-presets/`), sets the default session
   preset to `anchored-standard`, installs the factory web plugins from
   `factory/web-plugins.json` into the runtime `node_modules`, and packs that
   tree into one `bundle-runtime.zip`. The installer ships the zip, not ~33k
   individual files: NSIS otherwise truncates the tree and `dsh` cannot resolve
   `commander`. On launch the shell appends those plugin names to the web
   profile bundle list when they are missing; it does not edit `cordis.patch.yml`.
2. On launch the app unpacks the zip if needed, then spawns
   `node.exe node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port 0`
   and parses the readiness line (`dsh web: http://127.0.0.1:PORT`) from stdout.
3. A WebView2 window opens at `http://127.0.0.1:PORT/` — the untouched official UI.
   The window is frameless. Injected chrome places minimize / maximize / close
   in the existing Web UI header row (no extra titlebar strip): 28px circular
   rail buttons matching the better-sidebar cluster, far right, then the
   cluster, then Session log. The top 36px of non-interactive chrome is a
   drag region so the blank-session hero (which has no header) can still move
   the window. Button ink follows the GUI light / dark tokens.
4. All harness user data lives in the standard `~/.dsh` directory, so the desktop
   app shares settings, credentials, and sessions with the CLI installation.
   Factory presets are **not** copied there: they ship inside the runtime as
   system-trust roster entries, so a recipient's empty `~/.dsh` still sees
   Anchored Standard and uses it for new sessions.
5. Settings → General includes **Check for updates** when the shell injected
   `window.__DSH_DESKTOP__`. Production update discovery uses the personal
   GitHub Releases API as its sole source — see [docs/update-channel.md](docs/update-channel.md).
6. Links with `target="_blank"` and `window.open` are opened in the system
   browser via a `dsh-ext://` scheme; the app is single-instance; closing the
   window stops the bundled server.

## Icon

The icon is the official DeepSeek whale in white (path data taken verbatim from
the official `@deepseek-ai/dsh-web-frontend/dist/favicon.svg`; white is that
favicon's own dark-mode fill) on a black rounded square — DeepSeek's official
black-background logo style.

- Source renderer: `scripts/render-icon.mjs` → `icon-source/deepseek-black-1024.png`
- All platform icons: `npm run icon` (runs `tauri icon` → `src-tauri/icons/`)

## Prerequisites (build machine)

- Rust stable with the MSVC target (`rustup default stable-msvc`)
- Visual Studio 2022 Build Tools with the *Desktop development with C++*
  workload (MSVC + Windows 11 SDK)
- Node.js ≥ 22 and npm (for the Tauri CLI and icon tooling)
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 11)

## Build

```powershell
# 1. (Re)bundle the dsh runtime — install the official 0.1.1-rc.1 baseline,
#    overlay the locally built fork, then pack bundle-runtime.zip
.\scripts\bundle-runtime.ps1 -DshVersion "0.1.1-rc.1" `
  -LocalHarnessRoot "..\deepseek-harness"

# 2. Install JS tooling (Tauri CLI + icon renderer)
npm install

# 3. Render icon and generate all platform icon sizes
npm run icon:render
npm run icon

# 4. Build the app + NSIS installer (output: src-tauri/target/release/bundle/
#    and a versioned copy under releases/<version>/)
.\scripts\build.ps1 -DshVersion "0.1.1-rc.1" `
  -LocalHarnessRoot "..\deepseek-harness"

# Development run (spawns the server, opens the window, no installer)
npm run dev
```

## Updating the bundled DeepSeek Harness version

The runtime under `bundle-runtime/node_modules/@deepseek-ai/dsh` starts from a
published npm installation. For a personal fork build, pass the local
`deepseek-harness` checkout with `-LocalHarnessRoot`; the bundler overlays its
built host/client libraries, web frontend `dist/`, CLI config, and web patch
onto the official baseline. The official `0.1.1-rc.1` baseline includes native
multimodal input and `read_image`, so this desktop no longer bundles ModLens.

## Layout

```
splash/                 Embedded splash + error pages (built by scripts/render-icon.mjs)
icon-source/            Rendered 1024px black-background icon source
factory/                Factory agent presets and web-plugin pins overlaid at pack time
scripts/
  render-icon.mjs       Renders icon + splash pages from the official whale path
  bundle-runtime.ps1    Copies node.exe + @deepseek-ai/dsh, overlays factory presets and web plugins, packs zip
  publish-release.ps1   Copies the NSIS installer into releases/<version>/ and updates the local ledger
bundle-runtime/         Unpacked runtime used by `tauri dev` (not shipped by the installer)
bundle-runtime.zip      Single-file runtime shipped as the Tauri resource
releases/               Local release ledger, notes, checksums (installer binaries gitignored)
src-tauri/              The Tauri (Rust) shell
```

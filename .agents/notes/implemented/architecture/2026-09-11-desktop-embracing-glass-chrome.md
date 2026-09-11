# Agent Note: Desktop embracing glass chrome

Status: implemented

English | [中文](2026-09-11-desktop-embracing-glass-chrome.zh.md)

## Problem

The Electron product window used a standard system title bar, so the Windows caption buttons sat on a separate strip from the Web UI. Custom min/max/close controls drawn over the conversation header then collided with session chrome, and dragging the window could resize it. The personal Tauri shell also wanted a frosted sidebar that samples the desktop, which a fully opaque client area cannot do.

The product window still needs native caption buttons so those controls cannot overlap Web UI. The glass plate that carries the title band and sidebar must fully surround the session waterfall, including a thin moat on the right and bottom. Only the session card's bottom-right corner sits in that equal-inset moat and must stay concentric with the plate; the other three corners use the plate radius. The OS chrome (taskbar, installer, `.exe`) must show the official whale, not Electron's default icon. The settings overlay is a sidebar descendant and must paint above the opaque session card.

## Decision

The main window keeps platform caption buttons through `titleBarStyle: 'hidden'` plus `titleBarOverlay` and an empty `title`, so the system draws min/max/close without an icon or application name. Overlay `color` stays transparent (`#00000000`) so the glass plate shows through the button cluster. Glyphs follow the resolved in-app scheme the theme presenter reports over IPC: white (`#ffffff`) when dark, `#61656b` when light. `nativeTheme.shouldUseDarkColors` is only the fallback before that report. Plugin windows keep a standard framed title bar. On Windows the product window also sets `backgroundMaterial: 'acrylic'` and a transparent `backgroundColor` so CSS `backdrop-filter` on the frame samples the desktop.

The app preload stamps `html.dsh-desktop` before first paint. Layout CSS then paints one glass plate across the frame (title band connected to the sidebar) and clips the conversation plus right panel into one opaque rounded stage. The stage is inset by `--dsh-desktop-stage-inset` (6px) on the left, right, and bottom, and by `caption-height + inset` on the top, so a thin glass moat shows on every side of the session card. Three stage corners use `--dsh-desktop-card-radius` (12px). The bottom-right corner uses `--dsh-desktop-stage-radius` (`max(0px, card-radius − inset)`). Maximized windows toggle `html.dsh-desktop-maximized`, which zeroes `--dsh-desktop-window-radius` on the plate and leaves the session-card radii unchanged. The sidebar column does not take a `z-index`; giving it one would trap the settings overlay (`position: fixed`, `z-index: 1000`) under the later sibling stage.

The `.exe`, NSIS shortcut, and unpackaged taskbar share `icons/icon.png`: the official favicon whale in white on a black rounded square. `BrowserWindow.icon` points at that PNG. On Windows the shell also calls `app.setAppUserModelId` (`DSH_DESKTOP_APP_ID` when packaging set it, otherwise `ai.deepseek.harness`) so the taskbar does not keep Electron's identity. `dev:desktop` runs `build:official` so the sidebar brand occupants register.

The stage wrapper is `display: contents` in the browser so the three-column grid is unchanged. Under `html.dsh-desktop` the frame is two columns (sidebar | stage) and the stage is an inner grid of centre | right track. A dedicated drag strip occupies the caption band to the right of the sidebar, sits above the overlay layer, and uses `-webkit-app-region: drag`; `html`/`body`/`#root` stay `overflow: visible` so Chromium does not drop that region. The session-list clip is a mask on the scrolling tree, not a fill overlay, so it cannot double-tint the glass plate.

Local Windows packaging may set `DSH_DESKTOP_ALLOW_UNSIGNED=1` to skip the EV token signer. That path is not a release artifact.

## Alternatives considered

**Driving caption glyphs from `nativeTheme.shouldUseDarkColors` alone.** Appearance can be dark while the OS stays light, so dark glyphs chosen for a light OS sit on the dark glass plate. Rejected; the overlay follows the resolved in-app scheme.

**An opaque caption-cluster fill.** A painted block on the glass plate. Rejected; overlay `color` stays transparent and dark-scheme glyphs are white.

**Setting `nativeTheme.themeSource` to match Appearance.** That also recolors file dialogs and other OS chrome owned by Electron. Rejected; only `setTitleBarOverlay` changes.

**Custom circular min/max/close over the conversation header.** Those controls sit in the same row as session chrome and overlap it; they also replace the platform caption hit targets. Rejected because the collision is the defect being fixed.

**A fully native title bar including icon and application name.** The system strip cannot share Acrylic with the sidebar, and the icon plus name duplicate the in-app brand. Rejected in favor of overlay caption buttons with an empty title.

**Matching every inner corner to the plate radius.** The bottom-right corner sits in the equal 6px moat, so identical radii pinch the glass there. Rejected for that corner; the other three corners sit far from the plate corners (caption band, sidebar) and use the plate radius.

**A `z-index` on the desktop sidebar column.** That stacking context traps `sidebar.settings` (viewport-fixed, `z-index: 1000`) under the session stage at the same z-index. Rejected; the sidebar column stays `z-index: auto` so the overlay participates in the frame stacking context.

**A fill overlay that fades the session list into sidebar tint.** That second mix sits on the glass plate and reads as a band above Settings. Rejected; the scrolling tree uses a mask so row pixels dissolve into the plate.

**Inset only the top and left (L-shaped glass).** That leaves the session card flush with the window on the right and bottom, so the plate does not surround the waterfall. Rejected; the moat is required on the right and bottom as well.

## Consequences

Browser `dsh web` sessions do not stamp `html.dsh-desktop`, so they keep the flush three-column frame. Windows 11 DWM may clip the window to an 8px outer corner that is tighter than the 12px plate token; the CSS relationship still keeps the bottom-right inner corner concentric with the plate we draw. Maximized and snapped windows square the plate; the session card keeps 12 / 12 / 6 / 12. Caption glyphs stay white on a dark in-app scheme even when the OS is light. Unpackaged development needs `BrowserWindow.icon` plus a Windows AppUserModelID, or the taskbar keeps Electron's icon. Unsigned local installers cannot participate in the signed update stream.

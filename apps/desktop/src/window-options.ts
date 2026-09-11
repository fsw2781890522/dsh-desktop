/** Main-window chrome: native caption buttons, no title-bar icon or name. */

import type { BrowserWindowConstructorOptions, TitleBarOverlay } from 'electron'
import { DESKTOP_APP_ICON_PATH } from './app-icon.ts'

/** Overlay strip height in CSS pixels; matches `env(titlebar-area-height)` fallback. */
export const DESKTOP_CAPTION_HEIGHT_PX = 38

/** Transparent caption-cluster fill so the glass plate shows through. */
export const DESKTOP_CAPTION_OVERLAY_COLOR = '#00000000'

/** Caption glyph ink when the in-app scheme is dark. */
export const DESKTOP_CAPTION_SYMBOL_COLOR_DARK = '#ffffff'

/** Caption glyph ink when the in-app scheme is light. */
export const DESKTOP_CAPTION_SYMBOL_COLOR_LIGHT = '#61656b'

/**
 * Choose caption-glyph contrast from the in-app scheme, falling back to the OS.
 * @param reported - Scheme the product renderer last reported, if any.
 * @param osDark - `nativeTheme.shouldUseDarkColors` before the renderer reports.
 * @returns whether caption glyphs use white ink.
 */
export function desktopCaptionUsesDarkSymbols(
  reported: 'light' | 'dark' | undefined,
  osDark: boolean,
): boolean {
  return reported === undefined ? osDark : reported === 'dark'
}

const SHARED_WINDOW_BOX = {
  width: 1280,
  height: 840,
  minWidth: 880,
  minHeight: 600,
  show: false,
  icon: DESKTOP_APP_ICON_PATH,
} as const

const ISOLATED_WEB_PREFERENCES = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
} as const

/**
 * Native caption-button overlay: transparent cluster, no icon, no application
 * name. Dark in-app scheme uses white glyphs; light uses dark glyphs.
 * @param dark - Whether caption glyphs should be white.
 * @returns Overlay fields for `BrowserWindow` / `setTitleBarOverlay`.
 */
export function desktopCaptionOverlay(dark: boolean): TitleBarOverlay {
  return {
    color: DESKTOP_CAPTION_OVERLAY_COLOR,
    symbolColor: dark ? DESKTOP_CAPTION_SYMBOL_COLOR_DARK : DESKTOP_CAPTION_SYMBOL_COLOR_LIGHT,
    height: DESKTOP_CAPTION_HEIGHT_PX,
  }
}

/**
 * Constructor options for the product window.
 * @param input - Preload path, caption contrast, and optional platform override.
 * @returns BrowserWindow fields: hidden title bar, overlay caption, Acrylic on Windows.
 */
export function desktopMainWindowOptions(input: {
  readonly preload: string
  readonly dark: boolean
  readonly platform?: NodeJS.Platform
}): BrowserWindowConstructorOptions {
  const platform = input.platform ?? process.platform
  const overlay = desktopCaptionOverlay(input.dark)
  return {
    ...SHARED_WINDOW_BOX,
    title: '',
    titleBarStyle: platform === 'linux' ? 'default' : 'hidden',
    ...(platform === 'linux' ? {} : { titleBarOverlay: overlay }),
    ...(platform === 'win32'
      ? { backgroundMaterial: 'acrylic' as const, autoHideMenuBar: true }
      : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: input.preload,
      ...ISOLATED_WEB_PREFERENCES,
    },
  }
}

/**
 * Constructor options for framed utility windows (plugin manager).
 * @param preload - Sandboxed preload for the utility renderer.
 * @returns A standard system-chrome BrowserWindow configuration.
 */
export function desktopUtilityWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    ...SHARED_WINDOW_BOX,
    webPreferences: {
      preload,
      ...ISOLATED_WEB_PREFERENCES,
    },
  }
}

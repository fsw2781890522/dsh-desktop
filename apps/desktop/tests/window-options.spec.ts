import { describe, expect, it } from 'vitest'
import { DESKTOP_APP_ICON_PATH } from '../src/app-icon.ts'
import {
  DESKTOP_CAPTION_HEIGHT_PX,
  DESKTOP_CAPTION_OVERLAY_COLOR,
  DESKTOP_CAPTION_SYMBOL_COLOR_DARK,
  DESKTOP_CAPTION_SYMBOL_COLOR_LIGHT,
  desktopCaptionOverlay,
  desktopCaptionUsesDarkSymbols,
  desktopMainWindowOptions,
  desktopUtilityWindowOptions,
} from '../src/window-options.ts'

describe('desktop window options', () => {
  it('hides the title-bar icon and name and keeps native caption buttons on Windows', () => {
    const options = desktopMainWindowOptions({
      preload: '/preload-app.cjs',
      dark: true,
      platform: 'win32',
    })
    expect(options).toMatchObject({
      title: '',
      icon: DESKTOP_APP_ICON_PATH,
      titleBarStyle: 'hidden',
      backgroundMaterial: 'acrylic',
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      titleBarOverlay: {
        color: DESKTOP_CAPTION_OVERLAY_COLOR,
        symbolColor: DESKTOP_CAPTION_SYMBOL_COLOR_DARK,
        height: DESKTOP_CAPTION_HEIGHT_PX,
      },
      webPreferences: {
        preload: '/preload-app.cjs',
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    })
  })

  it('uses light caption glyphs when the OS theme is light', () => {
    expect(desktopCaptionOverlay(false)).toMatchObject({
      color: DESKTOP_CAPTION_OVERLAY_COLOR,
      symbolColor: DESKTOP_CAPTION_SYMBOL_COLOR_LIGHT,
      height: DESKTOP_CAPTION_HEIGHT_PX,
    })
  })

  it('keeps a transparent overlay fill and white glyphs in the dark scheme', () => {
    expect(DESKTOP_CAPTION_OVERLAY_COLOR).toBe('#00000000')
    expect(DESKTOP_CAPTION_SYMBOL_COLOR_DARK).toBe('#ffffff')
    expect(desktopCaptionOverlay(true)).toMatchObject({
      color: DESKTOP_CAPTION_OVERLAY_COLOR,
      symbolColor: DESKTOP_CAPTION_SYMBOL_COLOR_DARK,
    })
  })

  it('prefers the reported in-app scheme over the OS theme', () => {
    expect(desktopCaptionUsesDarkSymbols('dark', false)).toBe(true)
    expect(desktopCaptionUsesDarkSymbols('light', true)).toBe(false)
    expect(desktopCaptionUsesDarkSymbols(undefined, true)).toBe(true)
    expect(desktopCaptionUsesDarkSymbols(undefined, false)).toBe(false)
  })

  it('keeps a standard framed utility window', () => {
    const options = desktopUtilityWindowOptions('/preload.cjs')
    expect(options.titleBarStyle).toBeUndefined()
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.backgroundMaterial).toBeUndefined()
    expect(options.icon).toBe(DESKTOP_APP_ICON_PATH)
    expect(options.webPreferences?.preload).toBe('/preload.cjs')
  })

  it('does not request a caption overlay on Linux', () => {
    const options = desktopMainWindowOptions({
      preload: '/preload-app.cjs',
      dark: true,
      platform: 'linux',
    })
    expect(options.titleBarStyle).toBe('default')
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.backgroundMaterial).toBeUndefined()
  })
})

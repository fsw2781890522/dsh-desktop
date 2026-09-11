// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DARK_ATTRIBUTE, ThemePresenter } from '@deepseek-ai/dsh-client-ui-layout/src/client/theme-presenter.ts'

const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

function snapshot(
  colorScheme: 'light' | 'dark',
  tokens: Record<string, string> = {},
  fontSize = 14,
  sidebarTransparency = 40,
): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return { preference: colorScheme, fontSize, sidebarTransparency, active, themes: [active], revision: 1 }
}

function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute('style')
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(() => {
  clearThemePresentation()
  document.documentElement.classList.remove('dsh-desktop')
  delete (globalThis as { dshDesktop?: unknown }).dshDesktop
})

describe('ThemePresenter', () => {
  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111', '--dsw-alias-fg': '#eee' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#111')
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('#eee')
    presenter.apply(snapshot('light', { '--dsw-alias-bg': '#fff' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('')
  })

  it('publishes the content font size and follows changes', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('14px')
    presenter.apply(snapshot('light', {}, 17))
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('17px')
  })

  it('projects sidebar transparency as the inverse tint opacity', () => {
    // The glass layer reads how opaque the sidebar fill is — the complement of
    // the preference — so 100% transparency leaves only the softened backdrop
    // and 0% renders the official opaque rail.
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', {}, 14, 55))
    expect(document.body.style.getPropertyValue('--dsh-sidebar-tint-opacity')).toBe('45%')
    presenter.apply(snapshot('dark', {}, 14, 20))
    expect(document.body.style.getPropertyValue('--dsh-sidebar-tint-opacity')).toBe('80%')
    presenter.apply(snapshot('light', {}, 14, 0))
    expect(document.body.style.getPropertyValue('--dsh-sidebar-tint-opacity')).toBe('100%')
    presenter.apply(snapshot('light', {}, 14, 100))
    expect(document.body.style.getPropertyValue('--dsh-sidebar-tint-opacity')).toBe('0%')
  })

  it('dispose removes color-scheme, the attribute, the font-size and tint axes, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111' }))
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('')
    expect(document.body.style.getPropertyValue('--dsh-sidebar-tint-opacity')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })

  it('reports the resolved scheme to the desktop caption overlay only in the product window', () => {
    const setColorScheme = vi.fn()
    ;(globalThis as { dshDesktop?: { setColorScheme: typeof setColorScheme } }).dshDesktop = { setColorScheme }
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    expect(setColorScheme).not.toHaveBeenCalled()
    document.documentElement.classList.add('dsh-desktop')
    presenter.apply(snapshot('dark'))
    expect(setColorScheme).toHaveBeenCalledTimes(1)
    expect(setColorScheme).toHaveBeenLastCalledWith('dark')
    presenter.apply(snapshot('light'))
    expect(setColorScheme).toHaveBeenLastCalledWith('light')
    document.documentElement.classList.remove('dsh-desktop')
    presenter.apply(snapshot('dark'))
    expect(setColorScheme).toHaveBeenCalledTimes(2)
  })

  it('does not throw when the desktop bridge is absent', () => {
    document.documentElement.classList.add('dsh-desktop')
    const presenter = new ThemePresenter()
    expect(() => { presenter.apply(snapshot('dark')) }).not.toThrow()
  })
})

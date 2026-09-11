/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome (scrollbars, form
 * controls), `body[data-ds-dark-theme]` for the token palette, the active
 * theme's alias-token overrides as inline CSS variables on body, the content
 * font-size axis (`--dsh-content-font-size`), the sidebar tint axis
 * (`--dsh-sidebar-tint-opacity`, the complement of the transparency
 * preference), and one presenter-owned `meta[name="theme-color"]` for
 * surrounding browser UI. Pure DOM writes, no React involvement; the presenter
 * only ever retracts what it wrote itself, so foreign attributes, metadata,
 * and inline styles survive.
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { DESKTOP_SHELL_CLASS } from './desktop-chrome.ts'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Body variable carrying the user's content font size in px. */
export const CONTENT_FONT_SIZE_VARIABLE = '--dsh-content-font-size'

/**
 * Body variable consumed by the native-backed sidebar tint surface
 * (ui-layout's own AppFrame column): how opaque the semantic sidebar fill is,
 * as the complement of the transparency preference.
 */
export const SIDEBAR_TINT_OPACITY_CSS_VARIABLE = '--dsh-sidebar-tint-opacity'

/** Optional product-window bridge used only when `html.dsh-desktop` is present. */
interface DesktopCaptionBridge {
  setColorScheme?(scheme: 'light' | 'dark'): void
}

/**
 * Report the resolved scheme to the Electron caption overlay when this document
 * is the product window. `dsh web` has no bridge and is a no-op.
 * @param scheme - Resolved `light` or `dark` from the theme snapshot.
 */
function notifyDesktopCaption(scheme: 'light' | 'dark'): void {
  if (!document.documentElement.classList.contains(DESKTOP_SHELL_CLASS)) return
  const desktop = (globalThis as { dshDesktop?: DesktopCaptionBridge }).dshDesktop
  desktop?.setColorScheme?.(scheme)
}

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor() {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme` (never the id — `system` is
   * resolved upstream), publish the content font-size axis and the sidebar
   * tint axis, then replace the previously applied token variables with
   * `active.tokens`. Browser theme-color metadata follows the computed body
   * background after those writes, so the rendered palette remains the color
   * authority. Under `html.dsh-desktop` the resolved scheme is also reported
   * to the Electron caption overlay.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.style.setProperty(CONTENT_FONT_SIZE_VARIABLE, `${snapshot.fontSize}px`)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    // The preference counts how much native/background surface stays visible
    // through the sidebar; the tint stylesheet needs the complement. 0% is the
    // fully opaque sidebar, 100% leaves only the softened frame.
    body.style.setProperty(
      SIDEBAR_TINT_OPACITY_CSS_VARIABLE,
      `${100 - snapshot.sidebarTransparency}%`,
    )
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
    notifyDesktopCaption(scheme)
  }

  /**
   * Retract root color-scheme, the palette attribute, token variables,
   * the font-size and sidebar-tint axes, and the owned metadata node.
   */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.style.removeProperty(CONTENT_FONT_SIZE_VARIABLE)
    body.style.removeProperty(SIDEBAR_TINT_OPACITY_CSS_VARIABLE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
  }
}

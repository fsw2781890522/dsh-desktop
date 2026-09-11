/**
 * Desktop shell layout constants. The Electron preload stamps
 * {@link DESKTOP_SHELL_CLASS} on `html` before first paint; the pixel values
 * must stay identical to `packages/client/web/src/base.css`.
 */

/** Class the Electron app preload adds to `document.documentElement`. */
export const DESKTOP_SHELL_CLASS = 'dsh-desktop'

/** Thin glass moat around the session stage, in CSS pixels. */
export const DESKTOP_STAGE_INSET_PX = 6

/** Outer glass-plate corner radius, in CSS pixels. Squared when maximized. */
export const DESKTOP_WINDOW_RADIUS_PX = 12

/** Session-stage corners that do not sit in the equal-inset moat, in CSS pixels. */
export const DESKTOP_CARD_RADIUS_PX = DESKTOP_WINDOW_RADIUS_PX

/** Inner bottom-right session-stage radius: concentric with the restored plate (`card − inset`). */
export const DESKTOP_STAGE_RADIUS_PX = DESKTOP_CARD_RADIUS_PX - DESKTOP_STAGE_INSET_PX

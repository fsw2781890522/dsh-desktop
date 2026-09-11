/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the conversation content font size. */
export const FONT_SIZE_FIELD = 'fontSize'

/** Field carrying the persisted sidebar transparency percentage. */
export const SIDEBAR_TRANSPARENCY_FIELD = 'sidebarTransparency'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Smallest accepted content font size (px). */
export const FONT_SIZE_MIN = 12

/** Largest accepted content font size (px). */
export const FONT_SIZE_MAX = 17

/** Content font size when the user-settings document has no override (px). */
export const DEFAULT_FONT_SIZE = 14

/** Least transparent sidebar (percent); 0 keeps the opaque semantic fill. */
export const SIDEBAR_TRANSPARENCY_MIN = 0

/** Most transparent sidebar (percent); 100 leaves no tint at all. */
export const SIDEBAR_TRANSPARENCY_MAX = 100

/** Sidebar transparency when the user-settings document has no override (percent). */
export const DEFAULT_SIDEBAR_TRANSPARENCY = 40

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Conversation content font size in px (integer within {@link FONT_SIZE_MIN}..{@link FONT_SIZE_MAX}). */
  fontSize: number
  /** Sidebar transparency in percent (integer within {@link SIDEBAR_TRANSPARENCY_MIN}..{@link SIDEBAR_TRANSPARENCY_MAX}). */
  sidebarTransparency: number
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [FONT_SIZE_FIELD]: z.number().step(1).min(FONT_SIZE_MIN).max(FONT_SIZE_MAX).default(DEFAULT_FONT_SIZE),
  [SIDEBAR_TRANSPARENCY_FIELD]: z.number()
    .step(1)
    .min(SIDEBAR_TRANSPARENCY_MIN)
    .max(SIDEBAR_TRANSPARENCY_MAX)
    .default(DEFAULT_SIDEBAR_TRANSPARENCY),
})

/**
 * Clamp one sidebar-transparency write to the accepted percent range. The
 * range input only ever emits integers inside the range, but an untyped caller
 * (or a settings document written by an older build) crosses this boundary too,
 * so a junk value falls back to the default instead of corrupting the tint.
 * @param value - value crossing the settings or slider boundary.
 * @returns an integer percentage within SIDEBAR_TRANSPARENCY_MIN..SIDEBAR_TRANSPARENCY_MAX.
 */
export function normalizeSidebarTransparency(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_TRANSPARENCY
  return Math.min(
    SIDEBAR_TRANSPARENCY_MAX,
    Math.max(SIDEBAR_TRANSPARENCY_MIN, Math.round(value)),
  )
}

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

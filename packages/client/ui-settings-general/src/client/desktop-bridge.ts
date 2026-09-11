/** Desktop-shell bridge injected as `window.__DSH_DESKTOP__`. Absent in `dsh web`. */

/** Bilingual installer notes from the channel index. */
export interface DesktopUpdateNotes {
  /** Simplified Chinese notes shown in a zh UI. */
  readonly zh: string
  /** English notes shown in a non-zh UI. */
  readonly en: string
}

/** Result of `checkUpdate()`. */
export type DesktopUpdateCheck =
  | { readonly status: 'current'; readonly current: string }
  | {
    readonly status: 'available'
    readonly current: string
    readonly latest: string
    readonly notes: DesktopUpdateNotes
    readonly size: number
    readonly kind: 'nsis' | 'runtime-zip'
  }
  | { readonly status: 'unavailable'; readonly current: string; readonly reason: string }

/** Download/install progress frames the shell may emit. */
export interface DesktopUpdateProgress {
  readonly phase: 'download' | 'verify' | 'launch'
  readonly received: number
  readonly total: number | null
}

/** Tauri-injected update API. */
export interface DshDesktopBridge {
  /** Shell semver (`tauri.conf.json` / Cargo package version). */
  readonly version: string
  /** Fetch the channel index and compare with `version`. */
  checkUpdate: () => Promise<DesktopUpdateCheck>
  /** Download the last available artifact, verify it, launch the installer, exit. */
  installUpdate: () => Promise<void>
}

/**
 * Read the desktop bridge when the Tauri shell injected it.
 * @returns the bridge, or `null` in a plain browser Host.
 */
export function desktopBridge(): DshDesktopBridge | null {
  const value = (globalThis as { __DSH_DESKTOP__?: DshDesktopBridge }).__DSH_DESKTOP__
  if (value === undefined || typeof value.checkUpdate !== 'function') return null
  return value
}

/**
 * Pick notes for the active document language.
 * @param notes - bilingual channel notes.
 * @returns the matching language, falling back to Chinese then English.
 */
export function notesForDocument(notes: DesktopUpdateNotes): string {
  const lang = typeof document === 'undefined' ? 'zh' : document.documentElement.lang
  const text = /^zh\b/i.test(lang) ? notes.zh : notes.en
  if (text.trim() !== '') return text
  return notes.zh.trim() !== '' ? notes.zh : notes.en
}

/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  colorSchemeSet: 'dsh-desktop:color-scheme-set',
  localeGet: 'dsh-desktop:locale-get',
  pluginsList: 'dsh-desktop:plugins-list',
  pluginsAdd: 'dsh-desktop:plugins-add',
  pluginsRemove: 'dsh-desktop:plugins-remove',
  pluginsUpdate: 'dsh-desktop:plugins-update',
  updatesCheck: 'dsh-desktop:updates-check',
  updatesInstall: 'dsh-desktop:updates-install',
  updatesState: 'dsh-desktop:updates-state',
} as const

/** Resolved color scheme the product renderer may report for caption contrast. */
export type DesktopColorScheme = 'light' | 'dark'

/**
 * Accept only a resolved light/dark scheme from the product renderer.
 * @param value - Untrusted IPC payload.
 * @returns the scheme.
 */
export function parseDesktopColorScheme(value: unknown): DesktopColorScheme {
  if (value === 'light' || value === 'dark') return value
  throw new Error('dsh desktop: color scheme must be light or dark')
}

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/**
 * Product-window bridge: protocol marker plus caption contrast.
 * Plugin-management windows use {@link DshDesktopApi} instead.
 */
export interface DshDesktopAppApi {
  readonly protocolVersion: 1
  /**
   * Report the resolved in-app color scheme so caption glyphs can follow Appearance.
   * @param scheme - `light` or `dark` after `system` has been resolved.
   */
  setColorScheme(scheme: DesktopColorScheme): void
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

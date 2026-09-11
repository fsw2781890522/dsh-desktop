/** Desktop-only General row: check the update channel and install a newer NSIS. */

import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  desktopBridge,
  notesForDocument,
  type DesktopUpdateCheck,
} from './desktop-bridge.ts'
import css from './DesktopUpdateRow.module.css'

/** Full component props: empty owner share plus the settings locale seat. */
export type DesktopUpdateRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>

type RowState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'checking' }
  | { readonly phase: 'result'; readonly check: DesktopUpdateCheck }
  | { readonly phase: 'installing'; readonly check: DesktopUpdateCheck }

/**
 * Render the desktop update row. Returns null when the Tauri bridge is absent.
 * @param props - composed Settings slot props.
 * @returns the row, or null outside the desktop WebView.
 */
export function DesktopUpdateRow({ t }: DesktopUpdateRowProps) {
  const bridge = desktopBridge()
  const [state, setState] = useState<RowState>({ phase: 'idle' })
  if (bridge === null) return null

  const busy = state.phase === 'checking' || state.phase === 'installing'
  const check = state.phase === 'result' || state.phase === 'installing'
    ? state.check
    : undefined

  const runCheck = (): void => {
    setState({ phase: 'checking' })
    void bridge.checkUpdate().then(
      (next) => { setState({ phase: 'result', check: next }) },
      (error: unknown) => {
        setState({
          phase: 'result',
          check: {
            status: 'unavailable',
            current: bridge.version,
            reason: error instanceof Error ? error.message : String(error),
          },
        })
      },
    )
  }

  const runInstall = (shown: DesktopUpdateCheck): void => {
    setState({ phase: 'installing', check: shown })
    void bridge.installUpdate().then(
      () => { /* the shell exits; nothing further to render */ },
      (error: unknown) => {
        setState({
          phase: 'result',
          check: {
            status: 'unavailable',
            current: bridge.version,
            reason: error instanceof Error ? error.message : String(error),
          },
        })
      },
    )
  }

  let status = t('update.idle')
  if (state.phase === 'checking') status = t('update.checking')
  else if (state.phase === 'installing') status = t('update.installing')
  else if (check?.status === 'current') status = t('update.current')
  else if (check?.status === 'available') {
    status = t('update.available', { version: check.latest })
  } else if (check?.status === 'unavailable') {
    status = t('update.unavailable', { reason: check.reason })
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('update.title')}</div>
        <div className={css.desc} role="status">
          {t('update.currentVersion', { version: bridge.version })}
          {' · '}
          {status}
        </div>
        {check?.status === 'available' && (
          <div className={css.notes}>{notesForDocument(check.notes)}</div>
        )}
      </div>
      {check?.status === 'available'
        ? (
          <button
            type="button"
            className={css.action}
            disabled={busy}
            onClick={() => { runInstall(check) }}
          >
            {state.phase === 'installing' ? t('update.installing') : t('update.install')}
          </button>
        )
        : (
          <button type="button" className={css.action} disabled={busy} onClick={runCheck}>
            {state.phase === 'checking' ? t('update.checking') : t('update.check')}
          </button>
        )}
    </div>
  )
}

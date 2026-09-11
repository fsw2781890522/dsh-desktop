/**
 * Ownerless General row: local HTTP proxy TCP port used by process fetch and
 * the desktop updater. Does not enable or disable agent tools.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createProxyPortStore } from './proxy-port-store.ts'
import { parsePortDraft } from './proxy-port.ts'
import css from './ProxyPortRow.module.css'

/** Injected business face: persist the chosen port. */
export interface ProxyPortRowInjected {
  /** Write `http-proxy.port` through the settings scope. */
  setPort: (port: number) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ProxyPortRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createProxyPortStore>>
  & PropsLocale<'settings'> & ProxyPortRowInjected

/**
 * Render the Proxy port row.
 * @param props - composed Settings slot props.
 * @returns the row element tree.
 */
export function ProxyPortRow({ t, setPort, useStore }: ProxyPortRowComponentProps) {
  const port = useStore(s => s.port)
  const writable = useStore(s => s.writable)
  const [draft, setDraft] = useState(String(port))
  const parsed = parsePortDraft(draft)
  const invalid = parsed === undefined

  useEffect(() => {
    setDraft(String(port))
  }, [port])

  const commit = (): void => {
    if (parsed === undefined || parsed === port) return
    setPort(parsed)
  }

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('proxy.title')}</div>
        <div className={css.desc}>{t('proxy.description')}</div>
        {invalid ? <div className={css.error}>{t('proxy.invalid')}</div> : null}
      </div>
      <Input
        className={css.input ?? ''}
        id="dsh-proxy-port"
        name="proxy-port"
        inputMode="numeric"
        autoComplete="off"
        aria-label={t('proxy.title')}
        aria-invalid={invalid}
        disabled={!writable}
        value={draft}
        onChange={(event) => { setDraft(event.target.value) }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

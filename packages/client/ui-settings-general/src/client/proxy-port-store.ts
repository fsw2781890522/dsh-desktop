/**
 * Proxy port row slot store: a mirror of the `http-proxy` settings snapshot.
 * The plugin's apply-world subscriber is the only writer; the row reads via
 * props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_PROXY_PORT } from './proxy-port.ts'

/** Store state mirrored from the Host `http-proxy` section. */
export interface ProxyPortRowState {
  /** Persisted local HTTP proxy TCP port. */
  port: number
  /** Whether the Host document accepts writes. */
  writable: boolean
  /** Monotonic sync generation; -1 until first sync so generation 0 lands. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type ProxyPortRowActions = {
  sync: (draft: ProxyPortRowState, port: number, writable: boolean, revision: number) => void
}

/**
 * Declares the Proxy port row state and write surface.
 * @returns the store handle.
 */
export function createProxyPortStore(): EngineStoreHandle<ProxyPortRowState, ProxyPortRowActions> {
  return defineStore({
    init: (): ProxyPortRowState => ({
      port: DEFAULT_PROXY_PORT,
      writable: false,
      revision: -1,
    }),
    actions: {
      sync: (d, port: number, writable: boolean, revision: number) => {
        if (revision <= d.revision) return
        d.port = port
        d.writable = writable
        d.revision = revision
      },
    },
  })
}

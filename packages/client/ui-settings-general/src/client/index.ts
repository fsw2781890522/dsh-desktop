/**
 * Settings shell and ownerless-copy plugin, browser half: renders the
 * `sidebar.settings` occupant — panel chrome, section navigation, and the
 * onboarding stage — and registers everything on the Settings pages that
 * belongs to no single feature: the trigger/header chrome content,
 * local-document action, General section, the parent/child default-model row,
 * the process HTTP proxy-port row,
 * the desktop update row when the Tauri shell injected `window.__DSH_DESKTOP__`,
 * and `settings` dictionaries. Feature-owned rows and sections stay with their
 * features. Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge and its fixed Host facts.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { resolveSlotLabel, type BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge and bound-scope contract. Cross-plugin collaboration goes through the
// service, never a value import (client bundle purity gate).
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls ctx.locale into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {
  SettingsOnboardingStep, SettingsRootInjected, SettingsSectionRow,
} from './shell-contract.ts'
import { SettingsRoot } from './SettingsRoot.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from './chrome.tsx'
import { GeneralSection } from './GeneralSection.tsx'
import { SettingsDocumentAction } from './SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from './SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from './settings-document-store.ts'
import { DesktopUpdateRow } from './DesktopUpdateRow.tsx'
import { desktopBridge } from './desktop-bridge.ts'
import { ProxyPortRow } from './ProxyPortRow.tsx'
import type { ProxyPortRowInjected } from './ProxyPortRow.tsx'
import { createProxyPortStore } from './proxy-port-store.ts'
import { DEFAULT_PROXY_PORT, HTTP_PROXY_SETTINGS_NAMESPACE } from './proxy-port.ts'
import { DefaultModelsRow, createDefaultModelsStore } from './DefaultModelsRow.tsx'
import type { DefaultModelSelection, DefaultModelsRowInjected, DefaultModelValues } from './DefaultModelsRow.tsx'
import { en, zh, type SettingsKey } from './locales.ts'

/** Durable `http-proxy` section mirrored by the General Proxy port row. */
interface HttpProxySettings {
  /** Local HTTP proxy TCP port. */
  port: number
}

/**
 * Settings namespaces the Default models row binds. Literal strings: a Client
 * plugin never imports a Host package, so the namespace identity cannot come
 * from `@deepseek-ai/dsh-agent-default-model` / `-subagent-default-model`.
 */
const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'
const SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'subagent-default-model'

/** Durable default-model section shape shared by both namespaces. */
interface DefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort; absent means the model's own default. */
  reasoningEffort?: string
}

/**
 * Store one submitted selection in a default-model namespace: both required
 * scalars, plus the effort, which an emptied field clears so the selected
 * model's own default applies again.
 * @param host - the bound namespace scope.
 * @param selection - the provider, model, and effort the row submitted.
 * @returns whether the durable section carries the requested selection afterwards.
 */
async function writeDefaultModel(
  host: SettingsScope<DefaultModelSettings>,
  selection: DefaultModelSelection,
): Promise<boolean> {
  const effort = selection.effort.trim()
  await Promise.all([
    host.set('provider', selection.provider),
    host.set('model', selection.model),
    effort === '' ? host.unset('reasoningEffort') : host.set('reasoningEffort', effort),
  ])
  const stored = host.getSnapshot().value
  return stored?.provider === selection.provider
    && stored.model === selection.model
    && (stored.reasoningEffort ?? '') === effort
}

export type {
  CloseLabelProps, HeaderContentProps, TriggerContentProps,
} from './chrome.tsx'
export type {
  GeneralSectionComponentProps,
} from './GeneralSection.tsx'
export type { SettingsDocumentActionInjected, SettingsDocumentActionProps } from './SettingsDocumentAction.tsx'
export type { SettingsDocumentState } from './settings-document-store.ts'
export { SettingsDocumentStore } from './settings-document-store.ts'
export type { SettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Shell chrome, General copy, proxy-port row, and the desktop update row. */
    settings: SettingsKey
  }
}

/** Dictionary namespace owned by this plugin (shell chrome + General copy). */
const NS = 'settings'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registrations depend on their slots through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.settings', 'settingsScope']

/**
 * Register the `settings` dictionaries, the chrome content, and the General
 * section, each once its slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-general: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle

  // Copy freshness is framework-owned: components read the standard `t`
  // seat, and the nav label is a thunk the owner resolves per render — no
  // locale/change re-registration wiring.
  const t = ctx.locale.bind(NS)
  // The shared SettingsScope mirror updates after document commits and reconnects.
  const documentController = ctx.remote.$host.isLoopback
    ? new SettingsDocumentStore(ctx, ctx.settingsScope.describe())
    : undefined
  const documentInjected = documentController === undefined
    ? undefined
    : (): SettingsDocumentActionInjected => ({
      controller: documentController,
      hooks: { snapshot: documentController.store },
    })
  ctx.effect(() => () => { documentController?.dispose() }, 'ui-settings-general: document action directory')
  // The settings shell: this package occupies the sidebar-owned hole and
  // declares the settings slots. Ledger → nav-row projection as an observable
  // source (uSES contract: getSnapshot returns the cached rows until the
  // ledger version moves). Labels may be locale-following thunks, so the cache
  // key includes the locale revision and subscribers ride both sources.
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []
  let onboardingVersion = -1
  let onboardingSteps: readonly SettingsOnboardingStep[] = []
  const shellInjected = (): SettingsRootInjected => ({
    reconnect: () => { connection.reconnect() },
    hooks: {
      connectionState: connection.state,
      sections: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.section')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== rowsVersion || revision !== rowsRevision) {
            rowsVersion = version
            rowsRevision = revision
            rows = ctx.slots.entries('settings.section')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id (SlotCore rejects an entry without one) */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
                label: resolveSlotLabel(e.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return rows
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.section', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
      onboardingSteps: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.onboarding')
          if (version !== onboardingVersion) {
            onboardingVersion = version
            onboardingSteps = ctx.slots.entries('settings.onboarding')
              .map(e => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: e.options.id ?? '',
                order: e.options.order ?? 0,
              }))
              .sort((a, b) => a.order - b.order)
          }
          return onboardingSteps
        },
        subscribe: listener => ctx.slots.subscribe('settings.onboarding', listener),
      },
    },
  })
  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    locale: NS,
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.onboarding': { kind: 'list', scope: 'root' },
    },
    inject: shellInjected,
  }, SettingsRoot))

  ctx.slots.inject('settings.trigger', () =>
    ctx.slots.register({ name: 'settings.trigger', locale: NS }, TriggerContent))
  ctx.slots.inject('settings.header', () =>
    ctx.slots.register({ name: 'settings.header', locale: NS }, HeaderContent))
  if (documentInjected !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'open-document',
      order: 0,
      locale: NS,
      inject: documentInjected,
    }, SettingsDocumentAction))
  }
  ctx.slots.inject('settings.close', () =>
    ctx.slots.register({ name: 'settings.close', locale: NS }, CloseLabel))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    locale: NS,
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, GeneralSection))
  ctx.inject(['settingsScope'], (scoped) => {
    const host = scoped.settingsScope.bind<HttpProxySettings>({
      namespace: HTTP_PROXY_SETTINGS_NAMESPACE,
    })
    const store = createProxyPortStore()
    let bound: BoundActions<typeof store> | undefined
    let generation = 0
    const sync = (): void => {
      generation += 1
      const snap = host.getSnapshot()
      bound?.sync(snap.value?.port ?? DEFAULT_PROXY_PORT, snap.writable, generation)
    }
    scoped.effect(() => host.subscribe(sync), 'ui-settings-general: http-proxy port')
    const injected = (actions: BoundActions<typeof store>): ProxyPortRowInjected => {
      bound = actions
      sync()
      return {
        setPort: (port) => { void host.set('port', port) },
      }
    }
    scoped.slots.inject('settings.general.item', () => scoped.slots.register({
      name: 'settings.general.item',
      id: 'proxy-port',
      order: 80,
      store,
      locale: NS,
      inject: injected,
    }, ProxyPortRow))
  })
  if (desktopBridge() !== null) {
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'desktop-update',
      order: 90,
      locale: NS,
    }, DesktopUpdateRow))
  }
  // The two default-model namespaces are bound together because one row edits
  // both; a deployment that composes neither still renders the row, whose
  // groups then report the namespace as unavailable.
  ctx.inject(['settingsScope'], (scoped) => {
    const agentHost = scoped.settingsScope.bind<DefaultModelSettings>({
      namespace: AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
    })
    const subagentHost = scoped.settingsScope.bind<DefaultModelSettings>({
      namespace: SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
    })
    const store = createDefaultModelsStore()
    let bound: BoundActions<typeof store> | undefined
    let agentGeneration = 0
    let subagentGeneration = 0
    const values = (host: SettingsScope<DefaultModelSettings>): DefaultModelValues => {
      const snapshot = host.getSnapshot()
      return {
        status: snapshot.status,
        provider: snapshot.value?.provider ?? '',
        model: snapshot.value?.model ?? '',
        effort: snapshot.value?.reasoningEffort ?? '',
        writable: snapshot.writable,
      }
    }
    const syncAgent = (): void => {
      agentGeneration += 1
      bound?.syncAgent(values(agentHost), agentGeneration)
    }
    const syncSubagent = (): void => {
      subagentGeneration += 1
      bound?.syncSubagent(values(subagentHost), subagentGeneration)
    }
    scoped.effect(() => agentHost.subscribe(syncAgent), 'ui-settings-general: agent default model')
    scoped.effect(() => subagentHost.subscribe(syncSubagent), 'ui-settings-general: subagent default model')
    const injected = (actions: BoundActions<typeof store>): DefaultModelsRowInjected => {
      bound = actions
      // Re-sync from the getters so no snapshot is lost between binding and the
      // first render (the store's generation guard drops stale duplicates).
      syncAgent()
      syncSubagent()
      return {
        saveAgent: selection => writeDefaultModel(agentHost, selection),
        saveSubagent: selection => writeDefaultModel(subagentHost, selection),
      }
    }
    scoped.slots.inject('settings.general.item', () => scoped.slots.register({
      name: 'settings.general.item',
      id: 'default-models',
      order: 70,
      store,
      locale: NS,
      inject: injected,
    }, DefaultModelsRow))
  })
}

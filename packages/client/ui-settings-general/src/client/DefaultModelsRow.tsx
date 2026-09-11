/**
 * Ownerless General row: the default model for the top-level Agent and for
 * delegated subagents, each saved to its own settings namespace. Provider and
 * model stay plain text fields — the model catalog is a per-session service, so
 * a global settings row cannot depend on it.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DefaultModelsRow.module.css'

/** Client-side sync state of one default-model namespace. */
export type DefaultModelGroupStatus = 'loading' | 'ready' | 'unavailable'

/** One group's mirrored namespace snapshot plus its own sync generation. */
export interface DefaultModelGroup {
  /** Whether the namespace is exposed to this deployment's client. */
  status: DefaultModelGroupStatus
  /** Saved provider route. */
  provider: string
  /** Saved provider-owned model id. */
  model: string
  /** Saved adapter-owned reasoning effort; empty means the model's own default. */
  effort: string
  /** Whether the Host settings document accepts writes. */
  writable: boolean
  /** Monotonic sync generation; -1 until first sync so generation 0 lands. */
  revision: number
}

/** Store state mirrored from both default-model namespaces. */
export interface DefaultModelsRowState {
  /** The `agent-default-model` group (top-level Agent default). */
  agent: DefaultModelGroup
  /** The `subagent-default-model` group (delegated child default). */
  subagent: DefaultModelGroup
}

/** Values mirrored out of one namespace snapshot. */
export interface DefaultModelValues {
  /** Whether the namespace is exposed to this deployment's client. */
  status: DefaultModelGroupStatus
  /** Saved provider route. */
  provider: string
  /** Saved provider-owned model id. */
  model: string
  /** Saved adapter-owned reasoning effort; empty means the model's own default. */
  effort: string
  /** Whether the Host settings document accepts writes. */
  writable: boolean
}

/** Store state before the first namespace snapshot arrives. */
function emptyGroup(): DefaultModelGroup {
  return { status: 'loading', provider: '', model: '', effort: '', writable: false, revision: -1 }
}

/** Adopt one namespace snapshot unless a newer generation already landed. */
function adopt(target: DefaultModelGroup, values: DefaultModelValues, revision: number): DefaultModelGroup {
  return revision <= target.revision ? target : { ...values, revision }
}

/** Declared action shape giving the exported factory a stable return type. */
type DefaultModelsRowActions = {
  syncAgent: (draft: DefaultModelsRowState, values: DefaultModelValues, revision: number) => void
  syncSubagent: (draft: DefaultModelsRowState, values: DefaultModelValues, revision: number) => void
}

/**
 * Declares the two mirrored default-model groups.
 * @returns the store handle.
 */
export function createDefaultModelsStore(): EngineStoreHandle<DefaultModelsRowState, DefaultModelsRowActions> {
  return defineStore({
    init: (): DefaultModelsRowState => ({ agent: emptyGroup(), subagent: emptyGroup() }),
    actions: {
      syncAgent: (d, values, revision) => { d.agent = adopt(d.agent, values, revision) },
      syncSubagent: (d, values, revision) => { d.subagent = adopt(d.subagent, values, revision) },
    },
  })
}

/** One selection as the row submits it; an empty effort clears the stored one. */
export interface DefaultModelSelection {
  /** Provider route the user typed. */
  provider: string
  /** Model id the user typed. */
  model: string
  /** Reasoning effort the user typed, or empty for the model's own default. */
  effort: string
}

/** Injected business face: persist each group through its own namespace. */
export interface DefaultModelsRowInjected {
  /**
   * Save the Agent group.
   * @param selection - the provider, model, and effort to store.
   * @returns whether the durable section now carries the requested selection.
   */
  saveAgent: (selection: DefaultModelSelection) => Promise<boolean>
  /**
   * Save the Subagent group.
   * @param selection - the provider, model, and effort to store.
   * @returns whether the durable section now carries the requested selection.
   */
  saveSubagent: (selection: DefaultModelSelection) => Promise<boolean>
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type DefaultModelsRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createDefaultModelsStore>>
  & PropsLocale<'settings'> & DefaultModelsRowInjected

/** Where one group's last save attempt stands. */
type SavePhase = 'idle' | 'saving' | 'saved' | 'failed'

/** One editable group's props. */
interface ModelGroupEditorProps {
  /** Translate seat of the settings namespace. */
  t: DefaultModelsRowComponentProps['t']
  /** Discriminator keeping this group's field ids unique in one document. */
  scope: 'agent' | 'subagent'
  /** Group heading copy. */
  heading: string
  /** Mirrored namespace snapshot. */
  group: DefaultModelGroup
  /** Persist this group's selection. */
  save: (selection: DefaultModelSelection) => Promise<boolean>
}

/**
 * Render one provider/model/effort editor over a mirrored namespace snapshot.
 * Drafts live in component state; the mirror re-seeds them whenever the Host
 * document changes, so a write from another surface is never shadowed.
 * @param props - group identity, heading, mirrored snapshot, translate seat, and save path.
 * @returns the group element tree.
 */
function ModelGroupEditor({ t, scope, heading, group, save }: ModelGroupEditorProps) {
  const [provider, setProvider] = useState(group.provider)
  const [model, setModel] = useState(group.model)
  const [effort, setEffort] = useState(group.effort)
  const [phase, setPhase] = useState<SavePhase>('idle')

  useEffect(() => {
    setProvider(group.provider)
    setModel(group.model)
    setEffort(group.effort)
  }, [group])

  if (group.status === 'unavailable') {
    return (
      <div className={css.group}>
        <div className={css.heading}>{heading}</div>
        <div className={css.unavailable} role="status">{t('defaults.unavailable')}</div>
      </div>
    )
  }

  const editable = group.status === 'ready' && group.writable
  const dirty = provider !== group.provider || model !== group.model || effort !== group.effort
  const complete = provider.trim() !== '' && model.trim() !== ''
  const canSave = editable && complete && dirty && phase !== 'saving'

  const commit = (): void => {
    if (!canSave) return
    setPhase('saving')
    void save({ provider: provider.trim(), model: model.trim(), effort: effort.trim() }).then(
      (accepted) => { setPhase(accepted ? 'saved' : 'failed') },
      () => { setPhase('failed') },
    )
  }

  return (
    <div className={css.group}>
      <div className={css.heading}>{heading}</div>
      <div className={css.fields}>
        <label className={css.field}>
          <span className={css.fieldName}>{t('defaults.provider')}</span>
          <Input
            className={css.input ?? ''}
            id={`dsh-default-${scope}-provider`}
            autoComplete="off"
            spellCheck={false}
            disabled={!editable}
            value={provider}
            onChange={(event) => { setProvider(event.target.value); setPhase('idle') }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldName}>{t('defaults.model')}</span>
          <Input
            className={css.input ?? ''}
            id={`dsh-default-${scope}-model`}
            autoComplete="off"
            spellCheck={false}
            disabled={!editable}
            value={model}
            onChange={(event) => { setModel(event.target.value); setPhase('idle') }}
          />
        </label>
        <label className={css.field}>
          <span className={css.fieldName}>{t('defaults.effort')}</span>
          <Input
            className={css.effort ?? ''}
            id={`dsh-default-${scope}-effort`}
            autoComplete="off"
            spellCheck={false}
            disabled={!editable}
            value={effort}
            placeholder={t('defaults.effortHint')}
            onChange={(event) => { setEffort(event.target.value); setPhase('idle') }}
          />
        </label>
      </div>
      <div className={css.actions}>
        <button type="button" className={css.action} disabled={!canSave} onClick={commit}>
          {phase === 'saving' ? t('defaults.saving') : t('defaults.save')}
        </button>
        {phase === 'saved' ? <span className={css.status} role="status">{t('defaults.saved')}</span> : null}
        {phase === 'failed' ? <span className={css.error} role="alert">{t('defaults.saveFailed')}</span> : null}
        {!complete && dirty ? <span className={css.error}>{t('defaults.invalid')}</span> : null}
      </div>
    </div>
  )
}

/**
 * Render the Default models row.
 * @param props - composed Settings slot props.
 * @returns the row element tree.
 */
export function DefaultModelsRow({ t, saveAgent, saveSubagent, useStore }: DefaultModelsRowComponentProps) {
  const agent = useStore(s => s.agent)
  const subagent = useStore(s => s.subagent)
  return (
    <div className={css.row}>
      <div className={css.title}>{t('defaults.title')}</div>
      <div className={css.desc}>{t('defaults.description')}</div>
      <div className={css.groups}>
        <ModelGroupEditor
          t={t}
          scope="agent"
          heading={t('defaults.agent.title')}
          group={agent}
          save={saveAgent}
        />
        <ModelGroupEditor
          t={t}
          scope="subagent"
          heading={t('defaults.subagent.title')}
          group={subagent}
          save={saveSubagent}
        />
      </div>
    </div>
  )
}

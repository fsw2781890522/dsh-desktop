/**
 * Default model selection for delegated children.
 *
 * Paired with `agent-default-model`, this is the parent/child model preset
 * seam: a top-level Agent resolves from `agent-default-model`, while every
 * child a delegation creates starts on this selection unless the request
 * names a provider or model of its own.
 *
 * @module @deepseek-ai/dsh-subagent-default-model
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type {
  SubagentRuntime,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for delegated children created without an explicit route. */
    subagentDefaultModel: SubagentDefaultModelConfig
  }
}

/** Settings namespace carrying the default model selection for future subagents. */
export const SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'subagent-default-model'

/** Stored and composed default model selection for delegated children. */
export interface SubagentDefaultModelSettings {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: string
}

/** Schema of the default subagent model settings section. */
export const SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA: z<SubagentDefaultModelSettings> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/** Composition entry for the default subagent model selection. */
export interface Config {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: SubagentDefaultModelSettings): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Whether one live Agent is a delegated child. Both in-process children and
 * resumed ones carry the durable session header this reads, so the check needs
 * no lineage walk.
 * @param agent - the Agent making a request.
 * @returns whether the Agent is a subagent.
 */
function isSubagent(agent: Agent): boolean {
  const header = agent.session.header
  if (header.origin === 'subagent') return true
  const depth = header.delegationDepth
  return depth !== undefined && Number.isSafeInteger(depth) && depth > 0
}

/**
 * Add the configured route to one delegation request that names none. An
 * explicit provider or model always wins, field by field, and a composer that
 * cannot accept child `AgentOptions` keeps its request untouched: the one-shot
 * registry validates that capability before delegating, so injecting a route
 * there would reject an otherwise valid delegation instead of routing it.
 *
 * Generic over the caller's request shape rather than `SubagentStartRequest`:
 * `startContinuable` hands over an `Omit<..., 'label' | 'signal' | 'outputSchema'>`
 * under `exactOptionalPropertyTypes`, and only `agentOptions` is read or
 * written here. The result is re-typed to the input type because the spread
 * preserves every other field verbatim.
 * @param request - the caller's delegation request.
 * @param selected - the configured default route.
 * @param acceptsRoute - whether the child's composer accepts `agentOptions`.
 * @returns the request to hand to the child's composer.
 */
function defaultedRequest<T extends Pick<SubagentStartRequest, 'agentOptions'>>(
  request: T,
  selected: ModelSelection,
  acceptsRoute: boolean,
): T {
  const explicit = request.agentOptions
  if (explicit?.provider !== undefined && explicit.model !== undefined) return request
  if (!acceptsRoute) return request
  return {
    ...request,
    agentOptions: {
      ...explicit,
      ...explicit?.provider === undefined ? { provider: selected.provider } : {},
      ...explicit?.model === undefined ? { model: selected.model } : {},
    },
  }
}

/**
 * Apply the configured reasoning effort to one resolved request. Only a
 * subagent whose resolved route IS the configured route is affected, so an
 * explicitly routed child keeps the effort its own route owns, and a child that
 * never defaulted to this selection is never rewritten here.
 * @param resolved - the request config the machine would use.
 * @param selected - the configured default route and effort.
 * @returns the resolved config, or a copy carrying the configured effort.
 */
function applySubagentEffort(resolved: LlmCallConfig, selected: ModelSelection): LlmCallConfig {
  const effort = selected.reasoningEffort
  if (effort === undefined) return resolved
  if (resolved.provider !== selected.provider || resolved.model !== selected.model) return resolved
  if (resolved.reasoningEffort === effort) return resolved
  return { ...resolved, reasoningEffort: effort }
}

/**
 * Instance marker proving one registry's start methods are already wrapped, so
 * a second copy of this package cannot stack a second default on the first.
 */
const DELEGATION_DEFAULTS: unique symbol = Symbol.for('@deepseek-ai/dsh-subagent-default-model/delegation')

/** The subagent registry plus this plugin's idempotence marker. */
type DefaultedSubagentRuntime = SubagentRuntime & { [DELEGATION_DEFAULTS]?: true }

/** The two registry members this plugin wraps, both read here for restoration. */
type WrappedMember = 'start' | 'startContinuable'

/**
 * Put one wrapped member back exactly as the wrap found it. A registry read
 * hands out a freshly traced function per access
 * (`createShadowMethod` in `vendor/cordis/src/utils.ts`), so the value captured
 * from the accessor is NOT the prototype function and can never be restored by
 * identity: the exact own-property state is. A member that had no own property
 * gets it removed again, so reads resolve to the prototype exactly as before;
 * a member that already had one keeps the descriptor it had, which preserves a
 * wrapper another plugin installed first.
 * @param runtime - the registry being unwrapped.
 * @param member - the wrapped member to restore.
 * @param descriptor - the member's own descriptor before the wrap, if any.
 */
function restoreMember(
  runtime: DefaultedSubagentRuntime,
  member: WrappedMember,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) Reflect.deleteProperty(runtime, member)
  else Object.defineProperty(runtime, member, descriptor)
}

/**
 * Wrap the registry's two start operations so a delegation that names no route
 * starts on the configured selection. The registry exposes no per-request hook
 * and resolves no options of its own before dispatching, so the instance
 * methods are the only seam that reaches every caller of
 * `ctx.subagents.start()` / `startContinuable()` (the model-facing delegation
 * tool, the workflow worker, the SDK server, and the Agent Teams roster alike).
 *
 * Only the first wrapper installs; its disposer restores both members to their
 * exact prior state, so the wrap unwinds with the injecting fiber and a later
 * mount can wrap the registry again.
 * @param ctx - context carrying the live `ctx.subagents` registry.
 * @param current - live read of the configured selection.
 */
function installDelegationDefaults(ctx: Context, current: () => ModelSelection): void {
  ctx.effect(() => {
    const runtime = ctx.subagents as DefaultedSubagentRuntime
    /* v8 ignore next -- one mounted copy of this package owns the wrap; only a second copy returns here. */
    if (runtime[DELEGATION_DEFAULTS] === true) return () => {}
    const startDescriptor = Object.getOwnPropertyDescriptor(runtime, 'start')
    const startContinuableDescriptor = Object.getOwnPropertyDescriptor(runtime, 'startContinuable')
    const originalStart = runtime.start
    const originalStartContinuable = runtime.startContinuable
    runtime[DELEGATION_DEFAULTS] = true
    runtime.start = function startWithDefaultRoute(name, request) {
      return originalStart.call(
        runtime,
        name,
        defaultedRequest(request, current(), runtime.getProvider(name)?.capabilities.agentOptions === true),
      )
    }
    runtime.startContinuable = function startContinuableWithDefaultRoute(spec) {
      // The continuation manager composes a continuable child itself and
      // publishes no capability handshake for it, so `capabilities.agentOptions`
      // (which describes the one-shot path) does not gate this route.
      return originalStartContinuable.call(runtime, {
        ...spec,
        request: defaultedRequest(spec.request, current(), true),
      })
    }
    return () => {
      if (runtime[DELEGATION_DEFAULTS] !== true) return
      restoreMember(runtime, 'start', startDescriptor)
      restoreMember(runtime, 'startContinuable', startContinuableDescriptor)
      Reflect.deleteProperty(runtime, DELEGATION_DEFAULTS)
    }
  }, 'subagent-default-model: delegation defaults')
}

/**
 * Owns the default model selection for delegated children independently of any
 * Host or transport. The composition entry remains usable without a settings
 * provider; when one is mounted, its user layer is read live. A deployment
 * without `ctx.subagents` still gets the settings section and the live
 * selection — only the delegation default and the effort application need a
 * registry and a running loop.
 */
export class SubagentDefaultModelConfig extends Service {
  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private source: () => SubagentDefaultModelSettings

  /**
   * @param ctx - owning context.
   * @param config - the composition default route.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'subagentDefaultModel')
    const entry: SubagentDefaultModelSettings = { provider: config.provider, model: config.model }
    this.source = () => entry
    ctx.inject(['settings'], (settingsCtx) => {
      settingsCtx.settings.installSection(
        ctx,
        SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
        SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA,
        entry,
        {
          setSource: (current) => { this.source = current },
          // Every consumer reads through currentSelection(), so no registration-level fact
          // needs rebuilding when the settings document changes.
          onChange: () => {},
        },
      )
    })
    // The route is injected at the delegation boundary, so the child's
    // AgentOptions — and the `{{model}}` prompt variable derived from them — are
    // correct from creation. Reasoning effort is not part of AgentOptions, so it
    // is applied per request instead, and only on the configured route.
    ctx.inject(['subagents'], (subagentsCtx) => {
      installDelegationDefaults(subagentsCtx, () => this.currentSelection())
    })
    ctx.on('agent/request', async (payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      if (!isSubagent(payload.agent)) return resolved
      return applySubagentEffort(resolved, this.currentSelection())
    })
  }

  /**
   * Read the current default subagent model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    return selection(this.source())
  }

  /**
   * Save the complete default subagent model selection. A deployment without a
   * settings provider keeps its composition entry.
   * @param next - resolved selection accepted by a settings surface.
   * @returns fulfillment after the optional settings write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    await this.ctx.get('settings')?.replace(SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      provider: next.provider,
      model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    })
  }
}

export default SubagentDefaultModelConfig

/** Default subagent model settings: settings layering plus the delegation boundary. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type {
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import SubagentDefaultModelConfig, {
  SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
  SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA,
} from '../src/index.ts'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** Every start-time feature, so only the route gate can refuse a request. */
const FULL_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

/** Records every dispatched delegation request and publishes a completed run. */
class RecordingProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  readonly seen: SubagentStartRequest[] = []

  constructor(
    readonly name: string,
    readonly capabilities: SubagentCapabilities,
  ) {}

  start(request: SubagentStartRequest): Promise<SubagentRun> {
    this.seen.push(request)
    const result: SubagentResult = {
      output: [{ type: 'text', text: 'recorded' }],
      stopReason: 'completed',
    }
    return Promise.resolve({
      id: SessionId(`recording:${request.parent.id}`),
      localAgent: undefined,
      result: Promise.resolve(result),
      dispose: () => Promise.resolve(),
    })
  }
}

/** A minimal parent: the recording provider reads only its id. */
function fakeParent(id = 'parent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

function baseRequest(over: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'task' }] as ContentBlock[],
    parent: fakeParent(),
    signal: new AbortController().signal,
    ...over,
  }
}

interface Bench {
  ctx: Context
  pluginFiber: Context['fiber']
  settingsFiber: Context['fiber']
  provider: RecordingProvider
}

/**
 * Mount a real registry, a recording provider, an in-memory settings document,
 * and this plugin over one context.
 * @param capabilities - the recording provider's advertised start-time features.
 * @returns the mounted bench.
 */
async function boot(capabilities: SubagentCapabilities = FULL_CAPABILITIES): Promise<Bench> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(SubagentRuntime)
  const provider = new RecordingProvider('recording', capabilities)
  await ctx.plugin({
    name: 'recording-subagent-provider',
    inject: ['subagents'],
    apply(pluginCtx: Context): void {
      pluginCtx.subagents.registerProvider(provider)
    },
  })
  const pluginFiber = ctx.plugin(SubagentDefaultModelConfig, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  await pluginFiber.await()
  // The plugin reaches the registry through its own `ctx.inject` fiber, whose
  // activation is one microtask chain behind this fiber's readiness; one
  // macrotask turn settles every pending effect before the first delegation.
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  return { ctx, pluginFiber, settingsFiber, provider }
}

describe('SubagentDefaultModelConfig', () => {
  it('rejects a settings section without a string provider or model', () => {
    expect(() => SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA({ model: 'm' } as never)).toThrow()
    expect(() => SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA({ provider: 'p' } as never)).toThrow()
    expect(() => SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA({ provider: 1, model: 'm' } as never)).toThrow()
    expect(SUBAGENT_DEFAULT_MODEL_SETTINGS_SCHEMA({ provider: 'p', model: 'm' }))
      .toMatchObject({ provider: 'p', model: 'm' })
  })

  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.ctx.subagentDefaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })

    await bench.ctx.subagentDefaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.ctx.subagentDefaultModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high',
    })
    await bench.ctx.fiber.dispose()
  })

  it('writes the complete selection into the settings document', async () => {
    const bench = await boot()
    await bench.ctx.subagentDefaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    const stored = (): unknown => bench.ctx.settings
      .describe()
      .find(descriptor => String(descriptor.ns) === SUBAGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE)
      ?.user
    expect(stored()).toEqual({ provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high' })

    await bench.ctx.subagentDefaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-plain' })
    expect(stored()).toEqual({ provider: 'acme-gateway', model: 'acme-plain' })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SubagentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.subagentDefaultModel.saveSelection({ provider: 'other', model: 'other' })
    expect(ctx.subagentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })

  it('defaults the route of a delegation that names none', async () => {
    const bench = await boot()
    await bench.ctx.subagentDefaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })

    const run = await bench.ctx.subagents.start('recording', baseRequest())
    await run.dispose()

    expect(bench.provider.seen).toHaveLength(1)
    expect(bench.provider.seen[0]?.agentOptions).toEqual({
      provider: 'acme-gateway', model: 'acme-large',
    })
    await bench.ctx.fiber.dispose()
  })

  it('leaves an explicitly routed delegation untouched', async () => {
    const bench = await boot()
    await bench.ctx.subagentDefaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })
    const explicit = {
      provider: 'other-gateway',
      model: 'other-model',
      reasoningEffort: ReasoningEffortId('low'),
      maxTokens: 64,
    }

    const run = await bench.ctx.subagents.start('recording', baseRequest({ agentOptions: explicit }))
    await run.dispose()

    expect(bench.provider.seen[0]?.agentOptions).toEqual(explicit)
    await bench.ctx.fiber.dispose()
  })

  it('leaves the request untouched when the provider refuses child agentOptions', async () => {
    const bench = await boot({ ...FULL_CAPABILITIES, agentOptions: false })

    const run = await bench.ctx.subagents.start('recording', baseRequest())
    await run.dispose()

    expect(bench.provider.seen[0]?.agentOptions).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('wraps both delegation boundaries and restores the registry on dispose', async () => {
    const bench = await boot()
    const registry = bench.ctx.subagents as unknown as Record<string, unknown>
    // A registry read hands out a freshly traced function per access
    // (createShadowMethod in vendor/cordis/src/utils.ts), so identity with
    // SubagentRuntime.prototype.start is not observable at all; the own
    // property the wrap adds is, and so is the routing it produces.
    expect(Object.hasOwn(registry, 'start')).toBe(true)
    expect(Object.hasOwn(registry, 'startContinuable')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(registry, 'start')?.value)
      .not.toBe(SubagentRuntime.prototype.start)

    await bench.pluginFiber.dispose()

    expect(Object.hasOwn(registry, 'start')).toBe(false)
    expect(Object.hasOwn(registry, 'startContinuable')).toBe(false)
    // Unwrapped means unwrapped: the same delegation now keeps its request shape.
    const run = await bench.ctx.subagents.start('recording', baseRequest())
    await run.dispose()
    expect(bench.provider.seen[0]?.agentOptions).toBeUndefined()

    // A later mount wraps the registry again, so the idempotence marker was released too.
    const remount = bench.ctx.plugin(SubagentDefaultModelConfig, { provider: 'p2', model: 'm2' })
    await remount.await()
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(Object.hasOwn(registry, 'start')).toBe(true)
    await remount.dispose()
    expect(Object.hasOwn(registry, 'start')).toBe(false)
    await bench.ctx.fiber.dispose()
  })
})

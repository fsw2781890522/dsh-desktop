/** Shared fixture for the proxy-port suites: a booted plugin over a memory settings provider. */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
  type LaunchEnvironmentSnapshot,
} from '@deepseek-ai/dsh-launch-environment'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply, Config, name } from '../src/index.ts'

/** A provider origin: public, not loopback, and absent from every bypass list. */
export const REMOTE = new URL('https://probe.invalid/latest.json')

/** The smallest real provider: one in-memory document, always writable. */
export class MemorySettings extends SettingsProvider {
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

/**
 * The proxy one URL would be sent through right now, as the official policy reports it.
 * @param url - the request URL.
 * @returns the proxy URL, or undefined for a direct connection.
 */
export function proxyFor(url: URL = REMOTE): string | undefined {
  const route = proxyRouteFor(url)
  return route.proxied ? route.proxy : undefined
}

/** One mounted plugin and the services it was given. */
export interface Bench {
  ctx: Context
  fiber: Fiber
  environment: LaunchEnvironmentSnapshot
}

/**
 * Mount the plugin over a launch environment and, by default, a memory settings provider.
 * @param options - environment values, composition port, and whether settings is composed.
 * @returns the booted context with its plugin fiber.
 */
export async function boot(options: {
  values?: Record<string, string>
  port?: number
  withSettings?: boolean
} = {}): Promise<Bench> {
  const ctx = new Context()
  const environment = createLaunchEnvironmentSnapshot([
    { source: 'process', values: options.values ?? {} },
  ])
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
  if (options.withSettings !== false) await ctx.plugin(MemorySettings).await()
  const plugin = { name, apply, Config }
  const fiber = options.port === undefined ? ctx.plugin(plugin) : ctx.plugin(plugin, { port: options.port })
  await fiber.await()
  return { ctx, fiber, environment }
}

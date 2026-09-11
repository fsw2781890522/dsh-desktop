/**
 * Process-wide outbound HTTP for a harness whose proxy is chosen in Settings:
 * register the `http-proxy` settings section and install the official proxy
 * policy for `127.0.0.1:{port}` whenever the launch environment names no proxy
 * of its own.
 *
 * Routing, bypass matching, and the dispatcher belong to
 * `@deepseek-ai/dsh-http-proxy`; this plugin owns only the port the General
 * Settings **Proxy port** row edits and the decision to hand it to that
 * resolver. It registers no agent tool and never enables or disables one.
 *
 * @module @deepseek-ai/dsh-proxy-port
 */

import type { Context } from '@deepseek-ai/cordis'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
// Type-only: pulls the settings service's Context merge (ctx.settings) and the
// section handle types this plugin registers into.
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_PROXY_PORT,
  HTTP_PROXY_PORT_FIELD,
  HTTP_PROXY_SETTINGS_NAMESPACE,
  parsePort,
} from './constants.ts'
import { hasExplicitProxy, withLocalProxyPort } from './environment.ts'

export {
  DEFAULT_PROXY_PORT,
  HTTP_PROXY_PORT_FIELD,
  HTTP_PROXY_SETTINGS_NAMESPACE,
  isValidPort,
  parsePort,
  proxyUrlForPort,
} from './constants.ts'
export { hasExplicitProxy, withLocalProxyPort, type EnvironmentLookup } from './environment.ts'

/** Durable `http-proxy` section shared with the General Settings proxy-port row. */
export interface HttpProxySettings {
  /** Local HTTP proxy TCP port (Clash/V2Ray mixed port by default). */
  port: number
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'proxy-port'

/** Plugin config. Invalid values fail plugin load. */
export interface Config {
  /** Composition default for {@link HttpProxySettings.port} when the user-settings document has no override. */
  port?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  // Spelled out rather than computed from the field constant: the configuration
  // catalog reads this literal to prove every loader-accepted key is declared.
  // `.step(1)` is the integer requirement the settings row and this package share.
  port: z.number().step(1).min(1).max(65535),
})

const HttpProxySettingsSchema: z<HttpProxySettings> = z.object({
  [HTTP_PROXY_PORT_FIELD]: z.number().step(1).min(1).max(65535).default(DEFAULT_PROXY_PORT),
})

/**
 * Narrow a composition value to a TCP port, or fail the plugin load.
 * @param value - the `config.port` value as composed.
 * @returns the validated port.
 * @throws {TypeError} when the value is not an integer in 1–65535.
 */
function requirePort(value: unknown): number {
  const port = parsePort(value)
  if (port === undefined) {
    throw new TypeError(`proxy-port: port must be an integer 1–65535, got ${String(value)}`)
  }
  return port
}

/**
 * Install the official outbound proxy policy for the settings port, follow the
 * section while it is edited, and leave routing as it was on unload.
 *
 * An explicit proxy variable in the launch environment always wins: this plugin
 * then installs nothing and publishes the port for a later surface to read.
 * @param ctx - plugin context; the install is disposed with it.
 * @param config - composition default port. Omitted uses the schema default.
 * @throws when `config.port` is present and invalid, or the policy cannot install.
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const environment = launchEnvironmentOf(ctx)
  /** Read once: the launch environment of this run cannot change while the fiber lives. */
  const environmentSuppliesProxy = hasExplicitProxy(environment)
  let port = config.port === undefined ? DEFAULT_PROXY_PORT : requirePort(config.port)
  /** Set before teardown: a commit arriving during unload must not install a policy. */
  let disposed = false
  /** The live official install, or undefined while this plugin routes nothing. */
  let installed: (() => Promise<void>) | undefined
  /** The port {@link installed} routes, so a transition that changes nothing does no work. */
  let routed: number | undefined
  /** Serializes transitions: two settings commits can never interleave dispose and install. */
  let transitions: Promise<void> = Promise.resolve()

  /** Per-variable rejections the official resolver reports; it names the variable, never its value. */
  /* v8 ignore next -- lookup presents validated URLs and untouched NO_PROXY; the resolver has nothing to reject */
  const report = (message: string): void => { ctx.logger.warn(`proxy-port: ${message}`) }

  /**
   * Bring the process policy in line with {@link port}: dispose the previous
   * install, then install one for the current environment and port. Queued
   * behind any in-flight transition, so one policy is never installed twice.
   *
   * Disposal precedes installation because the official disposer restores the
   * dispatcher *it* displaced: disposing an older install after a newer one
   * would take the newer one down with it. The cost is that a re-install which
   * fails leaves the process direct, so the failure is reported and the next
   * commit — or a restart — installs again.
   * @returns settlement after the process routes by the port read at run time.
   */
  const transition = (): Promise<void> => {
    const run = async (): Promise<void> => {
      if (disposed) return
      const desired = environmentSuppliesProxy ? undefined : port
      if (desired === routed) return
      const previous = installed
      installed = undefined
      routed = undefined
      await previous?.()
      // Unload or restart landed while the previous install was being disposed.
      if (disposed) return
      const disposer = await installProxyFromEnvironment(withLocalProxyPort(environment, port), report)
      // A commit that landed while the install was awaited owns the policy now.
      if (port !== desired || disposed) {
        await disposer()
        return
      }
      installed = disposer
      routed = desired
    }
    const next = transitions.then(run, run)
    transitions = next.then(() => undefined, () => undefined)
    return next
  }

  // The section resolves the starting port before the first install, so a stored
  // port boots directly instead of routing through the composition default first.
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(HTTP_PROXY_SETTINGS_NAMESPACE, HttpProxySettingsSchema, {
      base: { [HTTP_PROXY_PORT_FIELD]: port },
    })
    const applySection = (section: HttpProxySettings): void => {
      if (section.port === port) return
      port = section.port
      void transition().catch((error: unknown) => {
        ctx.logger.error('proxy-port: could not apply the settings port', error)
      })
    }
    applySection(scope.get())
    settingsCtx.effect(() => scope.watch((next) => { applySection(next) }), 'proxy-port: settings port')
  })

  await ctx.effect(async () => {
    await transition()
    return async () => {
      disposed = true
      await transitions
      const previous = installed
      installed = undefined
      routed = undefined
      await previous?.()
    }
  }, 'proxy-port: outbound proxy policy')
}

/**
 * The launch environment as the official proxy resolver reads it, and the one
 * transformation this package applies to it: an unset proxy slot becomes the
 * GUI port. Resolution, bypass matching, and installation stay in
 * `@deepseek-ai/dsh-http-proxy`; nothing here re-implements them.
 */

import { proxyUrlForPort } from './constants.ts'

/**
 * The one thing resolution needs from an environment: a name in, the winning
 * value out. Structurally identical to the `EnvLookup` the official resolver
 * declares and to `LaunchEnvironmentSnapshot`, so either passes unchanged.
 */
export interface EnvironmentLookup {
  /**
   * Resolve one variable name.
   * @param name - the variable name.
   * @returns the winning entry, or `undefined` when nothing supplies it.
   */
  get(name: string): { readonly value: string } | undefined
}

/**
 * Every name an explicit proxy choice can arrive in, both casings — they are
 * separate names on every platform except Windows, and `ALL_PROXY` backs both
 * schemes in the official resolver.
 */
const EXPLICIT_PROXY_NAMES: readonly string[] = [
  'http_proxy', 'HTTP_PROXY',
  'https_proxy', 'HTTPS_PROXY',
  'all_proxy', 'ALL_PROXY',
]

/**
 * The two names that select the proxy for one URL scheme, paired by casing:
 * a value in either spelling belongs to the same slot, so the synthesized port
 * can never shadow an explicit value the resolver happens to read second.
 */
const SCHEME_PROXY_NAMES: Readonly<Record<string, readonly string[]>> = {
  http_proxy: ['http_proxy', 'HTTP_PROXY'],
  https_proxy: ['https_proxy', 'HTTPS_PROXY'],
}

/**
 * Whether the environment already names a proxy, which always wins over the
 * Settings port. A blank value counts as unset, exactly as the official
 * resolver reads it — undici's own `??` chain would otherwise let an empty
 * lowercase name shadow a populated uppercase one.
 * @param environment - the launch environment.
 * @returns whether any proxy variable supplies a non-blank value.
 */
export function hasExplicitProxy(environment: EnvironmentLookup): boolean {
  return EXPLICIT_PROXY_NAMES.some((name) => {
    const value = environment.get(name)?.value.trim()
    return value !== undefined && value !== ''
  })
}

/**
 * The environment to resolve the process policy from when the GUI owns the
 * proxy: the launch environment, with the local proxy URL filling each scheme
 * slot no spelling of which supplies a value. Every other name — `NO_PROXY`
 * included — passes straight through, so a user's bypass list and `ALL_PROXY`
 * fallback keep their meaning.
 * @param environment - the launch environment the resolver reads.
 * @param port - the local HTTP proxy port from the settings section.
 * @returns the lookup to install the policy from.
 */
export function withLocalProxyPort(environment: EnvironmentLookup, port: number): EnvironmentLookup {
  const local = { value: proxyUrlForPort(port) }
  return {
    get: (name) => {
      const slot = SCHEME_PROXY_NAMES[name.toLowerCase()]
      if (slot === undefined) return environment.get(name)
      const supplied = slot
        .map(candidate => environment.get(candidate))
        .find(entry => entry !== undefined && entry.value.trim() !== '')
      return supplied ?? local
    },
  }
}

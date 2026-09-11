/** The environment transformation and port helpers the plugin resolves the policy from. */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROXY_PORT,
  isValidPort,
  parsePort,
  proxyUrlForPort,
} from '../src/constants.ts'
import { hasExplicitProxy, withLocalProxyPort, type EnvironmentLookup } from '../src/environment.ts'

/**
 * A lookup over one literal record, as a launch environment behaves.
 * @param values - the variable names and values the environment holds.
 * @returns the snapshot-shaped lookup.
 */
function environment(values: Record<string, string>): EnvironmentLookup {
  return { get: name => values[name] === undefined ? undefined : { value: values[name] } }
}

describe('proxy-port constants', () => {
  it('accepts TCP ports and rejects the rest', () => {
    expect(isValidPort(DEFAULT_PROXY_PORT)).toBe(true)
    expect(isValidPort(1)).toBe(true)
    expect(isValidPort(65535)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
    expect(isValidPort(1.5)).toBe(false)
    expect(isValidPort('8118')).toBe(false)
    expect(parsePort('8118')).toBe(8118)
    expect(parsePort(' 9050 ')).toBe(9050)
    expect(parsePort('0')).toBeUndefined()
    expect(parsePort('65536')).toBeUndefined()
    expect(parsePort(8.2)).toBeUndefined()
    expect(parsePort(undefined)).toBeUndefined()
    expect(proxyUrlForPort(7897)).toBe('http://127.0.0.1:7897')
  })
})

describe('proxy-port environment', () => {
  it('reads an explicit proxy from either casing and treats blank as unset', () => {
    expect(hasExplicitProxy(environment({}))).toBe(false)
    expect(hasExplicitProxy(environment({ http_proxy: 'http://proxy.example:8080' }))).toBe(true)
    expect(hasExplicitProxy(environment({ HTTP_PROXY: 'http://proxy.example:8080' }))).toBe(true)
    expect(hasExplicitProxy(environment({ ALL_PROXY: 'socks5://proxy.example:1080' }))).toBe(true)
    expect(hasExplicitProxy(environment({ https_proxy: '   ' }))).toBe(false)
    // A bypass list alone is not a proxy choice.
    expect(hasExplicitProxy(environment({ NO_PROXY: 'example.com' }))).toBe(false)
  })

  it('fills both scheme slots with the local port and passes every other name through', () => {
    const lookup = withLocalProxyPort(environment({ NO_PROXY: 'internal.example' }), 8118)

    expect(lookup.get('http_proxy')).toEqual({ value: 'http://127.0.0.1:8118' })
    expect(lookup.get('HTTP_PROXY')).toEqual({ value: 'http://127.0.0.1:8118' })
    expect(lookup.get('https_proxy')).toEqual({ value: 'http://127.0.0.1:8118' })
    expect(lookup.get('HTTPS_PROXY')).toEqual({ value: 'http://127.0.0.1:8118' })
    // A bypass list is the user's own answer for its scheme, so it rides through
    // under the name the environment spelled; the resolver reads both casings.
    expect(lookup.get('NO_PROXY')).toEqual({ value: 'internal.example' })
    expect(lookup.get('no_proxy')).toBeUndefined()
    // ALL_PROXY is never synthesized: the scheme slots above already carry the port,
    // because the local port backs neither scheme by fallback but both directly.
    expect(lookup.get('ALL_PROXY')).toBeUndefined()
    expect(lookup.get('PATH')).toBeUndefined()
  })

  it('keeps an explicit value in its own slot, in either casing, and ignores a blank one', () => {
    const lookup = withLocalProxyPort(environment({
      https_proxy: 'http://explicit.invalid:8080',
      http_proxy: '   ',
    }), 8118)

    // Both spellings of one slot answer the value the user wrote: the resolver
    // reads the lowercase name first, so a synthesized uppercase one could
    // otherwise shadow it.
    expect(lookup.get('https_proxy')).toEqual({ value: 'http://explicit.invalid:8080' })
    expect(lookup.get('HTTPS_PROXY')).toEqual({ value: 'http://explicit.invalid:8080' })
    expect(lookup.get('http_proxy')).toEqual({ value: 'http://127.0.0.1:8118' })
    expect(lookup.get('HTTP_PROXY')).toEqual({ value: 'http://127.0.0.1:8118' })
  })

  it('never shadows an uppercase-only explicit value with the local port', () => {
    const lookup = withLocalProxyPort(environment({ HTTPS_PROXY: 'http://explicit.invalid:8080' }), 8118)

    expect(lookup.get('https_proxy')).toEqual({ value: 'http://explicit.invalid:8080' })
    expect(lookup.get('HTTPS_PROXY')).toEqual({ value: 'http://explicit.invalid:8080' })
    expect(lookup.get('http_proxy')).toEqual({ value: 'http://127.0.0.1:8118' })
  })
})

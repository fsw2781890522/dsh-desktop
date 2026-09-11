/** The proxy-port plugin: the settings section it owns and the routing it installs. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import {
  apply,
  Config,
  DEFAULT_PROXY_PORT,
  HTTP_PROXY_SETTINGS_NAMESPACE,
  name,
} from '../src/index.ts'
import { boot, MemorySettings, proxyFor } from './harness.ts'

/** The registered namespace names, as a configuration surface would list them. */
function namespaces(ctx: Context): string[] {
  return ctx.settings.describe().map(row => String(row.ns))
}

describe('proxy-port plugin', () => {
  it('registers the http-proxy section and routes through the default port', async () => {
    const bench = await boot()

    expect(name).toBe('proxy-port')
    expect(namespaces(bench.ctx)).toContain(HTTP_PROXY_SETTINGS_NAMESPACE)
    expect(bench.ctx.settings.get(HTTP_PROXY_SETTINGS_NAMESPACE)).toEqual({ port: DEFAULT_PROXY_PORT })
    expect(proxyFor()).toBe(`http://127.0.0.1:${String(DEFAULT_PROXY_PORT)}`)
    // The plugin owns transport policy only; it registers no tool surface.
    expect(bench.ctx.get('tools')).toBeUndefined()

    await bench.fiber.dispose()

    expect(proxyFor()).toBeUndefined()
    expect(namespaces(bench.ctx)).not.toContain(HTTP_PROXY_SETTINGS_NAMESPACE)
    await bench.ctx.fiber.dispose()
  })

  it('leaves loopback and composed config alone', async () => {
    const bench = await boot({ port: 8118 })

    expect(bench.ctx.settings.get(HTTP_PROXY_SETTINGS_NAMESPACE)).toEqual({ port: 8118 })
    expect(proxyFor()).toBe('http://127.0.0.1:8118')
    // The official resolver bypasses loopback itself; the plugin adds no matcher of its own.
    expect(proxyFor(new URL('http://127.0.0.1:9/health'))).toBeUndefined()

    await bench.ctx.fiber.dispose()
  })

  it('follows a live port edit and stops routing when the plugin unloads', async () => {
    const bench = await boot()
    expect(proxyFor()).toBe('http://127.0.0.1:7897')

    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 9050 })

    await vi.waitFor(() => { expect(proxyFor()).toBe('http://127.0.0.1:9050') })
    expect(bench.ctx.settings.get(HTTP_PROXY_SETTINGS_NAMESPACE)).toEqual({ port: 9050 })

    await bench.fiber.dispose()

    expect(proxyFor()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('supersedes the install a later commit already replaced', async () => {
    const bench = await boot()

    // Two commits land before the first transition's install resolves, so the
    // first install answers a port the section no longer holds and must be
    // dropped rather than published as the live policy.
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 8118 })
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 9050 })

    await vi.waitFor(() => { expect(proxyFor()).toBe('http://127.0.0.1:9050') })
    expect(bench.ctx.settings.get(HTTP_PROXY_SETTINGS_NAMESPACE)).toEqual({ port: 9050 })

    await bench.fiber.dispose()
    await bench.ctx.fiber.dispose()
  })

  it('leaves nothing installed when unloaded while a port change is in flight', async () => {
    const bench = await boot()

    // The commit starts a transition; the unload lands before its install
    // resolves, and the fresh install must not outlive the fiber.
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 8118 })
    await bench.fiber.dispose()

    expect(proxyFor()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('drops a transition that unload overtook before it ran', async () => {
    const bench = await boot()

    // Two commits queue two transitions; the unload settles both without
    // installing anything, because neither may outlive the fiber.
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 8118 })
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 9050 })
    await bench.fiber.dispose()

    expect(proxyFor()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('still routes at the composition default without a settings provider', async () => {
    const bench = await boot({ withSettings: false, port: 8118 })

    expect(bench.ctx.get('settings')).toBeUndefined()
    expect(proxyFor()).toBe('http://127.0.0.1:8118')

    await bench.ctx.fiber.dispose()
  })

  it('lets an explicit environment proxy win and installs nothing', async () => {
    const bench = await boot({ values: { HTTPS_PROXY: 'http://explicit.invalid:8080' } })

    // Nothing installed a policy here, and the plugin must not invent one over the user's choice.
    expect(proxyFor()).toBeUndefined()
    expect(bench.ctx.settings.get(HTTP_PROXY_SETTINGS_NAMESPACE)).toEqual({ port: DEFAULT_PROXY_PORT })

    await bench.fiber.dispose()
    expect(proxyFor()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })

  it('leaves the launcher install in place and restores it on unload', async () => {
    const environment = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { HTTPS_PROXY: 'http://explicit.invalid:8080' } },
    ])
    const disposeLauncherPolicy = await installProxyFromEnvironment(environment, () => undefined)
    const ctx = new Context()
    ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ name, apply, Config })
    await fiber.await()

    expect(proxyFor()).toBe('http://explicit.invalid:8080')

    await fiber.dispose()

    expect(proxyFor()).toBe('http://explicit.invalid:8080')
    await disposeLauncherPolicy()
    expect(proxyFor()).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('treats a blank environment proxy as unset', async () => {
    const bench = await boot({ values: { HTTP_PROXY: '   ', https_proxy: '' } })

    expect(proxyFor()).toBe('http://127.0.0.1:7897')

    await bench.ctx.fiber.dispose()
  })

  it('rejects an invalid composition port before routing anything', async () => {
    const ctx = new Context()

    await expect(apply(ctx, { port: 0 })).rejects.toThrow(/port must be an integer 1–65535/)
    await expect(apply(ctx, { port: 'nope' as unknown as number })).rejects
      .toThrow(/port must be an integer 1–65535/)
    expect(proxyFor()).toBeUndefined()

    expect(Config({}).port).toBeUndefined()
    expect(Config({ port: 8118 })).toEqual({ port: 8118 })
    for (const port of [0, 1.5, 65536]) {
      expect(() => Config({ port } as never)).toThrow()
    }
  })
})

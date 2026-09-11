/**
 * What a failed install does: the plugin reports it, routes nothing, and the
 * next port commit installs again. The installer is the only piece replaced —
 * every assertion still reads the real official policy through `proxyRouteFor`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { HTTP_PROXY_SETTINGS_NAMESPACE } from '../src/index.ts'
import { boot, proxyFor } from './harness.ts'

/** The one failure the next install must raise, or undefined to install normally. */
const pending = vi.hoisted(() => ({ failure: undefined as Error | undefined }))

vi.mock('@deepseek-ai/dsh-http-proxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-http-proxy')>()
  return {
    ...actual,
    installProxyFromEnvironment: async (
      ...args: Parameters<typeof actual.installProxyFromEnvironment>
    ): ReturnType<typeof actual.installProxyFromEnvironment> => {
      const failure = pending.failure
      if (failure !== undefined) {
        pending.failure = undefined
        throw failure
      }
      return await actual.installProxyFromEnvironment(...args)
    },
  }
})

afterEach(() => { pending.failure = undefined })

describe('proxy-port install failure', () => {
  it('reports the failure, routes nothing, and installs again on the next commit', async () => {
    const bench = await boot()
    const reported = vi.spyOn(bench.ctx.logger, 'error').mockImplementation(() => undefined)
    expect(proxyFor()).toBe('http://127.0.0.1:7897')

    const failure = new Error('undici is unavailable')
    pending.failure = failure
    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 8118 })

    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledWith('proxy-port: could not apply the settings port', failure)
    })
    // The failed transition had already disposed the previous policy, so the
    // process is direct rather than routed to a port nobody installed.
    expect(proxyFor()).toBeUndefined()

    await bench.ctx.settings.update(HTTP_PROXY_SETTINGS_NAMESPACE, { port: 9050 })

    await vi.waitFor(() => { expect(proxyFor()).toBe('http://127.0.0.1:9050') })

    await bench.fiber.dispose()
    expect(proxyFor()).toBeUndefined()
    await bench.ctx.fiber.dispose()
  })
})

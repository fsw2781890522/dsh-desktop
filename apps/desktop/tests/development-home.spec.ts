import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDshHome } from '@deepseek-ai/dsh-home-paths'
import { resolveDevelopmentHarnessHome } from '../scripts/development-home.ts'

describe('unpackaged desktop Harness home', () => {
  it('defaults to ~/.dsh rather than the disposable development directory', () => {
    expect(resolveDevelopmentHarnessHome({})).toBe(defaultDshHome())
  })

  it('honors an explicit DSH_HOME', () => {
    expect(resolveDevelopmentHarnessHome({ DSH_HOME: 'D:\\other-dsh' })).toBe(resolve('D:\\other-dsh'))
  })

  it('treats a blank DSH_HOME as unset', () => {
    expect(resolveDevelopmentHarnessHome({ DSH_HOME: '   ' })).toBe(defaultDshHome())
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'

const preloadApp = readFileSync(fileURLToPath(new URL('../src/preload-app.ts', import.meta.url)), 'utf8')
const tsdown = readFileSync(fileURLToPath(new URL('../tsdown.config.ts', import.meta.url)), 'utf8')

describe('sandboxed product preload', () => {
  it('does not runtime-import ipc, which would emit a sibling CJS chunk the sandbox cannot load', () => {
    expect(preloadApp).toMatch(/import type \{[^}]*DshDesktopAppApi[^}]*\} from '\.\/ipc\.ts'/)
    expect(preloadApp).not.toMatch(/import \{[^}]*DESKTOP_IPC/)
    expect(preloadApp).toContain(DESKTOP_IPC.colorSchemeSet)
    expect(tsdown).toMatch(/splitting:\s*false/)
  })
})

import { describe, expect, it } from 'vitest'
import { parseDesktopColorScheme } from '../src/ipc.ts'

describe('desktop color-scheme IPC', () => {
  it('accepts resolved light and dark schemes', () => {
    expect(parseDesktopColorScheme('light')).toBe('light')
    expect(parseDesktopColorScheme('dark')).toBe('dark')
  })

  it('rejects system, empty, and non-string payloads', () => {
    expect(() => { parseDesktopColorScheme('system') }).toThrow('color scheme')
    expect(() => { parseDesktopColorScheme('') }).toThrow('color scheme')
    expect(() => { parseDesktopColorScheme(undefined) }).toThrow('color scheme')
    expect(() => { parseDesktopColorScheme(1) }).toThrow('color scheme')
  })
})

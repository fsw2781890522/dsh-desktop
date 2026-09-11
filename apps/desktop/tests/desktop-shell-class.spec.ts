import { describe, expect, it } from 'vitest'
import { DESKTOP_SHELL_CLASS, stampDesktopShellClass } from '../src/desktop-shell-class.ts'

describe('desktop shell class stamp', () => {
  it('adds the layout chrome class when documentElement exists', () => {
    const added: string[] = []
    stampDesktopShellClass({ classList: { add: (name: string) => { added.push(name) } } })
    expect(added).toEqual([DESKTOP_SHELL_CLASS])
  })

  it('is a no-op when the document root is not ready', () => {
    expect(() => { stampDesktopShellClass(null) }).not.toThrow()
  })
})

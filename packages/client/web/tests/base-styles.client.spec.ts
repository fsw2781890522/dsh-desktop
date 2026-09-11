/** Shell base styles stay independent from the dynamically loaded theme bundle. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const THEME_PACKAGE = '@deepseek-ai/dsh-client-ui-theme'
const baseCss = readFileSync(fileURLToPath(new URL('../src/base.css', import.meta.url)), 'utf8')

/**
 * Import specifiers of the sheet, in source order. Quote style and surrounding
 * whitespace are intentionally irrelevant; duplicate imports remain visible.
 * @param css - stylesheet text.
 * @returns import specifiers in declaration order.
 */
function importOrder(css: string): string[] {
  return [...css.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(([, specifier = '']) => specifier)
}

const imports = importOrder(baseCss)
const normalizedCss = baseCss
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll(/\s+/g, ' ')
const literalContentSelectors = [
  'code',
  'pre',
  '[data-diff]',
  '[data-read]',
  '[data-search]',
  '[data-terminal]',
]

describe('web shell base.css', () => {
  it('leaves theme styles to the dynamic ui-theme client entry', () => {
    expect(imports).toEqual([])
    expect(baseCss).not.toContain(THEME_PACKAGE)
  })

  it('auto-spaces prose while preserving literal content', () => {
    expect(baseCss).toMatch(/body\s*\{[^}]*text-autospace:\s*normal;/)
    expect(normalizedCss).toContain(
      `${literalContentSelectors.join(', ')} { text-autospace: no-autospace; }`,
    )
  })

  it('keeps the desktop session stage concentric with the glass plate', () => {
    expect(baseCss).toMatch(/html\.dsh-desktop\s*\{/)
    expect(baseCss).toContain('--dsh-desktop-caption-height: env(titlebar-area-height, 38px);')
    expect(baseCss).not.toContain('overflow: hidden')
    expect(baseCss).toContain('--dsh-desktop-stage-inset: 6px;')
    expect(baseCss).toContain('--dsh-desktop-window-radius: 12px;')
    expect(baseCss).toContain('--dsh-desktop-card-radius: 12px;')
    expect(baseCss).toMatch(
      /--dsh-desktop-stage-radius:\s*max\(0px,\s*calc\(var\(--dsh-desktop-card-radius\) - var\(--dsh-desktop-stage-inset\)\)\);/,
    )
    expect(baseCss).toContain('html.dsh-desktop-maximized')
    expect(baseCss).toContain('--dsh-desktop-window-radius: 0px;')
    expect(baseCss).not.toMatch(/html\.dsh-desktop-maximized\s*\{[^}]*--dsh-desktop-card-radius/s)
    expect(baseCss).not.toMatch(/html\.dsh-desktop-maximized\s*\{[^}]*--dsh-desktop-stage-radius/s)
  })
})

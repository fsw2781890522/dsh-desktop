import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_CARD_RADIUS_PX,
  DESKTOP_STAGE_INSET_PX,
  DESKTOP_STAGE_RADIUS_PX,
  DESKTOP_WINDOW_RADIUS_PX,
} from '../src/client/desktop-chrome.ts'

const frameCss = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

describe('desktop chrome radii', () => {
  it('uses the card radius except at the concentric bottom-right corner', () => {
    expect(DESKTOP_CARD_RADIUS_PX).toBe(DESKTOP_WINDOW_RADIUS_PX)
    expect(DESKTOP_STAGE_RADIUS_PX).toBe(DESKTOP_CARD_RADIUS_PX - DESKTOP_STAGE_INSET_PX)
    expect(DESKTOP_STAGE_INSET_PX).toBe(6)
    expect(DESKTOP_WINDOW_RADIUS_PX).toBe(12)
    expect(frameCss).toContain('border-radius: var(--dsh-desktop-window-radius);')
    const stageRadius = [
      'var(--dsh-desktop-card-radius)',
      'var(--dsh-desktop-card-radius)',
      'var(--dsh-desktop-stage-radius)',
      'var(--dsh-desktop-card-radius)',
    ].join(' ')
    expect(frameCss).toContain(`border-radius: ${stageRadius}`)
    expect(frameCss).toContain('-webkit-app-region: drag')
    expect(frameCss).toMatch(/html\.dsh-desktop\) \.captionDrag \{[^}]*z-index:\s*30/s)
    expect(frameCss).toMatch(/html\.dsh-desktop\) \.overlayLayer \{[^}]*top:\s*calc\(var\(--dsh-desktop-caption-height\)/s)
  })

  it('does not trap the settings overlay under the session stage', () => {
    expect(frameCss).not.toMatch(/html\.dsh-desktop\) \.sidebarCol \{[^}]*z-index:/s)
  })
})

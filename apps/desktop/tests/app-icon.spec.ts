import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_APP_ICON_PATH, DESKTOP_PRODUCT_NAME } from '../src/app-icon.ts'

const favicon = readFileSync(fileURLToPath(new URL('../../web/public/favicon.svg', import.meta.url)), 'utf8')
const iconSvg = readFileSync(fileURLToPath(new URL('../icons/icon.svg', import.meta.url)), 'utf8')
const png = readFileSync(DESKTOP_APP_ICON_PATH)

describe('desktop app icon', () => {
  it('paints the official favicon whale white on a black rounded square', () => {
    const whale = favicon.match(/<path[^>]*\bd="([^"]+)"/)?.[1]
    expect(whale).toBeDefined()
    expect(iconSvg).toContain(`d="${whale}"`)
    expect(iconSvg).toContain('fill="#000000"')
    expect(iconSvg).toContain('fill="#FFFFFF"')
    expect(DESKTOP_PRODUCT_NAME).toBe('DeepSeek Harness')
  })

  it('ships a 1024px PNG and a multi-size ICO', () => {
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    const ico = readFileSync(fileURLToPath(new URL('../icons/icon.ico', import.meta.url)))
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(4)
  })
})

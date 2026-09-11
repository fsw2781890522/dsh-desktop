/** Rasterize the official white whale on a black rounded square into PNG and ICO. */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const APP_ROOT = resolve(import.meta.dirname, '..')
const FAVICON_PATH = join(APP_ROOT, '..', 'web', 'public', 'favicon.svg')
const ICONS_DIR = join(APP_ROOT, 'icons')
const ICON_SIZE = 1024
const PAD = 152
const CORNER = 196
const WHALE_VIEWBOX = 50

/**
 * @param {string} svg
 * @returns {string}
 */
function whalePath(svg) {
  const match = svg.match(/<path[^>]*\bd="([^"]+)"/)
  if (match === null) throw new Error('desktop icon: whale path missing from apps/web/public/favicon.svg')
  return match[1]
}

/**
 * @param {string} whale
 * @param {number} size
 * @returns {string}
 */
function composeIconSvg(whale, size) {
  const scale = (size - 2 * PAD * (size / ICON_SIZE)) / WHALE_VIEWBOX
  const pad = PAD * (size / ICON_SIZE)
  const corner = CORNER * (size / ICON_SIZE)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">` +
    `<rect width="${String(size)}" height="${String(size)}" rx="${String(corner)}" fill="#000000"/>` +
    `<g transform="translate(${String(pad)},${String(pad)}) scale(${String(scale)})"><path d="${whale}" fill="#FFFFFF"/></g>` +
    `</svg>`
}

/**
 * @param {readonly { width: number, png: Buffer }[]} images
 * @returns {Buffer}
 */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + 16 * images.length
  const entries = []
  const payloads = []
  for (const image of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(image.width >= 256 ? 0 : image.width, 0)
    entry.writeUInt8(image.width >= 256 ? 0 : image.width, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    payloads.push(image.png)
    offset += image.png.length
  }
  return Buffer.concat([header, ...entries, ...payloads])
}

/**
 * @param {string} svg
 * @param {number} size
 * @returns {Buffer}
 */
function rasterize(svg, size) {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
}

const whale = whalePath(readFileSync(FAVICON_PATH, 'utf8'))
mkdirSync(ICONS_DIR, { recursive: true })
const svg1024 = composeIconSvg(whale, ICON_SIZE)
writeFileSync(join(ICONS_DIR, 'icon.svg'), `${svg1024}\n`)
const png1024 = rasterize(svg1024, ICON_SIZE)
writeFileSync(join(ICONS_DIR, 'icon.png'), png1024)
const icoSizes = [16, 32, 48, 256]
writeFileSync(join(ICONS_DIR, 'icon.ico'), encodeIco(icoSizes.map(width => ({
  width,
  png: rasterize(composeIconSvg(whale, width), width),
}))))
console.log(`desktop icon: wrote ${ICONS_DIR}`)

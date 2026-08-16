// Renders the app icon (official DeepSeek whale on a black rounded square)
// and the splash/error pages from the official whale path shipped inside
// @deepseek-ai/dsh-web-frontend/dist/favicon.svg.
// Whale color: #FFFFFF — the official dark-mode whale (the favicon's own
// `prefers-color-scheme: dark` rule fills the path white), on DeepSeek's
// official black-background logo style.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const faviconPath = join(
  root, 'bundle-runtime', 'node_modules', '@deepseek-ai', 'dsh',
  'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'dist', 'favicon.svg',
)
const favicon = readFileSync(faviconPath, 'utf8')
const match = favicon.match(/<path[^>]*\bd="([^"]+)"/)
if (!match) throw new Error('whale path not found in official dsh-web-frontend favicon.svg')
const whale = match[1]

const WHALE_FILL = '#FFFFFF'

const svgDoc = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`

mkdirSync(join(root, 'icon-source'), { recursive: true })
mkdirSync(join(root, 'splash'), { recursive: true })

// --- 1) App icon: official whale on a black rounded square, 1024x1024 ---
{
  const size = 1024
  const pad = 152
  const scale = (size - 2 * pad) / 50
  const corner = 196
  const svg = svgDoc(
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${corner}" fill="#000000"/>` +
      `<g transform="translate(${pad},${pad}) scale(${scale})"><path d="${whale}" fill="${WHALE_FILL}"/></g>`,
  )
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(join(root, 'icon-source', 'deepseek-black-1024.png'), png)
  console.log('wrote icon-source/deepseek-black-1024.png')
}

// --- 2) Splash page shown while the local server boots ---
{
  const logo = svgDoc(160, 160, `<g transform="translate(16,16) scale(2.56)"><path d="${whale}" fill="${WHALE_FILL}"/></g>`)
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>DeepSeek Harness</title>
<style>
  html, body { height: 100%; margin: 0; background: #000; color: #e8e8e8;
    font-family: "Segoe UI", system-ui, sans-serif; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 28px; }
  .logo { animation: pulse 2.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
  .name { font-size: 22px; letter-spacing: .04em; font-weight: 600; }
  .hint { font-size: 13px; color: #9a9a9a; }
</style>
</head>
<body>
  <div class="logo">${logo}</div>
  <div class="name">DeepSeek Harness</div>
  <div class="hint">Starting the local server…</div>
</body>
</html>
`
  writeFileSync(join(root, 'splash', 'index.html'), html)
  console.log('wrote splash/index.html')
}

// --- 3) Error page shown if the server dies unexpectedly ---
{
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>DeepSeek Harness</title>
<style>
  html, body { height: 100%; margin: 0; background: #000; color: #e8e8e8;
    font-family: "Segoe UI", system-ui, sans-serif; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 20px; }
  .code { font-size: 30px; }
  .msg { font-size: 15px; color: #b0b0b0; max-width: 420px; text-align: center; line-height: 1.5; }
</style>
</head>
<body>
  <div class="code">⚠</div>
  <div class="msg">The DeepSeek Harness server is not running.<br/>Close this window and start the app again.</div>
</body>
</html>
`
  writeFileSync(join(root, 'splash', 'error.html'), html)
  console.log('wrote splash/error.html')
}

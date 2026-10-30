/*
 * Renders the app's icons from build/icons/mark.svg, their single source
 * (P8.2): PNGs from 16 to 1024 px, a multi-size icon.ico for the window, the
 * installer and the tray, and the taskbar's Inbox badges (1 to 9, then 9+).
 * `npm run icons` writes them; the outputs are committed, so a build never
 * needs these dev-only tools (@resvg/resvg-js, png-to-ico).
 */
const fs = require('node:fs')
const path = require('node:path')

const { projectRoot } = require('./lib/root.cjs')
const ICONS = path.join(projectRoot, 'build', 'icons')
const MARK = path.join(ICONS, 'mark.svg')

const PNG_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** The badge labels the taskbar overlay can show (`badgeText` in src/shared/taskbar.ts). */
const BADGES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']

/** The file a badge label is stored in: "9+" is badge-9plus.png. */
function badgeFile(label) {
  return `badge-${label.replace('+', 'plus')}.png`
}

/** A 32 px overlay badge: a red disc with the count, readable at 16 px. */
function badgeSvg(label) {
  const size = label.length > 1 ? 13 : 18
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15" fill="#c81e1e" stroke="#ffffff" stroke-width="2"/>
  <text x="16" y="16" dy="0.35em" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#ffffff">${label}</text>
</svg>`
}

const MOBILE_ASSETS = path.join(projectRoot, 'mobile', 'assets')

/** Where the white glyph inside the mark's rounded square is centred, and its width. */
const GLYPH_CENTRE = { x: 128, y: 128 }
const GLYPH_SIZE = 150

/**
 * The Play Store and Android icons, all from the mark: Play wants a full-bleed
 * square (it rounds the corners itself), and Android's adaptive icon wants the
 * glyph on its own, small enough for the launcher's mask to leave it whole.
 */
function storeAndAndroidIcons(mark) {
  // The tile's fill, a gradient: `glyph` keeps the mark's <defs>, so anything drawn with it can use it.
  const colour = /<rect[^>]*fill="([^"]+)"/.exec(mark)[1]
  const defs = /<defs>[\s\S]*?<\/defs>/.exec(mark)?.[0] ?? ''
  const glyph = mark.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?svg[^>]*>|<rect[^>]*\/>/g, '')
  // `share` is the part of the icon's width the glyph fills.
  const framed = (share, background, body = glyph) => {
    const side = GLYPH_SIZE / share
    const x = GLYPH_CENTRE.x - side / 2
    const y = GLYPH_CENTRE.y - side / 2
    const fill = background
      ? `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${background}"/>`
      : ''
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}">${fill}${body}</svg>`
  }
  const solid = (fill) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${defs}<rect width="1" height="1" fill="${fill}"/></svg>`
  return [
    ['play-store-512.png', framed(0.62, colour), 512],
    // Play's feature graphic, 1024 by 500: the glyph and the name on the mark's blue.
    [
      'play-feature-graphic.png',
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="${colour}"/>
  <g transform="translate(${245 - GLYPH_CENTRE.x * 1.3} ${250 - GLYPH_CENTRE.y * 1.3}) scale(1.3)">${glyph}</g>
  <text x="420" y="245" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="104" fill="#ffffff">Ostler</text>
  <text x="424" y="300" font-family="Segoe UI, Arial, sans-serif" font-size="31" fill="#ffffff" fill-opacity="0.85">Project Management</text>
</svg>`,
      1024
    ],
    ['icon.png', framed(0.62, colour), 1024],
    // The adaptive icon's safe zone is the middle 66 of 108 dp.
    ['android-icon-foreground.png', framed(0.56, null), 1024],
    ['android-icon-background.png', solid(colour), 1024],
    ['android-icon-monochrome.png', framed(0.56, null), 1024],
    ['splash-icon.png', mark, 1024],
    ['favicon.png', framed(0.62, colour), 48]
  ]
}

function render(svg, width) {
  const { Resvg } = require('@resvg/resvg-js')
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' }
  })
    .render()
    .asPng()
}

async function main() {
  const pngToIco = require('png-to-ico')
  const mark = fs.readFileSync(MARK, 'utf8')
  const written = []
  const pngs = new Map()
  for (const size of PNG_SIZES) {
    const png = render(mark, size)
    pngs.set(size, png)
    const file = path.join(ICONS, `${size}x${size}.png`)
    fs.writeFileSync(file, png)
    written.push(file)
  }
  // electron-builder reads build/icons/icon.png (and icon.ico on Windows).
  fs.writeFileSync(path.join(ICONS, 'icon.png'), pngs.get(1024))
  written.push(path.join(ICONS, 'icon.png'))
  const ico = await (pngToIco.default ?? pngToIco)(ICO_SIZES.map((size) => pngs.get(size)))
  fs.writeFileSync(path.join(ICONS, 'icon.ico'), ico)
  written.push(path.join(ICONS, 'icon.ico'))
  for (const label of BADGES) {
    const file = path.join(ICONS, badgeFile(label))
    fs.writeFileSync(file, render(badgeSvg(label), 32))
    written.push(file)
  }
  for (const [name, svg, size] of storeAndAndroidIcons(mark)) {
    const file = path.join(name.startsWith('play') ? ICONS : MOBILE_ASSETS, name)
    fs.writeFileSync(file, render(svg, size))
    written.push(file)
  }
  for (const file of written) process.stdout.write(`Wrote ${path.relative(projectRoot, file)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`generate-icons: ${error.stack || error}\n`)
    process.exitCode = 1
  })
}

module.exports = { BADGES, badgeFile, PNG_SIZES, ICO_SIZES }

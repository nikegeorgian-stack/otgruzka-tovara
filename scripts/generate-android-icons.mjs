/**
 * Raster FiberCell mark into Android mipmap launcher PNGs (API < 26 fallback).
 * Requires: npm i -D sharp (run from repo root once).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = path.join(root, 'src', 'assets', 'logo.svg')
const resDir = path.join(root, 'fst-web', 'android', 'app', 'src', 'main', 'res')
const bg = { r: 250, g: 248, b: 244, alpha: 1 } // #FAF8F4

const densities = [
  { folder: 'mipmap-mdpi', size: 48 },
  { folder: 'mipmap-hdpi', size: 72 },
  { folder: 'mipmap-xhdpi', size: 96 },
  { folder: 'mipmap-xxhdpi', size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
]

const svg = fs.readFileSync(svgPath)

async function makeIcon(size) {
  const pad = Math.round(size * 0.18)
  const inner = size - pad * 2
  const mark = await sharp(svg).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: mark, left: pad, top: pad }])
    .png()
    .toBuffer()
}

for (const { folder, size } of densities) {
  const dir = path.join(resDir, folder)
  fs.mkdirSync(dir, { recursive: true })
  const buf = await makeIcon(size)
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    const out = path.join(dir, name)
    fs.writeFileSync(out, buf)
    console.log('wrote', path.relative(root, out), `${size}x${size}`)
  }
}

console.log('Android launcher icons updated from FiberCell logo.svg')

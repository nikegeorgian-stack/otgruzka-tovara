/** Assemble scripts/_en-chunk-*.json → src/i18n/en.ts */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const chunks = [0, 1, 2, 3].map((i) => {
  const p = path.join(root, `scripts/_en-chunk-${i}.json`)
  const raw = fs.readFileSync(p, 'utf8')
  return JSON.parse(raw)
})
const map = new Map()
for (const chunk of chunks) {
  for (const row of chunk) {
    if (!row?.k) continue
    map.set(row.k, String(row.v ?? ''))
  }
}

// Ensure language labels exist
map.set('locale.ru', 'Russian')
map.set('locale.ka', 'ქართული')
map.set('locale.en', 'English')

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')
}

const lines = ["import type { Dict } from './types'", '', 'export const en: Dict = {']
for (const [k, v] of map) {
  lines.push(`  '${k}': '${esc(v)}',`)
}
lines.push('}', '')
const out = path.join(root, 'src/i18n/en.ts')
fs.writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`en.ts: ${map.size} keys → ${out}`)

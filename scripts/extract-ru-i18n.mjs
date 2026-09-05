/** Extract single-line string entries from src/i18n/ru.ts → JSON */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const src = fs.readFileSync(path.join(root, 'src/i18n/ru.ts'), 'utf8')
const entries = []
for (const line of src.split(/\n/)) {
  const m = line.match(/^\s+'([^']+)':\s*'((?:\\'|[^'])*)'\s*,?\s*$/)
  if (m) {
    entries.push({ k: m[1], v: m[2].replace(/\\'/g, "'") })
  }
}
const out = path.join(root, 'scripts/_ru-i18n-keys.json')
fs.writeFileSync(out, JSON.stringify(entries))
console.log(`wrote ${entries.length} keys → ${out}`)

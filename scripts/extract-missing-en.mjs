/** Extract multiline + remaining keys from ru.ts missing in en.ts; write stub JSON for translation */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const ruSrc = fs.readFileSync(path.join(root, 'src/i18n/ru.ts'), 'utf8')
const enSrc = fs.readFileSync(path.join(root, 'src/i18n/en.ts'), 'utf8')
const enKeys = new Set([...enSrc.matchAll(/^\s+'([^']+)':/gm)].map((m) => m[1]))

// Parse object body roughly: key then value until next key or closing
const body = ruSrc.replace(/^[\s\S]*export const ru: Dict = \{/, '').replace(/\n\}\s*$/, '')
const missing = []
const re = /\n\s+'([^']+)':\s*/g
let m
const positions = []
while ((m = re.exec(body))) {
  positions.push({ k: m[1], start: m.index + m[0].length })
}
for (let i = 0; i < positions.length; i++) {
  const cur = positions[i]
  const end = i + 1 < positions.length ? positions[i + 1].start - positions[i + 1].k.length - 6 : body.length
  // find value start
  let slice = body.slice(cur.start, end)
  // trim trailing comma/whitespace before next key
  slice = slice.replace(/,\s*$/, '').trim()
  if (enKeys.has(cur.k)) continue
  let v = slice
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    v = v.slice(1, -1)
  } else if (v.startsWith('`') && v.endsWith('`')) {
    v = v.slice(1, -1)
  }
  v = v.replace(/\\n/g, '\n').replace(/\\'/g, "'")
  missing.push({ k: cur.k, v })
}
fs.writeFileSync(path.join(root, 'scripts/_ru-i18n-missing.json'), JSON.stringify(missing, null, 0))
console.log('missing in en:', missing.length)

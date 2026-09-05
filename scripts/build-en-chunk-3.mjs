/** Build _en-chunk-3.json from _chunk3-ru.json + translation map */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const ru = JSON.parse(fs.readFileSync(path.join(root, 'scripts/_chunk3-ru.json'), 'utf8'))
const T = JSON.parse(fs.readFileSync(path.join(root, 'scripts/_chunk3-en-map.json'), 'utf8'))

function esc(v) {
  return v.replace(/'/g, "\\'")
}

const out = ru.map(({ k, v }) => {
  const en = T[k]
  if (!en) throw new Error(`Missing translation for key: ${k}`)
  return { k, v: esc(en) }
})

const outPath = path.join(root, 'scripts/_en-chunk-3.json')
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`wrote ${out.length} entries → ${outPath}`)

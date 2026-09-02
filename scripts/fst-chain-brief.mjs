/**
 * Агент цепочек FST: собирает graphify-контекст в .cursor/context/CHAIN_BRIEF.md
 *
 * Usage:
 *   node scripts/fst-chain-brief.mjs "feedback reply"
 *   node scripts/fst-chain-brief.mjs "табель план" "MonthPage" "appendAudit"
 *   npm run agent:chain-brief -- "склад движения"
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, '.cursor', 'context')
const outFile = path.join(outDir, 'CHAIN_BRIEF.md')
const graphJson = path.join(root, 'graphify-out', 'graph.json')

const args = process.argv.slice(2).filter(Boolean)
const topic = args[0] || 'Otgruzka AppStore sync'
const symbolA = args[1]
const symbolB = args[2]

function runGraphify(cmdArgs) {
  try {
    return execFileSync('graphify', cmdArgs, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (err) {
    const msg = err?.stdout || err?.stderr || err?.message || String(err)
    return `[graphify error]\n${msg}`
  }
}

function clip(text, max = 6000) {
  const t = String(text || '').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}\n\n… [truncated ${t.length - max} chars]`
}

const sections = []
sections.push(`# CHAIN BRIEF`)
sections.push(``)
sections.push(`generated: ${new Date().toISOString()}`)
sections.push(`topic: ${topic}`)
sections.push(`repo: Otgruzka / tabel`)
sections.push(`prod: https://otgruzka-tovara.vercel.app`)
sections.push(`firebase: otgruzka-tovara`)
sections.push(``)

if (!fs.existsSync(graphJson)) {
  sections.push(`## WARN`)
  sections.push(`graphify-out/graph.json missing — run: graphify update .`)
  sections.push(``)
}

sections.push(`## graphify query`)
sections.push('```')
sections.push(clip(runGraphify(['query', topic])))
sections.push('```')
sections.push(``)

if (symbolA) {
  sections.push(`## graphify explain (${symbolA})`)
  sections.push('```')
  sections.push(clip(runGraphify(['explain', symbolA])))
  sections.push('```')
  sections.push(``)
}

if (symbolA && symbolB) {
  sections.push(`## graphify path (${symbolA} → ${symbolB})`)
  sections.push('```')
  sections.push(clip(runGraphify(['path', symbolA, symbolB])))
  sections.push('```')
  sections.push(``)
}

sections.push(`## Agent checklist`)
sections.push(`- [ ] CHAIN BRIEF прочитан перед Edit/Write`)
sections.push(`- [ ] Firestore не трогать (нет clear/import)`)
sections.push(`- [ ] i18n RU+KA при UI-строках`)
sections.push(`- [ ] После правок: graphify update .`)
sections.push(``)
sections.push(`## For Cursor`)
sections.push(`Скил: \`.cursor/skills/fst-chain-context/SKILL.md\``)
sections.push(`Правило: \`.cursor/rules/fst-chain-context.mdc\``)
sections.push(``)

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outFile, sections.join('\n'), 'utf8')
console.log(`Wrote ${path.relative(root, outFile)}`)
console.log(`topic=${topic}`)
if (symbolA) console.log(`explain=${symbolA}`)
if (symbolA && symbolB) console.log(`path=${symbolA} -> ${symbolB}`)

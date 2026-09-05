/**
 * Audit: silent catch / swallowed errors in src/
 * Run: node scripts/audit-silent-errors.mjs
 */
import fs from 'fs'
import path from 'path'

const ROOT = path.join(process.cwd(), 'src')
const SKIP = /node_modules|dataconnect-generated|[\\/]dist[\\/]/

/** @type {string[]} */
const files = []
function walk(d) {
  for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, ent.name)
    if (SKIP.test(p)) continue
    if (ent.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(ent.name)) files.push(p)
  }
}
walk(ROOT)

/** @type {{ file: string, line: number, kind: string, snippet: string, risk: string }[]} */
const findings = []

function riskOf(file) {
  const p = file.replace(/\\/g, '/')
  if (/sqlconnect|FstSql|FstCloud|firestoreSync|refuseStore|cloudMerge|LocalDbSync|storage\.ts|cloudStoreIO|cloudPayload/.test(p))
    return 'HIGH'
  if (/finance|payroll|warehouse|procurement|access|App\.tsx|useAppStore/.test(p)) return 'MED'
  return 'LOW'
}

function add(file, line, kind, snippet) {
  findings.push({
    file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    line,
    kind,
    snippet: snippet.replace(/\s+/g, ' ').slice(0, 140),
    risk: riskOf(file),
  })
}

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const n = i + 1

    if (/\.catch\(\s*(?:\([^)]*\)|_)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
      add(file, n, 'empty_promise_catch', line)
      continue
    }
    if (/\.catch\(\s*\(\)\s*=>\s*(?:undefined|null|void\s*0)\s*\)/.test(line)) {
      add(file, n, 'null_promise_catch', line)
      continue
    }
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(line)) {
      add(file, n, 'empty_catch_block', line)
      continue
    }

    // multiline: catch { /* ignore */ }
    if (/catch\s*(?:\([^)]*\))?\s*\{/.test(line)) {
      const window = lines.slice(i, Math.min(i + 6, lines.length)).join('\n')
      if (/catch[^{]*\{\s*(?:\/\*[^*]*\*\/\s*)?\}/.test(window)) {
        add(file, n, 'ignore_or_empty_catch', window)
      } else if (
        /catch[^{]*\{\s*\/\*\s*ignore[\s\S]*?\*\/\s*\}/.test(window) ||
        /catch[^{]*\{\s*\/\/\s*ignore[^\n]*\n\s*\}/.test(window)
      ) {
        add(file, n, 'ignore_comment_catch', window)
      } else if (
        /catch[^{]*\{\s*console\.(?:log|warn|debug)\([^)]*\)\s*;?\s*\}/.test(window) &&
        !/setError|throw|flashStatus|toast/.test(window)
      ) {
        add(file, n, 'console_only_catch', window)
      }
    }

    // void foo().catch without handling next line
    if (/void\s+[a-zA-Z_$][\w$.]*\([^;]*\)\.catch\(\(\)\s*=>/.test(line)) {
      add(file, n, 'void_swallowed', line)
    }
  }
}

const byKind = {}
const byRisk = { HIGH: 0, MED: 0, LOW: 0 }
for (const f of findings) {
  byKind[f.kind] = (byKind[f.kind] || 0) + 1
  byRisk[f.risk]++
}

findings.sort((a, b) => {
  const o = { HIGH: 0, MED: 1, LOW: 2 }
  return o[a.risk] - o[b.risk] || a.file.localeCompare(b.file) || a.line - b.line
})

const outDir = path.join(process.cwd(), '.cursor', 'context')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'SILENT_ERRORS_AUDIT.md')

const high = findings.filter((f) => f.risk === 'HIGH')
const med = findings.filter((f) => f.risk === 'MED')

let md = `# Silent errors audit\n\ngenerated: ${new Date().toISOString()}\n\n`
md += `total=${findings.length} HIGH=${byRisk.HIGH} MED=${byRisk.MED} LOW=${byRisk.LOW}\n\n`
md += `## By kind\n\`\`\`\n${JSON.stringify(byKind, null, 2)}\n\`\`\`\n\n`
md += `## HIGH (sync / cloud / storage)\n\n`
for (const f of high) {
  md += `- **${f.kind}** \`${f.file}:${f.line}\` — ${f.snippet}\n`
}
md += `\n## MED (domain)\n\n`
for (const f of med) {
  md += `- **${f.kind}** \`${f.file}:${f.line}\` — ${f.snippet}\n`
}
md += `\n## LOW sample (first 40)\n\n`
for (const f of findings.filter((x) => x.risk === 'LOW').slice(0, 40)) {
  md += `- **${f.kind}** \`${f.file}:${f.line}\` — ${f.snippet}\n`
}

fs.writeFileSync(outPath, md, 'utf8')
console.log(md)
console.log(`\nWrote ${outPath}`)

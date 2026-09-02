#!/usr/bin/env node
/**
 * Validate Otgruzka agent system after changes.
 * Usage: node scripts/validate-agent-system.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []

function listSkills(dir) {
  const base = path.join(root, dir)
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort()
}

function parseFrontmatter(md) {
  if (!md.startsWith('---')) return null
  const end = md.indexOf('\n---', 3)
  if (end < 0) return null
  const block = md.slice(3, end).trim()
  /** @type {Record<string, string>} */
  const out = {}
  let key = null
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (m) {
      key = m[1]
      let v = m[2]
      if (v === '>' || v === '|' || v === '') v = ''
      else v = v.replace(/^['"]|['"]$/g, '').trim()
      out[key] = v
      continue
    }
    if (key && /^\s+/.test(line)) {
      const cont = line.trim()
      out[key] = out[key] ? `${out[key]} ${cont}` : cont
    }
  }
  return out
}

const cursorSkills = listSkills('.cursor/skills')
const agentsSkills = listSkills('.agents/skills')
const dup = cursorSkills.filter((n) => agentsSkills.includes(n))
if (dup.length) errors.push(`Duplicate skill names in .cursor and .agents: ${dup.join(', ')}`)

// Router references
const router = fs.readFileSync(path.join(root, '.cursor/rules/fst-skill-router.mdc'), 'utf8')
const skillRefs = [...router.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]).filter((n) => n.includes('-'))
const skipRefs = new Set([
  'speckit-constitution', 'specify', 'clarify', 'plan', 'tasks', 'analyze', 'implement', 'converge',
  'subagent', 'product-verifier', 'project-guardian',
])
for (const ref of new Set(skillRefs)) {
  if (ref.endsWith('.mdc') || ref.endsWith('.md')) continue
  if (skipRefs.has(ref)) continue
  if (['ViewId', 'index-'].some((x) => ref.includes(x))) continue
  if (!cursorSkills.includes(ref)) {
    const knownPrefixes = [
      'fst-', 'otgruzka-', 'firebase-', 'speckit-', 'vercel-', 'frontend-', 'html-', 'print-',
      'nika-', 'anthropic-', 'browser-', 'code-', 'debugging-', 'deprecation-', 'documentation-',
      'git-', 'idea-', 'incremental-', 'interview-', 'observability-', 'performance-', 'planning-',
      'security-', 'source-', 'test-', 'api-', 'ci-cd-', 'web-',
    ]
    if (knownPrefixes.some((p) => ref.startsWith(p)) || ref.includes('-')) {
      if (!cursorSkills.includes(ref)) warnings.push(`Router mentions \`${ref}\` — not found as skill folder`)
    }
  }
}

// YAML frontmatter on skills
for (const name of cursorSkills) {
  const md = fs.readFileSync(path.join(root, '.cursor/skills', name, 'SKILL.md'), 'utf8')
  if (!md.startsWith('---')) {
    warnings.push(`Skill ${name}: missing YAML frontmatter`)
    continue
  }
  const fm = parseFrontmatter(md)
  if (!fm) {
    warnings.push(`Skill ${name}: unclosed YAML frontmatter`)
    continue
  }
  if (!fm.name) warnings.push(`Skill ${name}: frontmatter missing name`)
  else if (fm.name !== name) warnings.push(`Skill ${name}: frontmatter name="${fm.name}" mismatch`)
  if (!fm.description) warnings.push(`Skill ${name}: frontmatter missing description`)
}

// Agents
for (const file of fs.readdirSync(path.join(root, '.cursor/agents'))) {
  if (!file.endsWith('.md') || file === 'README.md') continue
  const md = fs.readFileSync(path.join(root, '.cursor/agents', file), 'utf8')
  if (!md.startsWith('---')) warnings.push(`Agent ${file}: missing frontmatter`)
}

// hooks.json + scripts
const hooks = JSON.parse(fs.readFileSync(path.join(root, '.cursor/hooks.json'), 'utf8'))
const expectedEvents = new Set(['sessionStart', 'preCompact', 'stop', 'beforeShellExecution'])
for (const ev of expectedEvents) {
  if (!hooks.hooks[ev]) warnings.push(`hooks.json missing event ${ev}`)
}
for (const [event, list] of Object.entries(hooks.hooks)) {
  for (const h of list) {
    const cmd = String(h.command || '').replace(/^node\s+/, '')
    const script = path.join(root, cmd)
    if (!fs.existsSync(script)) errors.push(`Hook ${event}: missing script ${cmd}`)
  }
}

// skills-lock.json
const lockPath = path.join(root, 'skills-lock.json')
if (fs.existsSync(lockPath)) {
  const lockText = fs.readFileSync(lockPath, 'utf8').replace(/^\uFEFF/, '')
  let lock
  try {
    lock = JSON.parse(lockText)
  } catch (e) {
    errors.push(`skills-lock.json parse error: ${e.message}`)
    lock = { skills: {} }
  }
  for (const name of Object.keys(lock.skills || {})) {
    const skillMd = path.join(root, '.cursor/skills', name, 'SKILL.md')
    if (!fs.existsSync(skillMd)) {
      errors.push(`skills-lock.json references missing active skill: ${name}`)
    }
  }
}

// Required files
for (const f of [
  '.cursor/context/CURRENT_STATE.md',
  'docs/OTGRUZKA-SKILLS-GUIDE.md',
  '.cursor/agents/project-guardian.md',
  '.cursor/agents/product-verifier.md',
  '.cursor/rules/fst-core-policy.mdc',
]) {
  if (!fs.existsSync(path.join(root, f))) errors.push(`Missing required file: ${f}`)
}

// Broken relative links in CURRENT_STATE / guide (light)
for (const rel of [
  'docs/OTGRUZKA-SKILLS-GUIDE.md',
  'OTGRUZKA.md',
  'AGENTS.md',
  'docs/ARCHITECTURE.md',
]) {
  if (!fs.existsSync(path.join(root, rel))) errors.push(`Broken required path: ${rel}`)
}

console.log(JSON.stringify({
  cursorSkillCount: cursorSkills.length,
  agentsSkillCount: agentsSkills.length,
  uniqueSkillNames: new Set([...cursorSkills, ...agentsSkills]).size,
  skillsLockEntries: fs.existsSync(lockPath)
    ? Object.keys(JSON.parse(fs.readFileSync(lockPath, 'utf8').replace(/^\uFEFF/, '')).skills || {}).length
    : 0,
  errors,
  warnings,
}, null, 2))

process.exit(errors.length ? 1 : 0)

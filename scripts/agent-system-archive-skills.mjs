#!/usr/bin/env node
/**
 * Move skill folders to docs/agent-system/archive/skills/ (versioned archive).
 * Usage: node scripts/agent-system-archive-skills.mjs [--dry-run]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archiveRoot = path.join(root, 'docs/agent-system/archive/skills')
const dryRun = process.argv.includes('--dry-run')

/** @type {{ name: string, from: 'cursor' | 'agents', reason: string }[]} */
const PLAN = [
  // Archive candidates — .cursor
  { name: 'ayla-saas-admin-ui-ux-pro', from: 'cursor', reason: 'Unused SaaS kit; Otgruzka uses Tailwind fc-* design' },
  { name: 'ui-ux-pro-max', from: 'cursor', reason: 'Redundant with frontend-ui-engineering + fst-design-system' },
  { name: 'using-agent-skills', from: 'cursor', reason: 'Meta-skill; covered by OTGRUZKA-SKILLS-GUIDE + router' },
  { name: 'spec-driven-development', from: 'cursor', reason: 'Superseded by speckit-* workflow' },
  { name: 'context-engineering', from: 'cursor', reason: 'Rare large-session use; router points to planning instead' },
  { name: 'doubt-driven-development', from: 'cursor', reason: 'Ad-hoc; project-guardian covers disputed decisions' },
  { name: 'shipping-and-launch', from: 'cursor', reason: 'Generic; otgruzka-deploy-auditor is Otgruzka-specific' },
  { name: 'deploy-to-vercel', from: 'cursor', reason: 'Generic; otgruzka-deploy-auditor + fst-deploy-otgruzka rule' },
  { name: 'speckit-checklist', from: 'cursor', reason: 'Not in active Spec Kit workflow' },
  { name: 'speckit-taskstoissues', from: 'cursor', reason: 'Project does not sync tasks to GitHub Issues' },
  { name: 'openopc-request-analysis', from: 'cursor', reason: 'Rule moved to fst-core-policy.mdc' },
  // Archive candidates — .agents only
  { name: 'firebase-crashlytics', from: 'agents', reason: 'Not used in Otgruzka web stack' },
  { name: 'firebase-remote-config-basics', from: 'agents', reason: 'Not used in Otgruzka' },
  { name: 'firebase-ai-logic-basics', from: 'agents', reason: 'Not used in Otgruzka' },
  { name: 'xcode-project-setup', from: 'agents', reason: 'iOS not in Otgruzka focus' },
  { name: 'extension-to-functions-codebase', from: 'agents', reason: 'Not used' },
]

function skillDir(from, name) {
  return path.join(root, from === 'cursor' ? '.cursor/skills' : '.agents/skills', name)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) rmDir(p)
    else fs.unlinkSync(p)
  }
  fs.rmdirSync(dir)
}

function listSkills(base) {
  const skillsRoot = path.join(root, base)
  if (!fs.existsSync(skillsRoot)) return []
  return fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsRoot, d.name, 'SKILL.md')))
    .map((d) => d.name)
}

// 1) Copy hosting skills to .cursor before archiving .agents duplicates
for (const name of ['firebase-hosting-basics', 'firebase-app-hosting-basics']) {
  const src = skillDir('agents', name)
  const dest = skillDir('cursor', name)
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    console.log(`${dryRun ? '[dry] ' : ''}copy ${name}: agents → cursor`)
    if (!dryRun) copyDir(src, dest)
  }
}

// 2) Archive planned skills
for (const item of PLAN) {
  const src = skillDir(item.from, item.name)
  if (!fs.existsSync(src)) {
    console.log(`skip missing: ${item.from}/${item.name}`)
    continue
  }
  const dest = path.join(archiveRoot, item.name)
  console.log(`${dryRun ? '[dry] ' : ''}archive ${item.from}/${item.name} → docs/agent-system/archive/skills/${item.name}`)
  if (!dryRun) {
    if (fs.existsSync(dest)) rmDir(dest)
    copyDir(src, dest)
    fs.writeFileSync(
      path.join(dest, 'ARCHIVE_REASON.txt'),
      `Archived: ${new Date().toISOString().slice(0, 10)}\nFrom: ${item.from}\nReason: ${item.reason}\n`,
    )
    rmDir(src)
  }
}

// 3) Archive ALL remaining .agents/skills (canonical = .cursor/skills)
for (const name of listSkills('.agents/skills')) {
  const src = skillDir('agents', name)
  const dest = path.join(archiveRoot, `_agents-duplicate-${name}`)
  console.log(`${dryRun ? '[dry] ' : ''}archive duplicate agents/${name}`)
  if (!dryRun) {
    if (fs.existsSync(dest)) rmDir(dest)
    copyDir(src, dest)
    fs.writeFileSync(
      path.join(dest, 'ARCHIVE_REASON.txt'),
      `Archived: ${new Date().toISOString().slice(0, 10)}\nFrom: agents\nReason: Duplicate; canonical path .cursor/skills/${name}\n`,
    )
    rmDir(src)
  }
}

console.log('done')

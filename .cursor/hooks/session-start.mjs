#!/usr/bin/env node
/**
 * sessionStart — inject Otgruzka project index + live Git (read-only, no fetch).
 * Official output: { env?, additional_context? }
 * Docs: https://cursor.com/docs/hooks#sessionstart
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.env.CURSOR_PROJECT_DIR || process.cwd()
const stateRel = '.cursor/context/CURRENT_STATE.md'
const statePath = join(root, stateRel)
const hasState = existsSync(statePath)

/** @param {string[]} args */
function gitRead(args) {
  try {
    const r = spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    })
    if (r.error || r.status !== 0) return 'unknown'
    const out = (r.stdout || '').trim()
    return out || 'unknown'
  } catch {
    return 'unknown'
  }
}

const liveBranch = gitRead(['rev-parse', '--abbrev-ref', 'HEAD'])
const liveHeadShort = gitRead(['rev-parse', '--short', 'HEAD'])
const liveHeadFull = gitRead(['rev-parse', 'HEAD'])

/** @type {{ product: string, agent: string }} */
function parseBaselines() {
  let product = 'unknown'
  let agent = 'unknown'
  if (!hasState) return { product, agent }
  try {
    const text = readFileSync(statePath, 'utf8')
    const productM = text.match(/\|\s*\*\*Product baseline\*\*\s*\|\s*`([0-9a-f]+)`/i)
    const agentM = text.match(/\|\s*\*\*Agent-system baseline\*\*\s*\|\s*`([0-9a-f]+)`/i)
    if (productM) product = productM[1]
    if (agentM) agent = agentM[1]
  } catch {
    /* keep unknown */
  }
  return { product, agent }
}

const { product: productBaseline, agent: agentSystemBaseline } = parseBaselines()

const additional_context = [
  'Otgruzka agent index (sessionStart):',
  '',
  'Live Git (this session, read-only local git):',
  `- branch: ${liveBranch}`,
  `- HEAD (short): ${liveHeadShort}`,
  `- HEAD (full): ${liveHeadFull}`,
  `- workspace: ${root}`,
  `- CURRENT_STATE path: ${stateRel}`,
  '',
  'Named checkpoints (from CURRENT_STATE.md — may lag live HEAD):',
  `- Product baseline: ${productBaseline}`,
  `- Agent-system baseline: ${agentSystemBaseline}`,
  '',
  hasState
    ? `CURRENT_STATE.md is session memory; read ${stateRel} for task / open issues / next step (may be older than live HEAD).`
    : 'CURRENT_STATE.md missing — create/update .cursor/context/CURRENT_STATE.md.',
  '',
  'Skills guide: docs/OTGRUZKA-SKILLS-GUIDE.md (canonical skills: .cursor/skills/).',
  'Cross-module / store / SQL / roles / warehouse / payroll / production: invoke project-guardian (readonly) before edits.',
  'Do not invoke project-guardian for pure CSS/copy/i18n-typo fixes.',
  'Data truth: SQL Connect — no clear/import/migrate/deploy without explicit user request.',
].join('\n')

process.stdout.write(JSON.stringify({ additional_context }))
process.exit(0)

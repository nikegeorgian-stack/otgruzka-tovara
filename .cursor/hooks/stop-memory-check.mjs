#!/usr/bin/env node
/**
 * stop — observational memory/doc drift check.
 * Official output: { followup_message? } — followup AUTO-SUBMITS as next user message.
 * Therefore: never emit followup_message for routine notes (would spam/loop).
 * Critical missing CURRENT_STATE only → log to stderr (Hooks channel); return {}.
 * Docs: https://cursor.com/docs/hooks#stop
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CURSOR_PROJECT_DIR || process.cwd()
const stateFile = join(root, '.cursor/context/CURRENT_STATE.md')
const guideFile = join(root, 'docs/OTGRUZKA-SKILLS-GUIDE.md')

const notes = []
if (!existsSync(stateFile)) notes.push('MISSING .cursor/context/CURRENT_STATE.md')
if (!existsSync(guideFile)) notes.push('MISSING docs/OTGRUZKA-SKILLS-GUIDE.md')

if (notes.length > 0) {
  // Visible in Hooks output channel; do not auto-continue the agent loop.
  console.error(`[otgruzka stop-memory-check] ${notes.join('; ')}`)
} else {
  // Light note only in Hooks log — never followup_message for non-critical drift.
  try {
    const head = readFileSync(stateFile, 'utf8').slice(0, 120).replace(/\s+/g, ' ')
    console.error(`[otgruzka stop-memory-check] ok — CURRENT_STATE present (${head}…)`)
  } catch {
    console.error('[otgruzka stop-memory-check] ok')
  }
}

process.stdout.write(JSON.stringify({}))
process.exit(0)

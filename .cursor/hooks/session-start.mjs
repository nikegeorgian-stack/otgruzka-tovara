#!/usr/bin/env node
/**
 * sessionStart — inject Otgruzka project index (read-only).
 * Official output: { env?, additional_context? }
 * Docs: https://cursor.com/docs/hooks#sessionstart
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.env.CURSOR_PROJECT_DIR || process.cwd()
const statePath = '.cursor/context/CURRENT_STATE.md'
const hasState = existsSync(join(root, statePath))

const additional_context = [
  'Otgruzka agent index (sessionStart):',
  hasState
    ? `1) Read ${statePath} first for current task / open issues / next step.`
    : '1) CURRENT_STATE.md missing — create/update .cursor/context/CURRENT_STATE.md.',
  '2) Skills guide: docs/OTGRUZKA-SKILLS-GUIDE.md (canonical skills: .cursor/skills/).',
  '3) Cross-module / store / SQL / roles / warehouse / payroll / production: invoke project-guardian (readonly) before edits.',
  '4) Do not invoke project-guardian for pure CSS/copy/i18n-typo fixes.',
  '5) Data truth: SQL Connect — no clear/import/migrate/deploy without explicit user request.',
].join('\n')

process.stdout.write(JSON.stringify({ additional_context }))
process.exit(0)

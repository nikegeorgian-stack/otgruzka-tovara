#!/usr/bin/env node
/**
 * preCompact — observational only; cannot block compaction.
 * Official output: { user_message? }
 * Docs: https://cursor.com/docs/hooks#precompact
 */
const user_message = [
  'Context compaction: before continuing, update .cursor/context/CURRENT_STATE.md',
  '(current task, done, next step, modules touched). Do not store secrets or PII.',
].join(' ')

process.stdout.write(JSON.stringify({ user_message }))
process.exit(0)

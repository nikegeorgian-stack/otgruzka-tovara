/**
 * PHASE G5.1 — memory-mode smoke (no live emulator / no prod credentials).
 *
 * When FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS is set,
 * exits 0 with a clear skip message (never hits production).
 * Otherwise runs the in-memory G5.1 vitest suite (mocked Data Connect).
 *
 * Usage: node scripts/g51-live-emulator-smoke.mjs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function log(msg) {
  process.stdout.write(`[g51-memory-smoke] ${msg}\n`)
}

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  log('Service-account env is set — skipping (refusing live/prod credentials).')
  log('Unset FIREBASE_SERVICE_ACCOUNT_JSON / GOOGLE_APPLICATION_CREDENTIALS to run memory smoke.')
  process.exit(0)
}

log('Running in-memory G5.1 vitest suite (mocked Data Connect)…')
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  [
    'vitest',
    'run',
    'tests/g51IssuedToLineMrp.test.ts',
    'tests/g51ProcurementReceiptSafety.test.ts',
    'tests/g51SalesShipmentCas.test.ts',
    'tests/g51SecurityConcurrency.test.ts',
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Scrub accidental prod project pointers
      GCLOUD_PROJECT: 'demo-otgruzka',
      GOOGLE_CLOUD_PROJECT: 'demo-otgruzka',
    },
    shell: process.platform === 'win32',
  },
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
log('OK — G5.1 memory smoke passed')

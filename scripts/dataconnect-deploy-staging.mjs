/**
 * Deploy Data Connect schema + connectors to otgruzka-tovara-stg ONLY.
 * Uses dataconnect.staging.yaml overlay; does not alter production dataconnect.yaml.
 *
 * Usage: node scripts/dataconnect-deploy-staging.mjs
 */
import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dcDir = path.join(root, 'fst-web', 'dataconnect')
const prodYaml = path.join(dcDir, 'dataconnect.yaml')
const stagingYaml = path.join(dcDir, 'dataconnect.staging.yaml')
const backupYaml = path.join(dcDir, 'dataconnect.yaml.r24-prod-backup')
const PROJECT = 'otgruzka-tovara-stg'

if (!existsSync(stagingYaml)) {
  console.error('missing dataconnect.staging.yaml')
  process.exit(1)
}
if (!existsSync(prodYaml)) {
  console.error('missing dataconnect.yaml')
  process.exit(1)
}

copyFileSync(prodYaml, backupYaml)
copyFileSync(stagingYaml, prodYaml)

let exitCode = 1
try {
  console.log(`Deploying Data Connect to project=${PROJECT} (staging overlay active)`)
  const r = spawnSync(
    'npx',
    ['-y', 'firebase-tools@latest', 'deploy', '--only', 'dataconnect', '--project', PROJECT, '--non-interactive'],
    { cwd: path.join(root, 'fst-web'), stdio: 'inherit', shell: true },
  )
  exitCode = r.status ?? 1
} finally {
  copyFileSync(backupYaml, prodYaml)
  unlinkSync(backupYaml)
  console.log('Restored production dataconnect.yaml')
}

process.exit(exitCode)

/**
 * Push VITE_* from fst-web/.env.production to Vercel (project fst-uchet).
 * Run: node scripts/sync-vercel-env.mjs
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fstWeb = path.join(root, 'fst-web')
const envTarget = path.join(fstWeb, '.env.target')
const envFile = path.join(fstWeb, '.env.production')

if (!existsSync(envFile) && existsSync(envTarget)) {
  const { copyFileSync } = await import('node:fs')
  copyFileSync(envTarget, envFile)
  console.log('Copied .env.target -> .env.production')
}

if (!existsSync(envFile)) {
  console.error('Missing fst-web/.env.production (or .env.target)')
  process.exit(1)
}

const vars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FST_WEB',
]

const content = readFileSync(envFile, 'utf8')
const values = {}
for (const name of vars) {
  const m = content.match(new RegExp(`^${name}=(.+)$`, 'm'))
  if (m) values[name] = m[1].trim().replace(/^"|"$/g, '')
}

process.chdir(root)
if (!existsSync(path.join(root, '.vercel'))) {
  console.error('Сначала выполните: vercel link (под nikegeorgian@gmail.com)')
  process.exit(1)
}

for (const [name, val] of Object.entries(values)) {
  if (!val) continue
  console.log(`Setting ${name}...`)
  for (const env of ['production', 'preview', 'development']) {
    execSync(
      `vercel env add ${name} ${env} --value "${val.replace(/"/g, '\\"')}" --force --yes --no-sensitive`,
      { stdio: 'inherit', shell: true },
    )
  }
}

console.log('Done. Run: vercel --prod')

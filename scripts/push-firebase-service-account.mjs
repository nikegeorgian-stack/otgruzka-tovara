/**
 * Push Firebase Admin service account JSON to Vercel (FIREBASE_SERVICE_ACCOUNT_JSON).
 *
 * 1) Firebase Console → otgruzka-tovara → Project settings → Service accounts
 *    → Generate new private key → save as fst-web/service-account.json
 * 2) Run: node scripts/push-firebase-service-account.mjs
 *
 * Or: $env:FST_SERVICE_ACCOUNT_PATH="C:\path\key.json"; node scripts/push-firebase-service-account.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expectedProject = 'otgruzka-tovara'
const envName = 'FIREBASE_SERVICE_ACCOUNT_JSON'

const candidates = [
  process.env.FST_SERVICE_ACCOUNT_PATH,
  path.join(root, 'fst-web/service-account.json'),
  path.join(root, 'fst-web/service-account.otgruzka.json'),
].filter(Boolean)

const saPath = candidates.find((p) => existsSync(p))
if (!saPath) {
  console.error('Не найден service account JSON.')
  console.error('')
  console.error('Скачайте ключ для проекта otgruzka-tovara:')
  console.error('  https://console.firebase.google.com/project/otgruzka-tovara/settings/serviceaccounts/adminsdk')
  console.error('')
  console.error('Сохраните как fst-web/service-account.json (файл в .gitignore)')
  console.error('или задайте: $env:FST_SERVICE_ACCOUNT_PATH="C:\\path\\key.json"')
  process.exit(1)
}

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(saPath, 'utf8'))
} catch {
  console.error('Не удалось прочитать JSON:', saPath)
  process.exit(1)
}

if (serviceAccount.project_id !== expectedProject) {
  console.error(
    `Неверный project_id: ${serviceAccount.project_id}, нужен ${expectedProject}`,
  )
  process.exit(1)
}

const vc = path.join(
  process.env.APPDATA ?? '',
  'npm',
  'node_modules',
  'vercel',
  'dist',
  'vc.js',
)

if (!existsSync(path.join(root, '.vercel'))) {
  console.log('Привязка Vercel: otgruzka-tovara …')
  execFileSync(
    process.execPath,
    [vc, 'link', '--yes', '--project', 'otgruzka-tovara'],
    { cwd: root, stdio: 'inherit' },
  )
}

const jsonOneLine = JSON.stringify(serviceAccount)

console.log('Service account:', serviceAccount.client_email ?? saPath)
console.log('Project:', serviceAccount.project_id)
console.log('Pushing to Vercel as', envName, '…')

for (const target of [
  { env: 'production' },
  { env: 'preview', allBranches: true },
  { env: 'development' },
]) {
  console.log(`  → ${target.env}`)
  const args = [vc, 'env', 'add', envName, target.env, '--force', '--yes', '--sensitive']
  if (target.allBranches) args.push('--')
  try {
    execFileSync(process.execPath, args, {
      cwd: root,
      input: jsonOneLine,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  } catch (err) {
    if (target.env === 'production') throw err
    console.warn(`  (пропуск ${target.env}:`, err.message?.split('\n')[0] ?? err, ')')
  }
}

console.log('')
console.log('Готово. Передеплой: npm run deploy:otgruzka:quick')

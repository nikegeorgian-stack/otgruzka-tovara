/**
 * Копирует проект на E:\Fibercell-FST
 * Run: node scripts/setup-e-drive.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const dst = 'E:/Fibercell-FST-pack'

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.vercel',
  '.git',
  '.cursor',
  'graphify-out',
])
const SKIP_FILES = new Set([
  '.env',
  '.env.production',
  '.env.target',
])

function shouldSkip(rel) {
  const parts = rel.split(/[/\\]/)
  if (parts.some((p) => SKIP_DIRS.has(p))) return true
  const base = parts[parts.length - 1]
  if (SKIP_FILES.has(base)) return true
  if (base.startsWith('.env.vercel')) return true
  return false
}

function copyTree(src, dest, rel = '') {
  for (const name of readdirSync(src)) {
    const relPath = rel ? `${rel}/${name}` : name
    if (shouldSkip(relPath)) continue
    const from = join(src, name)
    const to = join(dest, name)
    const st = statSync(from)
    if (st.isDirectory()) {
      mkdirSync(to, { recursive: true })
      copyTree(from, to, relPath)
    } else {
      const parent = join(to, '..')
      mkdirSync(parent, { recursive: true })
      try {
        writeFileSync(to, readFileSync(from))
      } catch (err) {
        console.warn(`  skip: ${relPath} (${err.code ?? err.message})`)
      }
    }
  }
}

if (!existsSync('E:\\')) {
  console.error('Диск E: не найден')
  process.exit(1)
}

console.log(`Копирование → ${dst}`)
mkdirSync(dst, { recursive: true })
copyTree(root, dst)

const readme = `# Fibercell FST — пакет для переноса

Папка: E:\\Fibercell-FST

## 1. Установка (уже выполнена npm install ниже)

## 2. Скачать базу из текущего Firebase

\`\`\`powershell
cd E:\\Fibercell-FST
$env:FST_SOURCE_PASSWORD="пароль admin@fibercell.net"
npm run export:cloud-backup -- --out=E:\\Fibercell-FST\\cloud-backup
\`\`\`

## 3. На новом аккаунте Firebase

1. Создайте проект, Firestore, Auth (Email)
2. Скопируйте fst-web\\.env.target.example → .env.target, заполните ключи
3. Создайте пользователей (те же email)
4. Импорт:

\`\`\`powershell
$env:FST_TARGET_PASSWORD="пароль в новом проекте"
npm run import:cloud-backup -- --in=E:\\Fibercell-FST\\cloud-backup
npm run switch:firebase-project
cd fst-web && firebase login && firebase use <NEW_ID> && npm run deploy:firestore-rules
cd .. && vercel login && vercel link && vercel --prod
\`\`\`

Текущий Firebase: fst-uchet-14c02
Production URL: https://fst-uchet-theta.vercel.app
`
writeFileSync(join(dst, 'README-MIGRATION.md'), readme, 'utf8')

console.log('npm install...')
try {
  execSync('npm install', { cwd: dst, stdio: 'inherit' })
} catch (err) {
  console.warn('\n⚠ npm install не завершился на этом ПК — выполните вручную:')
  console.warn(`  cd ${dst}`)
  console.warn('  npm install')
}

console.log(`\nГотово: ${dst}`)
console.log('Экспорт базы: $env:FST_SOURCE_PASSWORD="..."; npm run export:cloud-backup -- --out=E:/Fibercell-FST-pack/cloud-backup')

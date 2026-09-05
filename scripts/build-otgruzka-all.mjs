/**
 * Сборка трёх дистрибутивов Otgruzka (единая база Firestore otgruzka-tovara).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function run(script) {
  console.log(`\n>>> ${script}\n`)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
    cwd: root,
    stdio: 'inherit',
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('build-windows.mjs')
run('build-android-apk.mjs')

const apkSrc = path.join(root, 'release', 'fst-fibercell-debug.apk')
const apkDest = path.join(root, 'release', 'otgruzka.apk')
if (fs.existsSync(apkSrc)) fs.copyFileSync(apkSrc, apkDest)

console.log('\n=== Otgruzka — три варианта (одна база Firestore) ===')
console.log('  Web:     fst-web/dist → Vercel / Firebase Hosting')
console.log('  APK:     release/otgruzka.apk')
console.log('  Windows: release/otgruzka-setup.exe')
console.log('  База:    Firebase otgruzka-tovara\n')

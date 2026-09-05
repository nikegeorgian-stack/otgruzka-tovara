/**
 * Windows installer (Electron): fst-web build → fst-desktop/app → NSIS setup.exe
 * Единая база: Firebase Firestore otgruzka-tovara (как веб и APK).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'fst-web')
const desktop = path.join(root, 'fst-desktop')
const appDir = path.join(desktop, 'app')
const releaseDir = path.join(root, 'release', 'windows')

function fail(msg) {
  console.error(`\n[build:windows] ${msg}\n`)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}\n`)
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) fail(`Command failed: ${cmd} ${args.join(' ')}`)
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    if (fs.statSync(from).isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function ensureEnvProduction() {
  const target = path.join(web, '.env.target')
  const prod = path.join(web, '.env.production')
  const env = path.join(web, '.env')
  if (fs.existsSync(target)) {
    fs.copyFileSync(target, prod)
    console.log('Using fst-web/.env.target → .env.production')
    return
  }
  if (fs.existsSync(prod)) {
    console.log('Using existing fst-web/.env.production')
    return
  }
  if (fs.existsSync(env)) {
    fs.copyFileSync(env, prod)
    console.log('Using fst-web/.env → .env.production')
    return
  }
  fail(
    'Нет Firebase-конфига: создайте fst-web/.env.target (см. .env.example) или fst-web/.env.production',
  )
}

function ensureDesktopIcon() {
  // electron-builder требует PNG ≥ 256×256. Готовый файл: fst-desktop/build/icon.png
  // (сгенерировать: scripts/make-desktop-icon.ps1)
  const buildDir = path.join(desktop, 'build')
  const iconDest = path.join(buildDir, 'icon.png')
  if (fs.existsSync(iconDest)) return
  const iconSrc = path.join(
    web,
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  )
  if (!fs.existsSync(iconSrc)) return
  fs.mkdirSync(buildDir, { recursive: true })
  fs.copyFileSync(iconSrc, iconDest)
  console.log(
    'WARNING: icon.png may be <256px — run scripts/make-desktop-icon.ps1 if NSIS fails',
  )
}

function ensureDesktopDeps() {
  const desktopNodeModules = path.join(desktop, 'node_modules')
  const localElectron = path.join(desktopNodeModules, 'electron')
  const rootElectron = path.join(root, 'node_modules', 'electron')
  const rootBuilder = path.join(root, 'node_modules', 'electron-builder')

  if (!fs.existsSync(localElectron)) {
    if (fs.existsSync(rootElectron)) {
      fs.mkdirSync(desktopNodeModules, { recursive: true })
      const linkType = process.platform === 'win32' ? 'junction' : 'dir'
      fs.symlinkSync(rootElectron, localElectron, linkType)
      console.log('Linked root electron → fst-desktop/node_modules/electron')
    } else {
      run('npm', ['install'], { cwd: desktop })
    }
  }

  const localBuilder = path.join(desktopNodeModules, 'electron-builder')
  if (!fs.existsSync(localBuilder) && fs.existsSync(rootBuilder)) {
    fs.mkdirSync(desktopNodeModules, { recursive: true })
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    fs.symlinkSync(rootBuilder, localBuilder, linkType)
    console.log('Linked root electron-builder → fst-desktop/node_modules/electron-builder')
  }
}

console.log('=== Otgruzka Windows build ===')
ensureEnvProduction()
ensureDesktopIcon()

run('npm', ['run', 'build'], { cwd: web })

const dist = path.join(web, 'dist')
if (!fs.existsSync(path.join(dist, 'index.html'))) fail(`Build missing: ${dist}/index.html`)

if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true })
copyDir(dist, appDir)
console.log(`Copied web dist → ${appDir}`)

ensureDesktopDeps()

run('npm', ['run', 'dist', '--workspace=fst-desktop'], { cwd: root })

const setup = fs
  .readdirSync(releaseDir)
  .find((f) => f.startsWith('otgruzka-setup') && f.endsWith('.exe'))
if (setup) {
  const src = path.join(releaseDir, setup)
  const dest = path.join(root, 'release', 'otgruzka-setup.exe')
  fs.copyFileSync(src, dest)
  console.log(`\nInstaller ready:\n  ${dest}\n  ${src}\n`)
} else {
  console.log(`\nBuild finished. Check: ${releaseDir}\n`)
}

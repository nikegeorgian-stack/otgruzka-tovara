/**
 * Build debug APK via Capacitor:
 * 1) Vite build with relative base
 * 2) cap sync android
 * 3) gradlew assembleDebug
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = path.join(root, 'fst-web')
const androidDir = path.join(web, 'android')

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}\n`)
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? web,
    env: { ...process.env, ...opts.env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) fail(`Command failed (${r.status}): ${cmd} ${args.join(' ')}`)
}

const javaCandidates = [
  process.env.JAVA_HOME,
  'C:\\Program Files\\Microsoft\\jdk-21.0.11.10-hotspot',
  'C:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot',
].filter(Boolean)
const javaHome =
  javaCandidates.find((j) =>
    fs.existsSync(path.join(j, 'bin', 'java.exe')) || fs.existsSync(path.join(j, 'bin', 'java')),
  ) || javaCandidates[0]
const androidHome =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk')

if (!fs.existsSync(path.join(javaHome, 'bin', 'java.exe')) && !fs.existsSync(path.join(javaHome, 'bin', 'java'))) {
  fail(`JAVA_HOME not found: ${javaHome}\nInstall OpenJDK 17 or set JAVA_HOME.`)
}
if (!fs.existsSync(androidHome)) {
  fail(`Android SDK not found: ${androidHome}\nInstall Android Studio SDK or set ANDROID_HOME.`)
}

const env = {
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  CAPACITOR_BUILD: '1',
  PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${path.join(androidHome, 'platform-tools')}${path.delimiter}${process.env.PATH || ''}`,
}

if (!fs.existsSync(path.join(web, '.env')) && !fs.existsSync(path.join(web, '.env.production'))) {
  console.warn('Warning: fst-web/.env missing — Firebase config may be empty in the APK.')
}

await import(pathToFileURL(path.join(root, 'scripts', 'bump-android-version.mjs')).href)

run('npm', ['run', 'build'], { env })

if (!fs.existsSync(androidDir)) {
  run('npx', ['cap', 'add', 'android'], { env })
} else {
  run('npx', ['cap', 'sync', 'android'], { env })
}

const localProps = path.join(androidDir, 'local.properties')
const sdkPath = androidHome.replace(/\\/g, '/')
fs.writeFileSync(localProps, `sdk.dir=${sdkPath}\n`, 'utf8')

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
run(gradlew, ['assembleDebug', '--no-daemon'], { cwd: androidDir, env })

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const outDir = path.join(root, 'release')
const publicDownloads = path.join(web, 'public', 'downloads')
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(publicDownloads, { recursive: true })
const dest = path.join(outDir, 'fst-fibercell-debug.apk')
if (!fs.existsSync(apk)) fail(`APK not found: ${apk}`)
fs.copyFileSync(apk, dest)
const alias = path.join(outDir, 'otgruzka.apk')
fs.copyFileSync(apk, alias)
for (const name of ['fst-fibercell.apk', 'otgruzka.apk']) {
  fs.copyFileSync(apk, path.join(publicDownloads, name))
}

await import(pathToFileURL(path.join(root, 'scripts', 'write-app-version.mjs')).href)

console.log(`\nAPK ready:\n  ${dest}\n  ${alias}\n  ${path.join(publicDownloads, 'fst-fibercell.apk')}\n`)

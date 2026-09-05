/**
 * Пишет fst-web/public/downloads/app-version.json для проверки обновлений APK.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gradlePath = path.join(root, 'fst-web', 'android', 'app', 'build.gradle')
const downloadsDir = path.join(root, 'fst-web', 'public', 'downloads')
const apkPath = path.join(downloadsDir, 'fst-fibercell.apk')
const indexPath = path.join(root, 'fst-web', 'dist', 'index.html')

const gradle = fs.readFileSync(gradlePath, 'utf8')
const code = Number.parseInt(gradle.match(/versionCode\s+(\d+)/)?.[1] ?? '0', 10)
const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? '0'

let webBundle = ''
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8')
  webBundle = html.match(/assets\/(index-[^"]+\.js)/)?.[1] ?? ''
}

const manifest = {
  apkVersionCode: code,
  apkVersionName: name,
  apkUrl: '/downloads/fst-fibercell.apk',
  apkSizeBytes: fs.existsSync(apkPath) ? fs.statSync(apkPath).size : undefined,
  webBundle: webBundle || undefined,
  builtAt: new Date().toISOString(),
}

fs.mkdirSync(downloadsDir, { recursive: true })
fs.writeFileSync(
  path.join(downloadsDir, 'app-version.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
console.log('app-version.json:', manifest)

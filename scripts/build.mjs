/**
 * Vercel build entry (fb-cell-admin-s-projects/fst-uchet).
 * Output: ./dist (копия fst-web/dist)
 */
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'fst-web', 'dist')
const out = path.join(root, 'dist')

execSync('npm run build:fst-web', { cwd: root, stdio: 'inherit' })

const isWin = process.platform === 'win32'
if (isWin) {
  execSync(`powershell -NoProfile -Command "if (Test-Path '${out}') { Remove-Item -Recurse -Force '${out}' }; Copy-Item -Path '${src}' -Destination '${out}' -Recurse -Force"`, {
    stdio: 'inherit',
  })
} else {
  execSync(`rm -rf "${out}" && cp -r "${src}" "${out}"`, { stdio: 'inherit', shell: true })
}

console.log('build.mjs: copied fst-web/dist → dist')

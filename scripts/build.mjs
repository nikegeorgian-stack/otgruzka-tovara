/**
 * Vercel build entry (fb-cell-admin-s-projects/fst-uchet).
 * Output: ./dist (копия fst-web/dist)
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'fst-web', 'dist')
const out = path.join(root, 'dist')

/** Public Firebase web config (API key is client-visible). Ensures Vercel build always has VITE_* . */
function loadFirebaseBuildEnv() {
  const env = { ...process.env }
  const jsonPath = path.join(root, 'fst-web', 'firebase.client.json')
  if (existsSync(jsonPath)) {
    const cfg = JSON.parse(readFileSync(jsonPath, 'utf8'))
    for (const [k, v] of Object.entries(cfg)) {
      if (v) env[k] = String(v)
    }
  }
  const dotEnv = path.join(root, 'fst-web', '.env.production')
  if (existsSync(dotEnv)) {
    for (const line of readFileSync(dotEnv, 'utf8').split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (k && v && !env[k]) env[k] = v
    }
  }
  return env
}

execSync('npm run build:fst-web', { cwd: root, stdio: 'inherit', env: loadFirebaseBuildEnv() })

rmSync(out, { recursive: true, force: true })
cpSync(src, out, { recursive: true })

console.log('build.mjs: copied fst-web/dist → dist')

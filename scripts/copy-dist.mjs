import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'fst-web', 'dist')
const out = path.join(root, 'dist')
rmSync(out, { recursive: true, force: true })
cpSync(src, out, { recursive: true })
console.log('copied:', existsSync(path.join(out, 'index.html')))

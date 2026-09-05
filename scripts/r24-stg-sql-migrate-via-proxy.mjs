/**
 * Staging-only SQL migrate via Cloud SQL Auth Proxy + firebase access_token.
 * Never logs tokens. Project: otgruzka-tovara-stg only.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const cfgPath = path.join(process.env.USERPROFILE || '', '.config/configstore/firebase-tools.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const token = cfg.tokens?.access_token
const exp = Number(cfg.tokens?.expires_at || 0)
if (!token || exp <= Date.now() + 60_000) {
  console.error('ACCESS_TOKEN_EXPIRED — run: firebase login')
  process.exit(2)
}

let raw = fs.readFileSync(path.join(root, 'tmp-stg-sql-diff.txt'), 'utf8')
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
const lines = raw.split('\n')
const seen = new Set()
const stmts = []
let buf = []
let capturing = false
let currentName = null
for (const line of lines) {
  const t = line.trimStart()
  if (t.startsWith('CREATE TABLE')) {
    capturing = true
    buf = [t]
    currentName = (t.match(/CREATE TABLE "public"\."([^"]+)"/) || [])[1] || null
    continue
  }
  if (capturing) {
    buf.push(line.trimEnd())
    if (line.trim() === ');' || line.trim() === ')') {
      if (currentName && !seen.has(currentName)) {
        seen.add(currentName)
        const sql = buf.join('\n').replace(/\)\s*$/, ');')
        stmts.push(sql)
      }
      capturing = false
      buf = []
      currentName = null
    }
  }
}
fs.writeFileSync(path.join(root, 'tmp-stg-migrate.sql'), stmts.join('\n\n') + '\n')
console.log('tables=' + [...seen].join(','))
if (stmts.length === 0) {
  console.error('NO_CREATE_STATEMENTS')
  process.exit(1)
}

const proxyBin = path.join(root, 'cloud-sql-proxy.exe')
const proxy = spawn(
  proxyBin,
  [
    'otgruzka-tovara-stg:europe-west3:otgruzka-tovara-stg-instance',
    '--address',
    '127.0.0.1',
    '--port',
    '9470',
    '--token',
    token,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

let ready = false
const onChunk = (buf) => {
  const s = buf.toString()
  if (/ready for new connections|Listening/i.test(s)) ready = true
}
proxy.stdout.on('data', onChunk)
proxy.stderr.on('data', onChunk)

await new Promise((resolve, reject) => {
  const t0 = Date.now()
  const i = setInterval(() => {
    if (ready) {
      clearInterval(i)
      resolve()
    } else if (Date.now() - t0 > 45000) {
      clearInterval(i)
      reject(new Error('proxy_timeout'))
    }
  }, 400)
})
console.log('PROXY_READY')

let pg
try {
  pg = require('pg')
} catch {
  execSync('npm install pg --no-save --no-audit --no-fund', { cwd: root, stdio: 'inherit' })
  pg = require('pg')
}

const client = new pg.Client({
  host: '127.0.0.1',
  port: 9470,
  database: 'otgruzka-tovara-stg-database',
  user: 'nikegeorgian@gmail.com',
  password: token,
  ssl: false,
})

try {
  await client.connect()
  console.log('PG_CONNECTED')
  for (const s of stmts) {
    await client.query(s)
    const name = (s.match(/"public"\."([^"]+)"/) || [])[1]
    console.log('OK_CREATE ' + name)
  }
  console.log('MIGRATE_DONE')
} catch (e) {
  console.error('PG_ERR ' + e.message)
  process.exitCode = 1
} finally {
  try {
    await client.end()
  } catch {}
  proxy.kill()
}

import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const cfg = JSON.parse(
  fs.readFileSync(path.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'),
)
const token = cfg.tokens.access_token
if (!token || Number(cfg.tokens.expires_at) <= Date.now() + 60_000) {
  console.error('ACCESS_TOKEN_EXPIRED')
  process.exit(2)
}

const proxy = spawn(
  path.join(root, 'cloud-sql-proxy.exe'),
  [
    'otgruzka-tovara-stg:europe-west3:otgruzka-tovara-stg-instance',
    '--address',
    '127.0.0.1',
    '--port',
    '9471',
    '--token',
    token,
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
let ready = false
const on = (b) => {
  if (/ready for new connections|Listening/i.test(b.toString())) ready = true
}
proxy.stdout.on('data', on)
proxy.stderr.on('data', on)
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
  }, 300)
})

let pg
try {
  pg = require('pg')
} catch {
  execSync('npm install pg --no-save --no-audit --no-fund', { cwd: root, stdio: 'inherit' })
  pg = require('pg')
}

const client = new pg.Client({
  host: '127.0.0.1',
  port: 9471,
  database: 'otgruzka-tovara-stg-database',
  user: 'nikegeorgian@gmail.com',
  password: token,
  ssl: false,
})
try {
  await client.connect()
  const r = await client.query(
    `select table_schema, table_name from information_schema.tables where table_schema='public' order by table_name`,
  )
  console.log('TABLE_COUNT=' + r.rows.length)
  for (const row of r.rows) console.log(row.table_schema + '.' + row.table_name)
  const db = await client.query('select current_database(), current_user')
  console.log(JSON.stringify(db.rows[0]))
} finally {
  try {
    await client.end()
  } catch {}
  proxy.kill()
}

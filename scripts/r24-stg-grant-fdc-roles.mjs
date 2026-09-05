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

const writer = 'firebasewriter_otgruzka-tovara-stg-database_public'
const reader = 'firebasereader_otgruzka-tovara-stg-database_public'
const owner = 'firebaseowner_otgruzka-tovara-stg-database_public'

const proxy = spawn(
  path.join(root, 'cloud-sql-proxy.exe'),
  [
    'otgruzka-tovara-stg:europe-west3:otgruzka-tovara-stg-instance',
    '--address',
    '127.0.0.1',
    '--port',
    '9472',
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
  port: 9472,
  database: 'otgruzka-tovara-stg-database',
  user: 'nikegeorgian@gmail.com',
  password: token,
  ssl: false,
})

const grants = `
GRANT ALL ON ALL TABLES IN SCHEMA public TO "${owner}";
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO "${writer}";
GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${reader}";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${writer}";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${reader}";
ALTER TABLE fst_command_receipt OWNER TO "${owner}";
ALTER TABLE fst_critical_store OWNER TO "${owner}";
ALTER TABLE fst_principal_access OWNER TO "${owner}";
ALTER TABLE fst_store OWNER TO "${owner}";
ALTER TABLE journal_event OWNER TO "${owner}";
ALTER TABLE qc_attachment_record OWNER TO "${owner}";
ALTER TABLE qc_finished_goods_lot OWNER TO "${owner}";
ALTER TABLE qc_lot_decision OWNER TO "${owner}";
ALTER TABLE qc_permission OWNER TO "${owner}";
`

try {
  await client.connect()
  await client.query(grants)
  console.log('GRANTS_OK')
} catch (e) {
  console.error('GRANT_ERR ' + e.message)
  process.exitCode = 1
} finally {
  try {
    await client.end()
  } catch {}
  proxy.kill()
}

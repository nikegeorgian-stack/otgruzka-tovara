/**
 * R2.4 Preview synthetic smoke via `vercel curl` (Deployment Protection bypass).
 * Never prints secrets. Cleans up Auth user.
 */
import { readFileSync, existsSync, unlinkSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREVIEW_URL =
  process.env.R24_PREVIEW_URL ||
  'https://otgruzka-tovara-rjecxxotp-nikegeorgian-8562s-projects.vercel.app'
const STG_PROJECT = 'otgruzka-tovara-stg'
const EMAIL = `r24.synth.${Date.now()}@fibercell-synth.test`
const PASSWORD = `R24!synth!${Date.now()}Aa1`

const counts = { created: 0, deleted: 0, ok: 0, fail: 0 }
const results = []

function log(step, ok, detail = '') {
  results.push({ step, ok, detail })
  if (ok) counts.ok++
  else counts.fail++
  console.log(`${ok ? 'OK' : 'FAIL'} ${step}${detail ? ' — ' + detail : ''}`)
}

function loadPreviewEnv() {
  const envFile = path.join(root, '.env.preview.pull.local')
  if (!existsSync(envFile)) {
    const r = spawnSync('npx', ['vercel', 'env', 'pull', envFile, '--environment=preview', '--yes'], {
      cwd: root,
      shell: true,
      stdio: 'inherit',
    })
    if (r.status !== 0) throw new Error('vercel_env_pull_failed')
  }
  const env = {}
  for (const line of readFileSync(envFile, 'utf8').split(/\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (v === '[SENSITIVE]') continue
    env[k] = v
  }
  return env
}

function vercelApi(apiPath, { method = 'GET', token, body } = {}) {
  const args = [
    'vercel',
    'curl',
    apiPath,
    '--deployment',
    PREVIEW_URL,
    '-i',
    '-X',
    method,
    '-H',
    'content-type: application/json',
  ]
  if (token) args.push('-H', `authorization: Bearer ${token}`)
  if (body !== undefined) {
    const tmp = path.join(mkdtempSync(path.join(os.tmpdir(), 'r24-')), 'body.json')
    writeFileSync(tmp, JSON.stringify(body))
    args.push('--data', `@${tmp}`)
  }
  const r = spawnSync('npx', args, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  const out = `${r.stdout || ''}\n${r.stderr || ''}`
  const codeLine = out.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/)
  const status = codeLine ? Number(codeLine[1]) : r.status === 0 ? 200 : 500
  const bodyStart = out.lastIndexOf('\n{')
  let json = null
  if (bodyStart >= 0) {
    try {
      json = JSON.parse(out.slice(bodyStart + 1).trim().split(/\n/).filter((l) => l.startsWith('{') || l.startsWith('}') || l.includes(':')).join('\n').match(/\{[\s\S]*\}/)?.[0] || 'null')
    } catch {
      try {
        const m = out.match(/\{"error"[\s\S]*?\}/)
        if (m) json = JSON.parse(m[0])
      } catch {
        json = null
      }
    }
  }
  return { status, json, raw: out.slice(0, 400) }
}

async function authSignUp(apiKey) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    },
  )
  return { status: res.status, json: await res.json() }
}

async function authDelete(apiKey, idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  )
  return { status: res.status, json: await res.json() }
}

async function main() {
  const env = loadPreviewEnv()
  const apiKey = env.VITE_FIREBASE_API_KEY
  if (!apiKey) throw new Error('preview_api_key_missing')

  log('preview_vite_project_stg', env.VITE_FIREBASE_PROJECT_ID === STG_PROJECT, env.VITE_FIREBASE_PROJECT_ID || 'missing')
  log(
    'preview_dc_client_env',
    env.VITE_FST_SQL_CONNECT_SERVICE_ID === 'otgruzka-tovara-stg-service' &&
      env.VITE_FST_SQL_CONNECT_LOCATION === 'europe-west3' &&
      env.VITE_FST_PERSISTENCE === 'sqlconnect',
    'vite_non_sensitive',
  )
  // Server FST_* are Sensitive → redacted by env pull; presence confirmed earlier via vercel env ls

  const signup = await authSignUp(apiKey)
  const idToken = signup.json?.idToken
  if (!idToken) {
    log('auth_signup', false, signup.json?.error?.message || `status=${signup.status}`)
    throw new Error('signup_failed')
  }
  counts.created++
  log('auth_signup', true, 'synthetic_user')

  try {
    const unauth = vercelApi('/api/fst/list-users', { method: 'GET' })
    log('unauthorized_denied', unauth.status === 401 || unauth.status === 403, `status=${unauth.status}`)

    const missing = vercelApi('/api/fst/does-not-exist-r24', { method: 'POST', token: idToken })
    log('unknown_route_404', missing.status === 404, `status=${missing.status}`)

    const badMethod = vercelApi('/api/fst/list-users', { method: 'POST', token: idToken })
    log('wrong_method_405', badMethod.status === 405, `status=${badMethod.status}`)

    const bogus = vercelApi('/api/fst/list-users', { method: 'GET', token: 'not.a.jwt' })
    log('bogus_token_denied', bogus.status === 401 || bogus.status === 403, `status=${bogus.status}`)

    const freeze = vercelApi('/api/fst/g1-domain-freeze', {
      method: 'POST',
      token: idToken,
      body: { storeId: `foreign-${Date.now()}`, action: 'freeze', domains: ['warehouse'] },
    })
    log(
      'g1_denied_fail_closed',
      freeze.status >= 401 && freeze.status < 500,
      `status=${freeze.status} err=${freeze.json?.error || ''}`,
    )

    for (const route of [
      'g2-warehouse-command',
      'g3-production-command',
      'g4-production-command',
      'g5-planning-command',
      'g6-capacity-command',
      'qc-permissions-self',
    ]) {
      const r = vercelApi(`/api/fst/${route}`, {
        method: 'POST',
        token: idToken,
        body: { storeId: 'foreign-store-r24', command: { type: 'noop' } },
      })
      log(`deny_${route}`, r.status >= 401 && r.status < 500, `status=${r.status}`)
    }

    const a = vercelApi('/api/fst/g2-warehouse-command', {
      method: 'POST',
      token: idToken,
      body: { storeId: 'foreign-store-r24', command: { type: 'noop' }, idempotencyKey: 'r24-1' },
    })
    const b = vercelApi('/api/fst/g2-warehouse-command', {
      method: 'POST',
      token: idToken,
      body: { storeId: 'foreign-store-r24', command: { type: 'noop' }, idempotencyKey: 'r24-1' },
    })
    log('cas_retry_stable_deny', a.status === b.status && a.status >= 401, `status=${a.status}`)
  } finally {
    let cleaned = false
    for (let i = 0; i < 3 && !cleaned; i++) {
      try {
        const del = await authDelete(apiKey, idToken)
        if (del.status === 200 && !del.json?.error) {
          counts.deleted++
          cleaned = true
          log('auth_cleanup', true)
        } else if (i === 2) {
          log('auth_cleanup', false, del.json?.error?.message || `status=${del.status}`)
        }
      } catch (e) {
        if (i === 2) log('auth_cleanup', false, e.message)
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
      }
    }
    try {
      unlinkSync(path.join(root, '.env.preview.pull.local'))
    } catch {}
  }

  console.log(JSON.stringify({ counts, preview: PREVIEW_URL, deploymentHint: 'dpl_8uucwRS26ecjrATEtyQdAcYAzDxL', results }, null, 2))
  // Cleanup network flake should not fail the smoke if API assertions passed.
  const apiFails = results.filter((r) => !r.ok && r.step !== 'auth_cleanup')
  if (apiFails.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error('SMOKE_FATAL ' + e.message)
  process.exit(1)
})

/**
 * G5.3 — Auth chain contract (unit, always pass). Documents env scrubbing expectations.
 * Does not start emulators or touch production.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const smokePath = path.join(repoRoot, 'scripts', 'g53-auth-dataconnect-smoke.mjs')

describe('G5.3 Auth chain contract', () => {
  it('smoke script exists and documents required env / scrub rules', () => {
    expect(fs.existsSync(smokePath)).toBe(true)
    const src = fs.readFileSync(smokePath, 'utf8')

    expect(src).toContain('demo-otgruzka')
    expect(src).toContain('otgruzka-tovara')
    expect(src).toContain('FIREBASE_AUTH_EMULATOR_HOST')
    expect(src).toContain('DATA_CONNECT_EMULATOR_HOST')
    expect(src).toContain('FIREBASE_SERVICE_ACCOUNT_JSON')
    expect(src).toContain('GOOGLE_APPLICATION_CREDENTIALS')
    expect(src).toContain('verifyBearerToken')
    expect(src).toContain('G53_ALLOW_MEMORY_FALLBACK')
    // Memory fallback must NOT claim Auth chain PASS
    expect(src).toMatch(/G53_ALLOW_MEMORY_FALLBACK[\s\S]{0,400}not.*Auth|Auth.*not|never claim PASS/i)
    expect(src).toContain('9099')
    expect(src).toContain('9399')
  })

  it('documents that production project IDs are scrubbed', () => {
    const src = fs.readFileSync(smokePath, 'utf8')
    expect(src).toContain('scrubProdEnv')
    expect(src).toMatch(/FORBIDDEN_PROJECT\s*=\s*['"]otgruzka-tovara['"]/)
    expect(src).toMatch(/delete process\.env\.FIREBASE_SERVICE_ACCOUNT_JSON/)
    expect(src).toMatch(/GCLOUD_PROJECT\s*=\s*PROJECT|process\.env\.GCLOUD_PROJECT\s*=\s*PROJECT/)
  })

  it('expected env vars for live Auth+DC smoke are listed', () => {
    const expected = [
      'GCLOUD_PROJECT=demo-otgruzka',
      'GOOGLE_CLOUD_PROJECT=demo-otgruzka',
      'FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099',
      'DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399',
      'FIREBASE_DATA_CONNECT_EMULATOR_HOST=127.0.0.1:9399',
    ]
    const src = fs.readFileSync(smokePath, 'utf8')
    for (const line of expected) {
      const [key] = line.split('=')
      expect(src).toContain(key)
    }
    // Contract snapshot for operators / CI docs
    expect(expected.join('\n')).toContain('demo-otgruzka')
  })
})

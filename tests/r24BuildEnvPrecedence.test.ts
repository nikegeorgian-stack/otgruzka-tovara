/**
 * PHASE R2.4 — build.mjs must not overwrite Vercel Preview VITE_* with firebase.client.json.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

describe('r24 build env precedence', () => {
  it('fills missing keys only from firebase.client.json', () => {
    const src = readFileSync(path.join(process.cwd(), 'scripts/build.mjs'), 'utf8')
    expect(src).toMatch(/if \(v && !env\[k\]\) env\[k\] = String\(v\)/)
    expect(src).not.toMatch(/if \(v\) env\[k\] = String\(v\)/)
  })
})

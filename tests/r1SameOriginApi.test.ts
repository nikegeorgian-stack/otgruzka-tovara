import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FST_PRODUCTION_VERCEL_HOST,
  FST_VERCEL_ORIGIN,
  resolveFstApiOrigin,
} from '@/lib/cloud/fstApiOrigin'
import {
  evaluateBrowserOrigin,
} from '../server/fst/_apiOriginPolicy.mjs'
import { rejectCrossOriginBrowser } from '../server/fst/_qcHttp.mjs'

describe('resolveFstApiOrigin', () => {
  it('localhost → relative (empty origin)', () => {
    expect(resolveFstApiOrigin({ hostname: 'localhost' })).toBe('')
    expect(resolveFstApiOrigin({ hostname: '127.0.0.1' })).toBe('')
  })

  it('vercel.app preview ignores prod VITE_FST_API_ORIGIN', () => {
    // Vercel preview hostnames typically contain ---
    const previewWithDashes =
      'otgruzka-tovara-git-safety-xxxx---team.vercel.app'
    const previewWithoutDashes =
      'otgruzka-tovara-git-safety-xxxx-team.vercel.app'
    expect(
      resolveFstApiOrigin({
        hostname: previewWithDashes,
        envOrigin: FST_VERCEL_ORIGIN,
      }),
    ).toBe('')
    expect(
      resolveFstApiOrigin({
        hostname: previewWithoutDashes,
        envOrigin: 'https://otgruzka-tovara.vercel.app/',
      }),
    ).toBe('')
  })

  it('production vercel uses relative', () => {
    expect(
      resolveFstApiOrigin({ hostname: FST_PRODUCTION_VERCEL_HOST }),
    ).toBe('')
  })

  it('firebase hosting uses FST_VERCEL_ORIGIN', () => {
    expect(
      resolveFstApiOrigin({ hostname: 'otgruzka-tovara.web.app' }),
    ).toBe(FST_VERCEL_ORIGIN)
    expect(
      resolveFstApiOrigin({ hostname: 'otgruzka-tovara.firebaseapp.com' }),
    ).toBe(FST_VERCEL_ORIGIN)
  })
})

describe('evaluateBrowserOrigin', () => {
  it('no Origin → allowed (server-to-server / same-origin navigations)', () => {
    const result = evaluateBrowserOrigin({
      headers: { host: 'otgruzka-tovara.vercel.app' },
    })
    expect(result).toEqual({
      sameOrigin: true,
      origin: null,
      blockedCrossOrigin: false,
    })
  })

  it('foreign Origin → blocked', () => {
    const result = evaluateBrowserOrigin({
      headers: {
        host: 'otgruzka-tovara.vercel.app',
        origin: 'https://evil.example',
      },
    })
    expect(result.blockedCrossOrigin).toBe(true)
    expect(result.sameOrigin).toBe(false)
    expect(result.origin).toBe('https://evil.example')
  })

  it('same Origin as host → allowed', () => {
    const result = evaluateBrowserOrigin({
      headers: {
        host: 'otgruzka-tovara.vercel.app',
        origin: 'https://otgruzka-tovara.vercel.app',
      },
    })
    expect(result.blockedCrossOrigin).toBe(false)
    expect(result.sameOrigin).toBe(true)
  })

  it('never returns ACAO * (policy object has no CORS grant)', () => {
    const foreign = evaluateBrowserOrigin({
      headers: {
        host: 'otgruzka-tovara.vercel.app',
        origin: 'https://evil.example',
      },
    })
    expect(JSON.stringify(foreign)).not.toContain('Access-Control-Allow-Origin')
    expect(JSON.stringify(foreign)).not.toMatch(/\*/)

    const headers: Record<string, string> = {}
    const res = {
      status(code: number) {
        return {
          json(body: unknown) {
            headers['__status'] = String(code)
            headers['__body'] = JSON.stringify(body)
          },
        }
      },
      setHeader(name: string, value: string) {
        headers[name] = value
      },
    }
    const rejected = rejectCrossOriginBrowser(
      {
        headers: {
          host: 'otgruzka-tovara.vercel.app',
          origin: 'https://evil.example',
        },
      },
      res,
    )
    expect(rejected).toBe(true)
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined()
    expect(headers['__status']).toBe('403')
    expect(headers['__body']).toContain('cross_origin_api_unsupported')
  })
})

describe('server/fst g1–g6/qc command files: no wildcard CORS', () => {
  it('has zero Access-Control-Allow-Origin: * matches (exclude clear-must-change-password)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    // Handlers live under server/fst after R2.3 catch-all consolidation.
    const apiDir = join(here, '..', 'server', 'fst')
    const files = readdirSync(apiDir).filter((name) => {
      if (name === 'clear-must-change-password.mjs') return false
      return /^(g[1-6]-|qc-).+\.mjs$/i.test(name)
    })
    expect(files.length).toBeGreaterThan(0)

    const hits: string[] = []
    for (const name of files) {
      const text = readFileSync(join(apiDir, name), 'utf8')
      if (/Access-Control-Allow-Origin\s*['"`]:?\s*['"`]\*/.test(text)) {
        hits.push(name)
      }
      if (/Access-Control-Allow-Origin['"`]?\s*,\s*['"`]\*/.test(text)) {
        hits.push(name)
      }
      if (text.includes("Access-Control-Allow-Origin', '*'") ||
          text.includes('Access-Control-Allow-Origin", "*"') ||
          text.includes("Access-Control-Allow-Origin`, `*`") ||
          text.includes("setHeader('Access-Control-Allow-Origin', '*')") ||
          text.includes('setHeader("Access-Control-Allow-Origin", "*")')) {
        hits.push(name)
      }
    }
    expect(hits).toEqual([])
  })
})

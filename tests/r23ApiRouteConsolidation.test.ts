/**
 * Table-driven routing for consolidated Vercel API catch-alls.
 * Public URLs stay /api/fst/* and /api/rs/*; handlers live under server/.
 */
import { describe, expect, it } from 'vitest'
import {
  FST_ROUTE_HANDLERS,
  resolveFstRoutePath,
  resolveFstRouteFromRequest,
  default as fstRouter,
} from '../api/fst/[...path].mjs'
import {
  RS_ROUTE_HANDLERS,
  resolveRsRoutePath,
  resolveRsRouteFromRequest,
  default as rsRouter,
} from '../api/rs/[...path].mjs'

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    setHeader() {
      return this
    },
    end() {
      return this
    },
  }
}

describe('r23 api route consolidation', () => {
  it('maps every registered FST route name to a handler function', () => {
    const expected = [
      'clear-must-change-password',
      'create-user',
      'delete-user',
      'g1-access-admin',
      'g1-domain-freeze',
      'g1-warehouse-get',
      'g1-warehouse-post-document',
      'g2-warehouse-command',
      'g3-production-command',
      'g4-production-command',
      'g5-planning-command',
      'g6-capacity-command',
      'list-users',
      'migrate-cloud-shards',
      'qc-lot-upsert',
      'qc-permissions-admin',
      'qc-permissions-self',
      'qc-regrade',
      'qc-reject',
      'qc-release',
      'qc-shipment',
      'qc-shipment-cancel',
      'qc-upload-finalize',
      'qc-upload-initiate',
      'qc-upload-put',
      'send-push',
      'update-user',
    ]
    expect(Object.keys(FST_ROUTE_HANDLERS).sort()).toEqual(expected.sort())
    for (const name of expected) {
      expect(typeof FST_ROUTE_HANDLERS[name]).toBe('function')
    }
  })

  it('maps every registered RS route name to a handler function', () => {
    expect(Object.keys(RS_ROUTE_HANDLERS).sort()).toEqual(
      ['credentials', 'taxpayer', 'verify'].sort(),
    )
  })

  it('resolves single-segment catch-all path only', () => {
    expect(resolveFstRoutePath('g2-warehouse-command')).toBe('g2-warehouse-command')
    expect(resolveFstRoutePath(['qc-release'])).toBe('qc-release')
    expect(resolveFstRoutePath(['a', 'b'])).toBeNull()
    expect(resolveFstRoutePath('a/b')).toBeNull()
    expect(resolveFstRoutePath('')).toBeNull()
    expect(resolveRsRoutePath('verify')).toBe('verify')
    expect(resolveRsRoutePath(['credentials', 'x'])).toBeNull()
  })

  it('resolves route from request URL when query.path is missing (Vercel catch-all)', () => {
    expect(
      resolveFstRouteFromRequest({ url: '/api/fst/list-users', query: {} }),
    ).toBe('list-users')
    expect(resolveFstRouteFromRequest({ url: '/api/fst/missing', query: {} })).toBe('missing')
    expect(resolveRsRouteFromRequest({ url: '/api/rs/verify', query: {} })).toBe('verify')
    expect(
      resolveFstRouteFromRequest({
        url: '/api/fst/g2-warehouse-command',
        query: { path: 'g2-warehouse-command' },
      }),
    ).toBe('g2-warehouse-command')
  })

  it('returns 404 for unknown FST and RS routes without invoking handlers', async () => {
    const res = mockRes()
    await fstRouter({ method: 'POST', query: { path: 'does-not-exist' } }, res)
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ error: 'not_found' })

    const res2 = mockRes()
    await rsRouter({ method: 'GET', query: { path: 'missing' } }, res2)
    expect(res2.statusCode).toBe(404)
    expect(res2.body).toEqual({ error: 'not_found' })
  })

  it('dispatches to the mapped handler with the same req/res', async () => {
    const calls = []
    const original = FST_ROUTE_HANDLERS['g2-warehouse-command']
    FST_ROUTE_HANDLERS['g2-warehouse-command'] = async (req, res) => {
      calls.push({ method: req.method, path: req.query.path, body: req.body })
      res.status(418).json({ ok: false, error: 'teapot_probe' })
    }
    try {
      const req = { method: 'POST', query: { path: 'g2-warehouse-command' }, body: { storeId: 's1' } }
      const res = mockRes()
      await fstRouter(req, res)
      expect(calls).toEqual([
        { method: 'POST', path: 'g2-warehouse-command', body: { storeId: 's1' } },
      ])
      expect(res.statusCode).toBe(418)
      expect(res.body).toEqual({ ok: false, error: 'teapot_probe' })
    } finally {
      FST_ROUTE_HANDLERS['g2-warehouse-command'] = original
    }
  })

  it('preserves method rejection from underlying handlers (405)', async () => {
    const res = mockRes()
    // list-users only allows GET
    await fstRouter({ method: 'POST', query: { path: 'list-users' }, headers: {} }, res)
    expect(res.statusCode).toBe(405)
    expect(res.body?.error || res.body).toBeTruthy()
  })

  it('does not bypass auth: missing bearer still denied by domain-freeze handler', async () => {
    const res = mockRes()
    await fstRouter(
      {
        method: 'POST',
        query: { path: 'g1-domain-freeze' },
        headers: { host: 'localhost', 'content-type': 'application/json' },
      },
      res,
    )
    expect(res.statusCode).toBeGreaterThanOrEqual(401)
    expect(res.statusCode).toBeLessThan(500)
  })
})

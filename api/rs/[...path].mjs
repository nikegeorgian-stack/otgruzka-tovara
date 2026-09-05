/**
 * Catch-all Vercel function for /api/rs/* — single serverless function.
 */
import credentials from '../../server/rs/credentials.mjs'
import taxpayer from '../../server/rs/taxpayer.mjs'
import verify from '../../server/rs/verify.mjs'

/** @type {Record<string, (req: any, res: any) => unknown>} */
export const RS_ROUTE_HANDLERS = {
  credentials,
  taxpayer,
  verify,
}

export function resolveRsRoutePath(queryPath) {
  if (Array.isArray(queryPath)) {
    if (queryPath.length !== 1) return null
    return String(queryPath[0] ?? '').trim()
  }
  const raw = String(queryPath ?? '').trim()
  if (!raw || raw.includes('/')) return null
  return raw
}

export default async function handler(req, res) {
  const route = resolveRsRoutePath(req.query?.path)
  if (!route) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  const routeHandler = RS_ROUTE_HANDLERS[route]
  if (!routeHandler) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  return routeHandler(req, res)
}

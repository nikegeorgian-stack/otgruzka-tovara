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
    return String(queryPath[0] ?? '').trim() || null
  }
  if (queryPath == null) return null
  const raw = String(queryPath).trim()
  if (!raw || raw.includes('/')) return null
  return raw
}

/** Resolve single-segment RS route from Vercel query and/or request URL. */
export function resolveRsRouteFromRequest(req) {
  const fromQuery = resolveRsRoutePath(req?.query?.path)
  if (fromQuery) return fromQuery
  try {
    const pathname = new URL(String(req?.url || ''), 'http://localhost').pathname
    const parts = pathname.split('/').filter(Boolean)
    if (parts[0] === 'api' && parts[1] === 'rs' && parts.length === 3) return parts[2]
    if (parts.length === 1) return parts[0]
  } catch {
    /* ignore */
  }
  return null
}

export default async function handler(req, res) {
  const route = resolveRsRouteFromRequest(req)
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

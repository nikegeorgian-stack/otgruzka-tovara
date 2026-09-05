import { evaluateBrowserOrigin } from './_apiOriginPolicy.mjs'

export async function readJsonBody(req) {
  if (req?.body && typeof req.body === 'object') return req.body
  if (typeof req?.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return {}
}

export function jsonError(res, status, error) {
  res.status(status).json({ error })
}

export function jsonOk(res, payload) {
  res.status(200).json(payload)
}

/**
 * Reject browser cross-origin calls. Does not set Access-Control-Allow-Origin.
 * @returns {boolean} true if the response was already sent (caller must return)
 */
export function rejectCrossOriginBrowser(req, res) {
  const evaluation = evaluateBrowserOrigin(req)
  if (!evaluation.blockedCrossOrigin) return false
  // Intentionally no Access-Control-Allow-Origin / OPTIONS CORS grant.
  jsonError(res, 403, 'cross_origin_api_unsupported')
  return true
}

export { evaluateBrowserOrigin }

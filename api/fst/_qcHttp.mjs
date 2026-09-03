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

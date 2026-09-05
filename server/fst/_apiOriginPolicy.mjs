/**
 * Same-origin API policy for FST command handlers.
 * No wildcard CORS; browser cross-origin calls are rejected.
 */

/**
 * @param {import('http').IncomingMessage | { headers?: Record<string, string | string[] | undefined> }} req
 * @returns {{ sameOrigin: boolean, origin: string | null, blockedCrossOrigin: boolean }}
 */
export function evaluateBrowserOrigin(req) {
  const headers = req?.headers ?? {}
  const rawOrigin = headers.origin ?? headers.Origin
  const originValue = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin
  const origin =
    typeof originValue === 'string' && originValue.trim()
      ? originValue.trim()
      : null

  // No Origin ⇒ server-to-server, same-origin navigations, or non-browser clients.
  if (!origin) {
    return { sameOrigin: true, origin: null, blockedCrossOrigin: false }
  }

  const rawHost =
    headers['x-forwarded-host'] ?? headers['X-Forwarded-Host'] ?? headers.host ?? headers.Host
  const hostHeader = Array.isArray(rawHost) ? rawHost[0] : rawHost
  const requestHost = String(hostHeader ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase()

  let originHost = ''
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return { sameOrigin: false, origin, blockedCrossOrigin: true }
  }

  const sameOrigin = Boolean(requestHost) && originHost === requestHost
  return {
    sameOrigin,
    origin,
    blockedCrossOrigin: !sameOrigin,
  }
}

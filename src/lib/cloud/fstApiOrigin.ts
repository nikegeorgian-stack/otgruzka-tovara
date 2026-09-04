/** Канон serverless `/api/fst/*` — Vercel (на Firebase Hosting API нет). */
export const FST_PRODUCTION_VERCEL_HOST = 'otgruzka-tovara.vercel.app'
export const FST_VERCEL_ORIGIN = `https://${FST_PRODUCTION_VERCEL_HOST}`

function parseOriginHostname(origin: string): string | null {
  const raw = String(origin ?? '').trim()
  if (!raw) return null
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withScheme).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Resolve the API origin prefix (no trailing slash).
 * Empty string ⇒ same-origin relative path (canon for Vercel deployments).
 *
 * Canon:
 * - Clients on `*.vercel.app` call relative `/api/fst/*` (same deployment).
 * - Firebase Hosting / other mirrors use {@link FST_VERCEL_ORIGIN}.
 * - Preview must never silently call production API via `VITE_FST_API_ORIGIN`.
 */
export function resolveFstApiOrigin(opts: {
  hostname: string
  envOrigin?: string | null
}): string {
  const host = String(opts.hostname ?? '')
    .trim()
    .toLowerCase()
  const envRaw = String(opts.envOrigin ?? '')
    .trim()
    .replace(/\/$/, '')

  const shouldIgnoreEnvForPreview = (() => {
    if (!envRaw) return false
    if (!host.endsWith('.vercel.app')) return false
    const envHost = parseOriginHostname(envRaw)
    if (!envHost) return false
    const envLooksLikeProd = envHost === FST_PRODUCTION_VERCEL_HOST
    if (!envLooksLikeProd) return false
    if (envHost === host) return false
    const isPreview =
      host.includes('---') || host !== FST_PRODUCTION_VERCEL_HOST
    return isPreview
  })()

  if (envRaw && !shouldIgnoreEnvForPreview) return envRaw

  if (
    !host ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vercel.app')
  ) {
    return ''
  }
  return FST_VERCEL_ORIGIN
}

/**
 * Абсолютный или same-origin URL для FST API.
 *
 * **Canon for Vercel deployments:** relative `/api/fst/*` (same-origin).
 * Hosting mirrors redirect to {@link FST_VERCEL_ORIGIN}.
 * Preview hosts ignore a production `VITE_FST_API_ORIGIN` so Preview≠Prod API.
 */
export function fstApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env?.VITE_FST_API_ORIGIN === 'string'
      ? import.meta.env.VITE_FST_API_ORIGIN.trim().replace(/\/$/, '')
      : ''

  const hostname =
    typeof window !== 'undefined' && window.location?.hostname
      ? window.location.hostname
      : ''

  const origin = resolveFstApiOrigin({ hostname, envOrigin: fromEnv })
  return origin ? `${origin}${p}` : p
}

export function isFstApiJsonOk(body: unknown): body is { ok: true } {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { ok?: unknown }).ok === true
  )
}

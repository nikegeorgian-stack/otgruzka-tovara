/** Канон serverless `/api/fst/*` — Vercel (на Firebase Hosting API нет). */
export const FST_VERCEL_ORIGIN = 'https://otgruzka-tovara.vercel.app'

/**
 * Абсолютный URL для FST API.
 * С Hosting / зеркал ходим на Vercel; с vercel.app и localhost — same-origin.
 */
export function fstApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env?.VITE_FST_API_ORIGIN === 'string'
      ? import.meta.env.VITE_FST_API_ORIGIN.trim().replace(/\/$/, '')
      : ''
  if (fromEnv) return `${fromEnv}${p}`

  if (typeof window === 'undefined') return p
  const host = window.location.hostname
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vercel.app')
  ) {
    return p
  }
  return `${FST_VERCEL_ORIGIN}${p}`
}

export function isFstApiJsonOk(body: unknown): body is { ok: true } {
  return (
    typeof body === 'object' &&
    body !== null &&
    (body as { ok?: unknown }).ok === true
  )
}

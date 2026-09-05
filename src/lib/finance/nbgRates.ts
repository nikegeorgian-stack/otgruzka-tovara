/**
 * Курсы НБГ (nbg.gov.ge) через наш proxy `/api/nbg/rates`.
 * 1 единица валюты → GEL.
 */

export type NbgRatesResult = {
  ok: true
  date: string
  rates: Record<string, number>
  source: string
} | {
  ok: false
  error: string
}

const cache = new Map<string, { at: number; result: NbgRatesResult }>()
const CACHE_MS = 30 * 60 * 1000

function apiBase(): string {
  if (typeof window === 'undefined') return '/api'
  return '/api'
}

export async function fetchNbgRates(date: string): Promise<NbgRatesResult> {
  const key = date.slice(0, 10)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result

  try {
    const res = await fetch(
      `${apiBase()}/nbg/rates?date=${encodeURIComponent(key)}&lang=en`,
      { headers: { Accept: 'application/json' } },
    )
    const data = (await res.json()) as {
      ok?: boolean
      date?: string
      rates?: Record<string, number>
      source?: string
      error?: string
    }
    if (!res.ok || !data.ok || !data.rates) {
      const fail: NbgRatesResult = { ok: false, error: data.error || 'nbg_failed' }
      return fail
    }
    const result: NbgRatesResult = {
      ok: true,
      date: (data.date ?? key).slice(0, 10),
      rates: data.rates,
      source: data.source || 'nbg.gov.ge',
    }
    cache.set(key, { at: Date.now(), result })
    return result
  } catch {
    return { ok: false, error: 'nbg_network' }
  }
}

/** GEL за 1 единицу валюты. GEL → 1. */
export function rateToGel(
  currency: string | undefined,
  rates: Record<string, number>,
): number {
  const code = (currency ?? 'GEL').toUpperCase()
  if (code === 'GEL') return 1
  const r = rates[code]
  return Number.isFinite(r) && r! > 0 ? r! : NaN
}

import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/cloud/firebase'
import { LOCAL_DB_API, USE_LOCAL_DB } from '@/lib/localDb/config'

export type RsCredentialsStatus = {
  configured: boolean
  source?: 'env' | 'file' | 'firestore' | null
  usernameMasked?: string | null
  lockedByEnv?: boolean
}

export type RsTaxpayerInfo = {
  tpCode: string
  name: string
  status: string
  legalForm: string
  address: string
  type: string
  vatStatus: string
}

export type RsTaxpayerResult =
  | { ok: true; data: RsTaxpayerInfo }
  | { ok: false; error: string; detail?: string }

async function bearerToken(): Promise<string | null> {
  if (!isFirebaseConfigured()) return null
  try {
    const user = getFirebaseAuth().currentUser
    if (!user) return null
    return await user.getIdToken()
  } catch {
    return null
  }
}

async function rsFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; detail?: string; status: number }
> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }

  const token = await bearerToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const key = import.meta.env.VITE_LOCAL_DB_API_KEY
  if (key) headers['X-Tabel-Api-Key'] = String(key)

  const urls = USE_LOCAL_DB
    ? [`${LOCAL_DB_API}${path}`, `/api${path}`]
    : [`/api${path}`, `${LOCAL_DB_API}${path}`]

  let lastError = 'network'
  let lastDetail: string | undefined
  let lastStatus = 0
  for (const url of urls) {
    try {
      const res = await fetch(url, { ...init, headers })
      const body = (await res.json().catch(() => ({}))) as T & {
        error?: string
        detail?: string
        ok?: boolean
      }
      if (res.ok) return { ok: true, data: body, status: res.status }
      lastError = body.error || `http_${res.status}`
      lastDetail = typeof body.detail === 'string' ? body.detail : undefined
      lastStatus = res.status
      if (res.status === 401 || res.status === 403) break
    } catch {
      lastError = 'network'
      lastDetail = undefined
    }
  }
  return { ok: false, error: lastError, detail: lastDetail, status: lastStatus }
}

export async function fetchRsCredentialsStatus(): Promise<
  { ok: true; status: RsCredentialsStatus } | { ok: false; error: string }
> {
  const res = await rsFetch<RsCredentialsStatus>('/rs/credentials', { method: 'GET' })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, status: res.data }
}

export async function saveRsCredentials(input: {
  username: string
  password: string
}): Promise<{ ok: true; status: RsCredentialsStatus } | { ok: false; error: string }> {
  const res = await rsFetch<RsCredentialsStatus & { ok?: boolean }>('/rs/credentials', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!res.ok) return { ok: false, error: res.error }
  return {
    ok: true,
    status: {
      configured: true,
      source: res.data.source ?? null,
      usernameMasked: res.data.usernameMasked ?? null,
      lockedByEnv: res.data.lockedByEnv ?? false,
    },
  }
}

export async function clearRsCredentials(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const res = await rsFetch<{ ok?: boolean }>('/rs/credentials', { method: 'DELETE' })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true }
}

export type RsVerifyResult =
  | { ok: true; authOk: true; probeError?: string; detail?: string }
  | { ok: false; authOk: false; error: string; detail?: string }

/** Проверить сохранённый логин/пароль у RS (без TIN сотрудника). */
export async function verifyRsCredentials(): Promise<RsVerifyResult> {
  const res = await rsFetch<RsVerifyResult>('/rs/verify', { method: 'POST', body: '{}' })
  if (!res.ok) {
    return { ok: false, authOk: false, error: res.error, detail: res.detail }
  }
  return res.data
}

export async function lookupRsTaxpayer(personalId: string): Promise<RsTaxpayerResult> {
  const res = await rsFetch<RsTaxpayerResult>('/rs/taxpayer', {
    method: 'POST',
    body: JSON.stringify({ personalId: personalId.trim() }),
  })
  if (!res.ok) return { ok: false, error: res.error, detail: res.detail }
  // API всегда отдаёт { ok: true, data } | { ok: false, error, detail? }
  return res.data
}

/** Сравнение ФИО сотрудника с именем из RS (без учёта регистра/лишних пробелов). */
export function compareEmployeeToRsName(
  employeeNames: Array<string | undefined | null>,
  rsName: string,
): 'match' | 'mismatch' | 'unknown' {
  const rs = normalizeName(rsName)
  if (!rs) return 'unknown'
  const candidates = employeeNames.map(normalizeName).filter(Boolean)
  if (candidates.length === 0) return 'unknown'
  for (const c of candidates) {
    if (c === rs || c.includes(rs) || rs.includes(c)) return 'match'
    if (tokensOverlap(c, rs)) return 'match'
  }
  return 'mismatch'
}

function normalizeName(value: string | undefined | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[.,«»"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokensOverlap(a: string, b: string): boolean {
  const ta = a.split(' ').filter((t) => t.length >= 2)
  const tb = new Set(b.split(' ').filter((t) => t.length >= 2))
  if (ta.length === 0 || tb.size === 0) return false
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit += 1
  return hit >= Math.min(2, ta.length)
}

import { getFirebaseAuth } from './firebase'

export type FirebaseWebUserRecord = {
  email: string
  displayName: string
  disabled: boolean
  uid: string
}

type ApiError =
  | 'unauthorized'
  | 'email_exists'
  | 'user_not_found'
  | 'create_failed'
  | 'update_failed'
  | 'list_failed'
  | 'network'

async function adminToken(): Promise<string | null> {
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken()
  } catch {
    return null
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const token = await adminToken()
  if (!token) return { ok: false, error: 'unauthorized' }
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.ok) return { ok: true, data: body as T }
    const err = body.error as ApiError | undefined
    if (err === 'email_exists' || err === 'user_not_found') return { ok: false, error: err }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' }
    if (path.includes('list-users')) return { ok: false, error: 'list_failed' }
    if (path.includes('update-user')) return { ok: false, error: 'update_failed' }
    return { ok: false, error: 'create_failed' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function listFirebaseWebUsers(): Promise<
  { ok: true; users: FirebaseWebUserRecord[] } | { ok: false; error: ApiError }
> {
  const res = await apiFetch<{ users: FirebaseWebUserRecord[] }>('/api/fst/list-users')
  if (!res.ok) return res
  return { ok: true, users: res.data.users ?? [] }
}

export async function createFirebaseWebUser(input: {
  email: string
  password: string
  displayName: string
}): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await apiFetch<{ ok: true }>('/api/fst/create-user', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      displayName: input.displayName.trim() || input.email,
    }),
  })
  if (!res.ok) return res
  return { ok: true }
}

export async function updateFirebaseWebUser(input: {
  email: string
  password?: string
  disabled?: boolean
  displayName?: string
}): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await apiFetch<{ ok: true }>('/api/fst/update-user', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      disabled: input.disabled,
      displayName: input.displayName,
    }),
  })
  if (!res.ok) return res
  return { ok: true }
}

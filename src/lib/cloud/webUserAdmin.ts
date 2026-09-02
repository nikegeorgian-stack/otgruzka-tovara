import { getFirebaseAuth } from './firebase'
import { fstApiUrl, isFstApiJsonOk } from './fstApiOrigin'

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
  | 'password_too_short'
  | 'create_failed'
  | 'update_failed'
  | 'delete_failed'
  | 'cannot_delete_self'
  | 'list_failed'
  | 'network'
  | 'clear_failed'

async function adminToken(forceRefresh = false): Promise<string | null> {
  const user = getFirebaseAuth().currentUser
  if (!user) return null
  try {
    return await user.getIdToken(forceRefresh)
  } catch {
    return null
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  options?: { forceTokenRefresh?: boolean },
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const token = await adminToken(options?.forceTokenRefresh === true)
  if (!token) return { ok: false, error: 'unauthorized' }
  const url = fstApiUrl(path)
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) {
      // Hosting SPA отдаёт HTML 200 на /api/* — это не успех.
      return { ok: false, error: 'network' }
    }
    const body = (await res.json().catch(() => null)) as {
      error?: string
      ok?: unknown
      users?: unknown
    } | null
    if (!body) return { ok: false, error: 'network' }

    if (res.ok) {
      // list-users: { users: [...] }; мутации: { ok: true }
      if (path.includes('list-users')) {
        if (!Array.isArray(body.users)) return { ok: false, error: 'list_failed' }
        return { ok: true, data: body as T }
      }
      if (!isFstApiJsonOk(body)) {
        return {
          ok: false,
          error: path.includes('clear-must-change') ? 'clear_failed' : 'network',
        }
      }
      return { ok: true, data: body as T }
    }

    const err = body.error as ApiError | undefined
    if (
      err === 'email_exists' ||
      err === 'user_not_found' ||
      err === 'cannot_delete_self' ||
      err === 'password_too_short'
    ) {
      return { ok: false, error: err }
    }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' }
    if (path.includes('list-users')) return { ok: false, error: 'list_failed' }
    if (path.includes('update-user')) return { ok: false, error: 'update_failed' }
    if (path.includes('delete-user')) return { ok: false, error: 'delete_failed' }
    if (path.includes('clear-must-change')) return { ok: false, error: 'clear_failed' }
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
  mustChangePassword?: boolean
  roleId?: string
}): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await apiFetch<{ ok: true }>('/api/fst/update-user', {
    method: 'POST',
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      password: input.password,
      disabled: input.disabled,
      displayName: input.displayName,
      mustChangePassword: input.mustChangePassword,
      roleId: input.roleId,
    }),
  })
  if (!res.ok) return res
  return { ok: true }
}

export async function clearMustChangePasswordClaim(): Promise<
  { ok: true } | { ok: false; error: ApiError }
> {
  let last: { ok: false; error: ApiError } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await apiFetch<{ ok: true }>(
      '/api/fst/clear-must-change-password',
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
      { forceTokenRefresh: true },
    )
    if (res.ok) return { ok: true }
    last = res
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
  }
  return last ?? { ok: false, error: 'clear_failed' }
}

export async function deleteFirebaseWebUser(
  email: string,
): Promise<{ ok: true } | { ok: false; error: ApiError }> {
  const res = await apiFetch<{ ok: true }>('/api/fst/delete-user', {
    method: 'POST',
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  })
  if (!res.ok) return res
  return { ok: true }
}

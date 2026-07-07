import { doc, getDoc, setDoc } from 'firebase/firestore'
import { FST_ADMIN_EMAILS } from './fstAdmin'
import { FST_WEB_ALLOWED_EMAILS } from './fstWebAllowedEmails'
import { getFirestoreDb, isFirebaseConfigured } from './firebase'
import type { AccessStore } from '@/lib/access/types'

export const FST_ACCESS_CONFIG_PATH = 'fstConfig/access'

export type WebAccessConfigDoc = {
  /** E-mail (логин) пользователей, которым разрешён вход и Firestore */
  allowedLogins: string[]
  updatedAt: string
}

/** Список логинов из store.access + админы (для Firestore rules и входа). */
export function collectWebAllowedLogins(access: AccessStore): string[] {
  const set = new Set<string>()
  for (const admin of FST_ADMIN_EMAILS) set.add(admin.toLowerCase())
  for (const legacy of FST_WEB_ALLOWED_EMAILS) set.add(legacy.toLowerCase())
  for (const u of access.users) {
    if (u.active && u.login.trim()) set.add(u.login.trim().toLowerCase())
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}

export async function fetchWebAccessAllowlist(): Promise<string[]> {
  if (!isFirebaseConfigured()) return [...FST_WEB_ALLOWED_EMAILS]
  try {
    const ref = doc(getFirestoreDb(), FST_ACCESS_CONFIG_PATH)
    const snap = await getDoc(ref)
    const data = snap.data() as WebAccessConfigDoc | undefined
    if (data?.allowedLogins?.length) return data.allowedLogins.map((e) => e.toLowerCase())
  } catch (err) {
    console.warn('FST: could not load web access config', err)
  }
  return [...FST_WEB_ALLOWED_EMAILS]
}

export function isEmailInWebAllowlist(
  email: string | null | undefined,
  allowlist: string[] | null | undefined,
): boolean {
  const key = email?.trim().toLowerCase()
  if (!key) return false
  if (allowlist?.includes(key)) return true
  return FST_WEB_ALLOWED_EMAILS.includes(key as (typeof FST_WEB_ALLOWED_EMAILS)[number])
}

/** Записать allowlist в Firestore (после изменения учёток админом). */
export async function syncWebAccessAllowlistFromStore(access: AccessStore): Promise<void> {
  if (!isFirebaseConfigured()) return
  if (import.meta.env.VITE_FST_WEB !== 'true') return
  const allowedLogins = collectWebAllowedLogins(access)
  const ref = doc(getFirestoreDb(), FST_ACCESS_CONFIG_PATH)
  await setDoc(ref, {
    allowedLogins,
    updatedAt: new Date().toISOString(),
  } satisfies WebAccessConfigDoc)
}

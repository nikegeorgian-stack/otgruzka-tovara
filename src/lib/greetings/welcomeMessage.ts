import type { AppUser } from '@/lib/access/types'
import { linkedEmployee } from '@/lib/access/userEmployee'
import type { Employee } from '@/lib/types'

export const WELCOME_MESSAGE_COUNT = 12
export const WELCOME_SESSION_KEY = 'fibercell-welcome-shown'

/** Имя для обращения: из привязанной карточки сотрудника или displayName. */
export function greetingFirstName(user: AppUser, employees: Employee[]): string {
  const linked = linkedEmployee(user, employees)
  const raw = linked?.fullName?.trim() || user.displayName?.trim() || user.login.split('@')[0] || ''
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    // Фамилия Имя [Отчество] → обращаемся по имени
    return parts[1]!
  }
  return parts[0] ?? raw
}

export function pickWelcomeMessageIndex(userId: string): number {
  const day = new Date().toISOString().slice(0, 10)
  let h = 0
  const seed = `${userId}:${day}`
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0
  return (h % WELCOME_MESSAGE_COUNT) + 1
}

export function welcomeSessionKey(userId: string): string {
  return `${WELCOME_SESSION_KEY}:${userId}`
}

export function wasWelcomeShown(userId: string): boolean {
  try {
    return sessionStorage.getItem(welcomeSessionKey(userId)) === '1'
  } catch {
    return false
  }
}

export function markWelcomeShown(userId: string): void {
  try {
    sessionStorage.setItem(welcomeSessionKey(userId), '1')
  } catch {
    /* ignore */
  }
}

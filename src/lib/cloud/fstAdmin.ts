/** Основной администратор FST (используется sync-скриптом правил Firestore). */
export const FST_ADMIN_EMAIL = 'admin@fibercell.net'

/** Все администраторы с полным доступом (роль sysadmin) в облачной версии. */
export const FST_ADMIN_EMAILS = [
  FST_ADMIN_EMAIL,
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
] as const

/** Отображаемые имена администраторов (облако). */
export const FST_ADMIN_DISPLAY_NAMES: Record<string, string> = {
  [FST_ADMIN_EMAIL]: 'Администратор',
  'admin-dm@fibercell.net': 'Администратор',
  'levan-admin@fibercell.net': 'Горашвили Леван',
}

export function isFstAdminEmail(email: string | null | undefined): boolean {
  const key = email?.trim().toLowerCase()
  if (!key) return false
  return FST_ADMIN_EMAILS.some((e) => e.toLowerCase() === key)
}

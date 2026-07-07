import { FST_ADMIN_EMAIL } from './fstAdmin'

/** Email из WEB_USER_DIRECTORY — держите в sync с fst-web/firestore.rules */
export const FST_WEB_ALLOWED_EMAILS = [
  FST_ADMIN_EMAIL,
  'nikegeorgian@gmail.com',
  'admin-dm@fibercell.net',
  'levan-admin@fibercell.net',
  'hr-nino@fibercell.net',
  'inspektor-nata@fibercell.net',
  'finans-lizi@fibercell.net',
  'sklad-alexandra@fibercell.net',
  'manager-ved-tamara@fibercell.net',
  'technolog-lasha@fibercell.net',
  'technolog-ekaterina@fibercell.net',
  'technolog-annastasia@fibercell.net',
  'technolog-maria@fibercell.net',
  'master-karlo@fibercell.net',
  'master-valera@fibercell.net',
] as const

export function isFstWebAllowedEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false
  return FST_WEB_ALLOWED_EMAILS.includes(email.trim().toLowerCase() as (typeof FST_WEB_ALLOWED_EMAILS)[number])
}

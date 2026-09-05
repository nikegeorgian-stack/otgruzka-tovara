import { hashPassword, verifyPassword } from '@/lib/access/password'

const PIN_RE = /^\d{4,6}$/

export function isValidAttendancePin(pin: string): boolean {
  return PIN_RE.test(pin.trim())
}

export async function hashAttendancePin(pin: string): Promise<{ hash: string; salt: string }> {
  return hashPassword(pin.trim())
}

export async function verifyAttendancePin(
  pin: string,
  hash: string | undefined,
  salt: string | undefined,
): Promise<boolean> {
  if (!hash?.trim() || !salt?.trim()) return false
  if (!isValidAttendancePin(pin)) return false
  return verifyPassword(pin.trim(), hash, salt)
}

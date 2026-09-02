/** Soft-lock редактирования: сотрудник / документ. */

export type EditLockResourceType = 'employee' | 'document'

export type EditLockHolder = {
  uid: string
  name: string
  /** Стабильный id вкладки браузера */
  tabId: string
}

export type EditLockRecord = {
  resourceId: string
  resourceType: EditLockResourceType
  holder: EditLockHolder
  acquiredAt: number
  expiresAt: number
}

/** TTL без heartbeat — замок считается протухшим. */
export const EDIT_LOCK_TTL_MS = 90_000
/** Как часто продлеваем. */
export const EDIT_LOCK_HEARTBEAT_MS = 25_000

export function employeeLockId(employeeId: string): string {
  return `employee:${employeeId}`
}

export function isLockExpired(lock: EditLockRecord, now = Date.now()): boolean {
  return lock.expiresAt <= now
}

export function isOwnLock(lock: EditLockRecord, holder: EditLockHolder): boolean {
  return lock.holder.uid === holder.uid && lock.holder.tabId === holder.tabId
}

export function fingerprintEmployee(emp: unknown): string {
  try {
    const json = JSON.stringify(emp)
    let h = 5381
    for (let i = 0; i < json.length; i++) h = (h * 33) ^ json.charCodeAt(i)
    return `${json.length}:${h >>> 0}`
  } catch {
    return '0:0'
  }
}

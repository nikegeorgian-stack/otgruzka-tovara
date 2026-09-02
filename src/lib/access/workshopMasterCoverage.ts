import { resolveWorkshopMasterBrigades } from '@/lib/workshopMasterScope'
import type { AppStore } from '@/lib/types'
import type {
  AccessStore,
  AppUser,
  WorkshopMasterCoverage,
  WorkshopMasterCoverageStatus,
} from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = new Set<WorkshopMasterCoverageStatus>(['draft', 'posted', 'ended'])

/** Сегодняшняя дата YYYY-MM-DD в локальной зоне устройства. */
export function localTodayIsoDate(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function isValidCoverageDate(iso: string | undefined | null): boolean {
  return typeof iso === 'string' && DATE_RE.test(iso)
}

export function monthDateBounds(monthKey: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return null
  const [ys, ms] = monthKey.split('-')
  const y = Number(ys)
  const m = Number(ms)
  if (!y || m < 1 || m > 12) return null
  const last = new Date(y, m, 0).getDate()
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(last).padStart(2, '0')}`,
  }
}

/** Следующий номер ПМ-YYYY-NNN. */
export function nextWorkshopMasterCoverageNumber(
  list: WorkshopMasterCoverage[],
  now = new Date(),
): string {
  const year = now.getFullYear()
  const prefix = `ПМ-${year}-`
  let max = 0
  for (const c of list) {
    const num = c.number?.trim() ?? ''
    if (!num.startsWith(prefix)) continue
    const n = parseInt(num.slice(prefix.length), 10)
    if (!Number.isNaN(n)) max = Math.max(max, n)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

/**
 * Действует «сегодня» для ACL: только проведённый документ в датах from–to.
 * Черновик и снятый — нет.
 */
export function isCoverageActiveOn(
  c: WorkshopMasterCoverage,
  dayIso: string,
): boolean {
  if (c.status !== 'posted') return false
  if (c.endedAt) return false
  if (!isValidCoverageDate(c.fromDate) || !isValidCoverageDate(c.toDate)) return false
  if (!isValidCoverageDate(dayIso)) return false
  return dayIso >= c.fromDate && dayIso <= c.toDate
}

/** Проведённый документ пересекается с календарным месяцем YYYY-MM. */
export function coverageOverlapsMonth(
  c: WorkshopMasterCoverage,
  monthKey: string,
): boolean {
  if (c.status !== 'posted') return false
  if (c.endedAt) return false
  const bounds = monthDateBounds(monthKey)
  if (!bounds) return false
  if (!isValidCoverageDate(c.fromDate) || !isValidCoverageDate(c.toDate)) return false
  return c.fromDate <= bounds.end && c.toDate >= bounds.start
}

function resolveStatus(raw: Record<string, unknown>): WorkshopMasterCoverageStatus {
  const s = typeof raw.status === 'string' ? raw.status.trim() : ''
  if (STATUSES.has(s as WorkshopMasterCoverageStatus)) {
    return s as WorkshopMasterCoverageStatus
  }
  // legacy: endedAt → ended, иначе считаем проведённым (уже выдавали доступ)
  if (typeof raw.endedAt === 'string' && raw.endedAt) return 'ended'
  return 'posted'
}

export function normalizeWorkshopMasterCoverage(
  raw: unknown,
  opts?: { fallbackNumber?: string },
): WorkshopMasterCoverage | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const coverUserId =
    typeof o.coverUserId === 'string' && o.coverUserId.trim()
      ? o.coverUserId.trim()
      : null
  const absentUserId =
    typeof o.absentUserId === 'string' && o.absentUserId.trim()
      ? o.absentUserId.trim()
      : null
  const fromDate = typeof o.fromDate === 'string' ? o.fromDate.trim() : ''
  const toDate = typeof o.toDate === 'string' ? o.toDate.trim() : ''
  if (!id || !coverUserId || !absentUserId) return null
  if (!isValidCoverageDate(fromDate) || !isValidCoverageDate(toDate)) return null
  if (fromDate > toDate) return null
  const brigades = Array.isArray(o.brigades)
    ? o.brigades.filter((b): b is string => typeof b === 'string' && b.trim() !== '')
    : []
  if (brigades.length === 0) return null
  const status = resolveStatus(o)
  const number =
    typeof o.number === 'string' && o.number.trim()
      ? o.number.trim()
      : opts?.fallbackNumber ?? `ПМ-${id.slice(0, 8).toUpperCase()}`
  return {
    id,
    number,
    status,
    coverUserId,
    absentUserId,
    brigades,
    fromDate,
    toDate,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
    createdBy: typeof o.createdBy === 'string' ? o.createdBy : undefined,
    createdByName: typeof o.createdByName === 'string' ? o.createdByName : undefined,
    createdAt:
      typeof o.createdAt === 'string' && o.createdAt
        ? o.createdAt
        : new Date().toISOString(),
    postedAt: typeof o.postedAt === 'string' && o.postedAt ? o.postedAt : undefined,
    postedBy: typeof o.postedBy === 'string' ? o.postedBy : undefined,
    postedByName: typeof o.postedByName === 'string' ? o.postedByName : undefined,
    endedAt: typeof o.endedAt === 'string' && o.endedAt ? o.endedAt : undefined,
  }
}

export function normalizeWorkshopMasterCoverages(
  raw: unknown,
): WorkshopMasterCoverage[] {
  if (!Array.isArray(raw)) return []
  const out: WorkshopMasterCoverage[] = []
  for (const item of raw) {
    const n = normalizeWorkshopMasterCoverage(item, {
      fallbackNumber: '__pending__',
    })
    if (n) out.push(n)
  }
  const assigned: WorkshopMasterCoverage[] = []
  for (const c of out) {
    if (!c.number || c.number === '__pending__') {
      c.number = nextWorkshopMasterCoverageNumber(assigned)
    }
    assigned.push(c)
  }
  return assigned
}

/** Активные покрытия для замещающего на дату (только posted). */
export function activeCoveragesForUser(
  access: AccessStore | undefined,
  coverUserId: string | undefined | null,
  dayIso: string = localTodayIsoDate(),
): WorkshopMasterCoverage[] {
  if (!coverUserId || !access?.workshopMasterCoverages?.length) return []
  return access.workshopMasterCoverages.filter(
    (c) => c.coverUserId === coverUserId && isCoverageActiveOn(c, dayIso),
  )
}

/** Проведённые покрытия, пересекающие месяц (для табеля открытого месяца). */
export function coveragesOverlappingMonthForUser(
  access: AccessStore | undefined,
  coverUserId: string | undefined | null,
  monthKey: string,
): WorkshopMasterCoverage[] {
  if (!coverUserId || !access?.workshopMasterCoverages?.length) return []
  return access.workshopMasterCoverages.filter(
    (c) => c.coverUserId === coverUserId && coverageOverlapsMonth(c, monthKey),
  )
}

/** Бригады из активных подмен на дату (снимок в записи). */
export function activeCoverageBrigades(
  access: AccessStore | undefined,
  coverUserId: string | undefined | null,
  knownBrigades: string[],
  dayIso: string = localTodayIsoDate(),
): string[] {
  const known = new Set(knownBrigades)
  const set = new Set<string>()
  for (const c of activeCoveragesForUser(access, coverUserId, dayIso)) {
    for (const b of c.brigades) {
      if (known.has(b)) set.add(b)
    }
  }
  return [...set]
}

/** Бригады из подмен, пересекающих месяц. */
export function monthCoverageBrigades(
  access: AccessStore | undefined,
  coverUserId: string | undefined | null,
  knownBrigades: string[],
  monthKey: string,
): string[] {
  const known = new Set(knownBrigades)
  const set = new Set<string>()
  for (const c of coveragesOverlappingMonthForUser(access, coverUserId, monthKey)) {
    for (const b of c.brigades) {
      if (known.has(b)) set.add(b)
    }
  }
  return [...set]
}

export function mergeBrigadeLists(...lists: (string[] | undefined)[]): string[] {
  const set = new Set<string>()
  for (const list of lists) {
    for (const b of list ?? []) {
      if (b.trim()) set.add(b)
    }
  }
  return [...set]
}

/**
 * Бригада доступна только через подмену (не из базовой области мастера).
 * Для хвоста «· подмена» в audit detail.
 */
export function isBrigadeViaMasterCoverage(
  store: AppStore,
  user: AppUser | null | undefined,
  brigade: string | undefined | null,
  dayIso: string = localTodayIsoDate(),
): boolean {
  if (!user || !brigade) return false
  if (user.roleId !== 'workshop_master') return false
  const coverage = new Set(
    activeCoverageBrigades(store.access, user.id, store.brigades, dayIso),
  )
  if (!coverage.has(brigade)) return false
  const base = resolveWorkshopMasterBrigades(
    store,
    user.login,
    user.employeeId,
    user.defaultBrigades,
    { fallbackToAll: false },
  )
  return !base.includes(brigade)
}

/** Бригада через подмену с учётом открытого месяца (аудит / ячейка). */
export function isBrigadeViaMasterCoverageInMonth(
  store: AppStore,
  user: AppUser | null | undefined,
  brigade: string | undefined | null,
  monthKey: string,
  dayIso: string = localTodayIsoDate(),
): boolean {
  if (!user || !brigade) return false
  if (user.roleId !== 'workshop_master') return false
  const viaDay = new Set(
    activeCoverageBrigades(store.access, user.id, store.brigades, dayIso),
  )
  const viaMonth = new Set(
    monthCoverageBrigades(store.access, user.id, store.brigades, monthKey),
  )
  if (!viaDay.has(brigade) && !viaMonth.has(brigade)) return false
  const base = resolveWorkshopMasterBrigades(
    store,
    user.login,
    user.employeeId,
    user.defaultBrigades,
    { fallbackToAll: false },
  )
  return !base.includes(brigade)
}

/** Бригады отсутствующего мастера для автозаполнения формы. */
export function resolveAbsentMasterBrigades(
  store: AppStore,
  absentUser: AppUser,
): string[] {
  return resolveWorkshopMasterBrigades(
    store,
    absentUser.login,
    absentUser.employeeId,
    absentUser.defaultBrigades,
    { fallbackToAll: false },
  )
}

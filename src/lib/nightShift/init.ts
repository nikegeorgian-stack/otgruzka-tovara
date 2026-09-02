import type {
  NightShiftAppliedMark,
  NightShiftDocument,
  NightShiftGroupId,
  NightShiftStatus,
  NightShiftStore,
} from './types'
import { NIGHT_SHIFT_GROUP_IDS } from './types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const STATUSES = new Set<NightShiftStatus>(['draft', 'posted', 'void'])
const GROUPS = new Set<string>(NIGHT_SHIFT_GROUP_IDS)

export function createDefaultNightShiftStore(): NightShiftStore {
  return { documents: [] }
}

export function nextNightShiftNumber(
  list: NightShiftDocument[],
  now = new Date(),
): string {
  const year = now.getFullYear()
  const prefix = `НС-${year}-`
  let max = 0
  for (const d of list) {
    const num = d.number?.trim() ?? ''
    if (!num.startsWith(prefix)) continue
    const n = parseInt(num.slice(prefix.length), 10)
    if (!Number.isNaN(n)) max = Math.max(max, n)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

function normalizeApplied(raw: unknown): NightShiftAppliedMark[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: NightShiftAppliedMark[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const employeeId = typeof o.employeeId === 'string' ? o.employeeId.trim() : ''
    const rowId = typeof o.rowId === 'string' ? o.rowId.trim() : ''
    if (!employeeId || !rowId) continue
    out.push({
      employeeId,
      rowId,
      prevFact: typeof o.prevFact === 'string' ? o.prevFact : '',
    })
  }
  return out.length ? out : undefined
}

const REASON_MAX = 240

/** Причины только для людей из состава документа. */
export function normalizeReasons(
  raw: unknown,
  employeeIds: string[],
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const allow = new Set(employeeIds)
  if (allow.size === 0) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = key.trim()
    if (!id || !allow.has(id) || typeof value !== 'string') continue
    const text = value.trim().slice(0, REASON_MAX)
    if (!text) continue
    out[id] = text
  }
  return Object.keys(out).length ? out : undefined
}

export function normalizeNightShiftDocument(raw: unknown): NightShiftDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
  const date = typeof o.date === 'string' && DATE_RE.test(o.date) ? o.date : null
  if (!id || !date) return null

  const statusRaw = typeof o.status === 'string' ? o.status.trim() : ''
  const status: NightShiftStatus = STATUSES.has(statusRaw as NightShiftStatus)
    ? (statusRaw as NightShiftStatus)
    : 'draft'

  const groups = Array.isArray(o.groups)
    ? (o.groups.filter(
        (g): g is NightShiftGroupId => typeof g === 'string' && GROUPS.has(g),
      ) as NightShiftGroupId[])
    : []

  const brigades = Array.isArray(o.brigades)
    ? o.brigades
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined

  const employeeIds = Array.isArray(o.employeeIds)
    ? o.employeeIds
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean)
    : []

  const now = new Date().toISOString()
  return {
    id,
    number:
      typeof o.number === 'string' && o.number.trim()
        ? o.number.trim()
        : `НС-${date.slice(0, 4)}-000`,
    date,
    status,
    groups,
    brigades: brigades?.length ? brigades : undefined,
    employeeIds,
    note: typeof o.note === 'string' && o.note.trim() ? o.note.trim() : undefined,
    reasons: normalizeReasons(o.reasons, employeeIds),
    applied: normalizeApplied(o.applied),
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now,
    createdBy: typeof o.createdBy === 'string' ? o.createdBy : undefined,
    createdByName: typeof o.createdByName === 'string' ? o.createdByName : undefined,
    postedAt: typeof o.postedAt === 'string' ? o.postedAt : undefined,
    postedBy: typeof o.postedBy === 'string' ? o.postedBy : undefined,
    postedByName: typeof o.postedByName === 'string' ? o.postedByName : undefined,
    voidedAt: typeof o.voidedAt === 'string' ? o.voidedAt : undefined,
    voidedBy: typeof o.voidedBy === 'string' ? o.voidedBy : undefined,
    voidedByName: typeof o.voidedByName === 'string' ? o.voidedByName : undefined,
  }
}

export function normalizeNightShiftStore(raw: unknown): NightShiftStore {
  if (!raw || typeof raw !== 'object') return createDefaultNightShiftStore()
  const o = raw as Record<string, unknown>
  const documents = Array.isArray(o.documents)
    ? o.documents
        .map(normalizeNightShiftDocument)
        .filter((d): d is NightShiftDocument => d != null)
    : []
  return { documents }
}

/** Документ ночной смены на конкретный день (предпочтительно проведённый). */
export function nightShiftOnDate(
  store: NightShiftStore | undefined,
  date: string,
): NightShiftDocument | undefined {
  const list = store?.documents ?? []
  const posted = list.find((d) => d.date === date && d.status === 'posted')
  if (posted) return posted
  return list.find((d) => d.date === date && d.status === 'draft')
}

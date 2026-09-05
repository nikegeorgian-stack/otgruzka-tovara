import {
  ENGINEER_LOG_KINDS,
  ENGINEER_LOG_SCHEMA_VERSION,
  type EngineerLogChecklistItem,
  type EngineerLogEntry,
  type EngineerLogEntryKind,
  type EngineerLogSeverity,
  type EngineerLogStatus,
  type EngineerLogStore,
} from './types'

const KINDS = new Set<string>(ENGINEER_LOG_KINDS)
const SEVERITIES = new Set<string>(['info', 'watch', 'critical'])
const STATUSES = new Set<string>(['open', 'done', 'deferred'])

export function createDefaultEngineerLog(): EngineerLogStore {
  return { entries: [] }
}

function normalizeChecklist(raw: unknown): EngineerLogChecklistItem[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const items = raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const o = row as Record<string, unknown>
      const text = typeof o.text === 'string' ? o.text.trim() : ''
      if (!text) return null
      return {
        id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
        text,
        done: o.done === true,
      }
    })
    .filter((x): x is EngineerLogChecklistItem => x != null)
  return items.length ? items : undefined
}

export function normalizeEngineerLogEntry(raw: unknown): EngineerLogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = typeof o.kind === 'string' && KINDS.has(o.kind) ? (o.kind as EngineerLogEntryKind) : 'note'
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : ''
  if (!date) return null
  const now = new Date().toISOString()
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  const body = typeof o.body === 'string' ? o.body : ''
  const tags = Array.isArray(o.tags)
    ? o.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
    : []
  const severity =
    typeof o.severity === 'string' && SEVERITIES.has(o.severity)
      ? (o.severity as EngineerLogSeverity)
      : undefined
  const status =
    typeof o.status === 'string' && STATUSES.has(o.status) ? (o.status as EngineerLogStatus) : undefined

  return {
    id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
    kind,
    date,
    createdAt: typeof o.createdAt === 'string' && o.createdAt ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' && o.updatedAt ? o.updatedAt : now,
    authorId: typeof o.authorId === 'string' ? o.authorId : undefined,
    authorName: typeof o.authorName === 'string' ? o.authorName : undefined,
    title: title || kind,
    body,
    tags,
    severity,
    status,
    area: typeof o.area === 'string' && o.area.trim() ? o.area.trim() : undefined,
    equipment: typeof o.equipment === 'string' && o.equipment.trim() ? o.equipment.trim() : undefined,
    checklist: normalizeChecklist(o.checklist),
    pinned: o.pinned === true,
    schemaVersion: ENGINEER_LOG_SCHEMA_VERSION,
  }
}

export function normalizeEngineerLogStore(raw: unknown): EngineerLogStore {
  if (!raw || typeof raw !== 'object') return createDefaultEngineerLog()
  const o = raw as Record<string, unknown>
  const entries = Array.isArray(o.entries)
    ? o.entries.map(normalizeEngineerLogEntry).filter((e): e is EngineerLogEntry => e != null)
    : []
  return { entries }
}

export type EngineerLogDraft = Omit<
  EngineerLogEntry,
  'id' | 'createdAt' | 'updatedAt' | 'schemaVersion'
> & { id?: string; createdAt?: string }

export function buildEngineerLogEntry(draft: EngineerLogDraft): EngineerLogEntry {
  const now = new Date().toISOString()
  return normalizeEngineerLogEntry({
    ...draft,
    id: draft.id ?? crypto.randomUUID(),
    createdAt: draft.createdAt ?? now,
    updatedAt: now,
    schemaVersion: ENGINEER_LOG_SCHEMA_VERSION,
  })!
}

/** Полевой журнал главного инженера (дневные заметки / задачи / замечания). */

export const ENGINEER_LOG_SCHEMA_VERSION = 1 as const

export type EngineerLogEntryKind =
  | 'note'
  | 'remark'
  | 'task_done'
  | 'issue'
  | 'inspection'
  | 'idea'
  | 'handoff'

export type EngineerLogSeverity = 'info' | 'watch' | 'critical'

export type EngineerLogStatus = 'open' | 'done' | 'deferred'

export type EngineerLogChecklistItem = {
  id: string
  text: string
  done: boolean
}

export type EngineerLogEntry = {
  id: string
  kind: EngineerLogEntryKind
  /** YYYY-MM-DD */
  date: string
  createdAt: string
  updatedAt: string
  authorId?: string
  authorName?: string
  title: string
  body: string
  tags: string[]
  severity?: EngineerLogSeverity
  status?: EngineerLogStatus
  /** Цех / линия / зона */
  area?: string
  equipment?: string
  checklist?: EngineerLogChecklistItem[]
  pinned?: boolean
  /** Задел под будущий ИИ-аудит / экспорт */
  schemaVersion: typeof ENGINEER_LOG_SCHEMA_VERSION
}

export type EngineerLogStore = {
  entries: EngineerLogEntry[]
}

export const ENGINEER_LOG_KINDS: EngineerLogEntryKind[] = [
  'note',
  'remark',
  'task_done',
  'issue',
  'inspection',
  'idea',
  'handoff',
]

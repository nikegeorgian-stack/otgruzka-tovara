import type { EngineerLogStore } from './types'
import { normalizeEngineerLogStore } from './init'

/** Пакет для будущего ИИ-аудита / админ-выгрузки. Не вешать на UI инженера. */
export type EngineerLogAuditPayload = {
  schemaVersion: 1
  exportedAt: string
  entryCount: number
  byKind: Record<string, number>
  openIssues: number
  pinned: number
  entries: EngineerLogStore['entries']
}

export function buildEngineerLogAuditPayload(
  store: EngineerLogStore | undefined | null,
): EngineerLogAuditPayload {
  const { entries } = normalizeEngineerLogStore(store)
  const byKind: Record<string, number> = {}
  let openIssues = 0
  let pinned = 0
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
    if (e.kind === 'issue' && e.status !== 'done') openIssues += 1
    if (e.pinned) pinned += 1
  }
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    entryCount: entries.length,
    byKind,
    openIssues,
    pinned,
    entries: [...entries].sort(
      (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    ),
  }
}

import type { AppStore } from '@/lib/types'
import { collectJournalEntries, countJournalEntriesByCategory, filterJournalEntries } from './collect'
import type { JournalCategory, JournalCategoryCounts, UnifiedJournalEntry } from './types'

export type JournalViewMode = 'timeline' | 'table' | 'documents'

export type JournalDatePreset = 'all' | 'today' | '7d' | '30d' | 'month' | 'year'

export type JournalFacets = {
  actors: string[]
  docStatuses: string[]
  docNumbers: string[]
}

export type JournalIndex = {
  entries: UnifiedJournalEntry[]
  counts: JournalCategoryCounts
  facets: JournalFacets
  byDay: Map<string, UnifiedJournalEntry[]>
  documentEntries: UnifiedJournalEntry[]
  movementEntries: UnifiedJournalEntry[]
}

function pushFacet(set: Set<string>, value?: string | null): void {
  const v = value?.trim()
  if (v) set.add(v)
}

export function buildJournalIndex(
  store: AppStore,
  categories: JournalCategory[],
  opts?: Parameters<typeof collectJournalEntries>[2],
): JournalIndex {
  const entries = collectJournalEntries(store, categories, opts)
  const counts = countJournalEntriesByCategory(entries)

  const actors = new Set<string>()
  const docStatuses = new Set<string>()
  const docNumbers = new Set<string>()
  const byDay = new Map<string, UnifiedJournalEntry[]>()

  for (const e of entries) {
    pushFacet(actors, e.actor)
    pushFacet(docStatuses, e.docStatus)
    pushFacet(docNumbers, e.docNumber)
    const day = (e.docDate ?? e.at).slice(0, 10)
    const bucket = byDay.get(day)
    if (bucket) bucket.push(e)
    else byDay.set(day, [e])
  }

  const documentEntries = entries.filter(
    (e) =>
      e.entryKind === 'document' ||
      (!e.entryKind &&
        (e.category === 'warehouse_documents' ||
          e.category === 'warehouse_loading' ||
          e.category === 'procurement' ||
          e.category === 'finance' ||
          !!e.docNumber ||
          (e.category === 'timesheet' &&
            (e.docStatus === 'month_close' ||
              e.docStatus === 'month_reopen' ||
              e.docStatus === 'bulk')))),
  )

  const movementEntries = entries.filter(
    (e) =>
      e.category === 'warehouse_movements' ||
      e.category === 'warehouse_audit' ||
      e.category === 'production',
  )

  return {
    entries,
    counts,
    facets: {
      actors: [...actors].sort((a, b) => a.localeCompare(b, 'ru')),
      docStatuses: [...docStatuses].sort((a, b) => a.localeCompare(b, 'ru')),
      docNumbers: [...docNumbers].sort((a, b) => a.localeCompare(b, 'ru')),
    },
    byDay,
    documentEntries,
    movementEntries,
  }
}

export function journalDatePresetRange(
  preset: JournalDatePreset,
  now = new Date(),
): { dateFrom?: string; dateTo?: string } {
  if (preset === 'all') return {}
  const pad = (n: number) => String(n).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

  if (preset === 'today') return { dateFrom: today, dateTo: today }

  if (preset === '7d') {
    const from = new Date(now)
    from.setDate(from.getDate() - 6)
    return {
      dateFrom: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      dateTo: today,
    }
  }

  if (preset === '30d') {
    const from = new Date(now)
    from.setDate(from.getDate() - 29)
    return {
      dateFrom: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      dateTo: today,
    }
  }

  if (preset === 'year') {
    return {
      dateFrom: `${now.getFullYear()}-01-01`,
      dateTo: today,
    }
  }

  // month
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
  return { dateFrom: from, dateTo: today }
}

export type JournalKindFilter = 'all' | 'document' | 'event' | 'linked'

export function queryJournalIndex(
  index: JournalIndex,
  opts: {
    categories?: Set<JournalCategory>
    search?: string
    dateFrom?: string
    dateTo?: string
    docStatus?: string
    actor?: string
    asOfIso?: string
    viewMode?: JournalViewMode
    kindFilter?: JournalKindFilter
    limit?: number
  },
): UnifiedJournalEntry[] {
  let base =
    opts.viewMode === 'documents'
      ? index.documentEntries
      : opts.viewMode === 'timeline'
        ? index.entries
        : index.entries

  if (opts.viewMode === 'documents' && opts.categories?.size) {
    base = base.filter((e) => opts.categories!.has(e.category))
  }

  let filtered = filterJournalEntries(base, {
    categories: opts.viewMode === 'documents' ? undefined : opts.categories,
    search: opts.search,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    docStatus: opts.docStatus,
    asOfIso: opts.asOfIso,
  })

  if (opts.actor) {
    const a = opts.actor.trim().toLowerCase()
    filtered = filtered.filter((e) => (e.actor ?? '').toLowerCase() === a)
  }

  if (opts.kindFilter === 'document') {
    filtered = filtered.filter((e) => e.entryKind === 'document' || !!e.docNumber)
  } else if (opts.kindFilter === 'event') {
    filtered = filtered.filter((e) => e.entryKind === 'event' || (!e.entryKind && !e.docNumber))
  } else if (opts.kindFilter === 'linked') {
    filtered = filtered.filter((e) => !!e.link)
  }

  const limit = opts.limit ?? 500
  return filtered.slice(0, limit)
}

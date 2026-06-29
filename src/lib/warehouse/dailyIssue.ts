import { appendWarehouseAudit } from './audit'
import { postWarehouseDocument } from './documents'
import { suggestDocNumber } from './nomenclatureSearch'
import { computeAllBalances, validateIssueLines } from './stock'
import type { DailyIssueSession, WarehouseStore } from './types'

export function keeperInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  }
  const w = parts[0] ?? 'КЛ'
  return w.slice(0, 2).toUpperCase()
}

export function suggestDailyIssueNumber(
  sessions: DailyIssueSession[],
  date: string,
  keeperId: string,
  keeperName: string,
): string {
  const day = date.replace(/-/g, '')
  const ini = keeperInitials(keeperName)
  const prefix = `ВД-${day}-${ini}`
  const today = sessions.filter((s) => s.date === date && s.keeperId === keeperId)
  const open = today.find((s) => s.status === 'open')
  if (open) return open.number
  const used = new Set(today.map((s) => s.number))
  if (!used.has(prefix)) return prefix
  for (let n = 2; n < 100; n++) {
    const num = `${prefix}-${String(n).padStart(2, '0')}`
    if (!used.has(num)) return num
  }
  return `${prefix}-${Date.now().toString(36).slice(-4)}`
}

export function findOpenDailyIssue(
  store: WarehouseStore,
  keeperId: string,
  date: string,
  warehouseId?: string,
): DailyIssueSession | undefined {
  return store.dailyIssueSessions?.find(
    (s) =>
      s.status === 'open' &&
      s.keeperId === keeperId &&
      s.date === date &&
      (!warehouseId || s.warehouseId === warehouseId),
  )
}

export function openOrResumeDailyIssue(
  store: WarehouseStore,
  args: {
    keeperId: string
    keeperName: string
    warehouseId: string
    date?: string
  },
): { store: WarehouseStore; session: DailyIssueSession } {
  const date = args.date ?? new Date().toISOString().slice(0, 10)
  const sessions = store.dailyIssueSessions ?? []
  const existing = findOpenDailyIssue(store, args.keeperId, date, args.warehouseId)
  if (existing) return { store, session: existing }

  const now = new Date().toISOString()
  const session: DailyIssueSession = {
    id: crypto.randomUUID(),
    number: suggestDailyIssueNumber(sessions, date, args.keeperId, args.keeperName),
    date,
    warehouseId: args.warehouseId,
    keeperId: args.keeperId,
    keeperName: args.keeperName,
    status: 'open',
    lines: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  }

  let next: WarehouseStore = {
    ...store,
    dailyIssueSessions: [...sessions, session],
  }
  next = appendWarehouseAudit(next, {
    action: 'daily_issue',
    detail: `Открыта ведомость ${session.number} · ${args.keeperName}`,
  })
  return { store: next, session }
}

export function adjustDailyIssueLine(
  store: WarehouseStore,
  sessionId: string,
  itemId: string,
  delta: number,
): WarehouseStore {
  if (!delta) return store
  const sessions = store.dailyIssueSessions ?? []
  const idx = sessions.findIndex((s) => s.id === sessionId && s.status === 'open')
  if (idx < 0) return store

  const session = sessions[idx]!
  const now = new Date().toISOString()
  const lineIdx = session.lines.findIndex((l) => l.itemId === itemId)
  const prevQty = lineIdx >= 0 ? session.lines[lineIdx]!.quantity : 0
  const nextQty = Math.max(0, prevQty + delta)

  let lines = [...session.lines]
  if (nextQty <= 0) {
    lines = lines.filter((l) => l.itemId !== itemId)
  } else if (lineIdx >= 0) {
    lines[lineIdx] = { itemId, quantity: nextQty, updatedAt: now }
  } else {
    lines.push({ itemId, quantity: nextQty, updatedAt: now })
  }

  const events = [
    ...session.events,
    { id: crypto.randomUUID(), at: now, itemId, delta },
  ]

  const updated: DailyIssueSession = {
    ...session,
    lines,
    events,
    updatedAt: now,
  }

  const nextSessions = [...sessions]
  nextSessions[idx] = updated
  return { ...store, dailyIssueSessions: nextSessions }
}

export function setDailyIssueComment(
  store: WarehouseStore,
  sessionId: string,
  comment: string,
): WarehouseStore {
  const sessions = store.dailyIssueSessions ?? []
  const idx = sessions.findIndex((s) => s.id === sessionId && s.status === 'open')
  if (idx < 0) return store
  const nextSessions = [...sessions]
  nextSessions[idx] = {
    ...nextSessions[idx]!,
    comment: comment.trim() || undefined,
    updatedAt: new Date().toISOString(),
  }
  return { ...store, dailyIssueSessions: nextSessions }
}

export type PostDailyIssueResult =
  | { ok: true; documentId: string; documentNumber: string }
  | { ok: false; reason: 'empty' | 'not_found' | 'already_posted' | 'stock' | 'no_items'; detail?: string }

export function postDailyIssueSession(
  store: WarehouseStore,
  sessionId: string,
  options?: { allowNegativeStock?: boolean },
): { store: WarehouseStore; result: PostDailyIssueResult } {
  const sessions = store.dailyIssueSessions ?? []
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx < 0) return { store, result: { ok: false, reason: 'not_found' } }

  const session = sessions[idx]!
  if (session.status === 'posted') return { store, result: { ok: false, reason: 'already_posted' } }

  const lines = session.lines.filter((l) => l.quantity > 0)
  if (lines.length === 0) return { store, result: { ok: false, reason: 'empty' } }

  const docLines = lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }))
  const balances = computeAllBalances(store, session.warehouseId)
  const activeItems = store.items.filter((i) => i.active)
  const validation = validateIssueLines(activeItems, balances, docLines)
  if (!validation.ok && options?.allowNegativeStock !== true) {
    return {
      store,
      result: {
        ok: false,
        reason: 'stock',
        detail: validation.shortages.map((s) => s.name).join(', '),
      },
    }
  }

  const docNumber = suggestDocNumber(store.documents, 'issue', session.date)
  const comment = [
    session.comment,
    `Ведомость выдачи ${session.number}`,
    session.keeperName,
  ]
    .filter(Boolean)
    .join(' · ')

  let next = postWarehouseDocument(store, {
    type: 'issue',
    number: docNumber,
    date: session.date,
    warehouseId: session.warehouseId,
    purpose: 'production_issue',
    comment,
    lines: docLines,
    keeperId: session.keeperId,
    keeperName: session.keeperName,
    skipValidation: true,
  }).store

  const doc = next.documents[next.documents.length - 1]!
  const nextSessions = [...(next.dailyIssueSessions ?? sessions)]
  nextSessions[idx] = {
    ...session,
    status: 'posted',
    postedDocumentId: doc.id,
    updatedAt: new Date().toISOString(),
  }
  next = {
    ...next,
    dailyIssueSessions: nextSessions,
  }
  next = appendWarehouseAudit(next, {
    action: 'daily_issue',
    detail: `Проведена ${session.number} → расход №${docNumber} · ${lines.length} поз.`,
  })

  return {
    store: next,
    result: { ok: true, documentId: doc.id, documentNumber: docNumber },
  }
}

export function sessionTotalQty(session: DailyIssueSession): number {
  return session.lines.reduce((s, l) => s + l.quantity, 0)
}

export function sessionLineCount(session: DailyIssueSession): number {
  return session.lines.filter((l) => l.quantity > 0).length
}

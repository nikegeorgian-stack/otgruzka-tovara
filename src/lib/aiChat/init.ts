import type { AiChatEntry, AiChatRole, AiChatStore, SuggestionEntry } from './types'

/** Жёсткий предел, чтобы лог не разрастался бесконечно в общем сторе. */
const MAX_ENTRIES = 5000
const MAX_SUGGESTIONS = 2000

export function createDefaultAiChat(): AiChatStore {
  return { entries: [], suggestions: [] }
}

function normalizeRole(raw: unknown): AiChatRole {
  return raw === 'assistant' ? 'assistant' : 'user'
}

function normalizeEntry(raw: unknown): AiChatEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const content = typeof r.content === 'string' ? r.content : ''
  if (!content.trim()) return null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    sessionId: typeof r.sessionId === 'string' && r.sessionId ? r.sessionId : 'legacy',
    ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : Date.now(),
    userId: typeof r.userId === 'string' ? r.userId : null,
    userName: typeof r.userName === 'string' ? r.userName : '—',
    roleId: typeof r.roleId === 'string' ? r.roleId : '',
    view: typeof r.view === 'string' ? r.view : '',
    role: normalizeRole(r.role),
    content,
    topic: typeof r.topic === 'string' ? r.topic : undefined,
  }
}

function normalizeSuggestion(raw: unknown): SuggestionEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text : ''
  if (!text.trim()) return null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : Date.now(),
    userId: typeof r.userId === 'string' ? r.userId : null,
    userName: typeof r.userName === 'string' ? r.userName : '—',
    roleId: typeof r.roleId === 'string' ? r.roleId : '',
    view: typeof r.view === 'string' ? r.view : '',
    text,
  }
}

export function normalizeAiChatStore(raw: unknown): AiChatStore {
  if (!raw || typeof raw !== 'object') return createDefaultAiChat()
  const r = raw as Record<string, unknown>
  const list = Array.isArray(r.entries) ? r.entries : []
  const entries = list
    .map(normalizeEntry)
    .filter((e): e is AiChatEntry => e !== null)
    .sort((a, b) => a.ts - b.ts)
  const sList = Array.isArray(r.suggestions) ? r.suggestions : []
  const suggestions = sList
    .map(normalizeSuggestion)
    .filter((e): e is SuggestionEntry => e !== null)
    .sort((a, b) => a.ts - b.ts)
  return {
    entries: entries.slice(-MAX_ENTRIES),
    suggestions: suggestions.slice(-MAX_SUGGESTIONS),
  }
}

export function appendEntries(store: AiChatStore, incoming: AiChatEntry[]): AiChatStore {
  if (incoming.length === 0) return store
  const merged = [...store.entries, ...incoming]
  return { ...store, entries: merged.slice(-MAX_ENTRIES) }
}

export function appendSuggestion(store: AiChatStore, item: SuggestionEntry): AiChatStore {
  const merged = [...(store.suggestions ?? []), item]
  return { ...store, suggestions: merged.slice(-MAX_SUGGESTIONS) }
}

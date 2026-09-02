import type {
  AiChatEntry,
  AiChatRole,
  AiChatStore,
  FeedbackKind,
  FeedbackStatus,
  SuggestionEntry,
} from './types'

/** Жёсткий предел, чтобы лог не разрастался бесконечно в общем сторе. */
const MAX_ENTRIES = 5000
const MAX_SUGGESTIONS = 2000

export function createDefaultAiChat(): AiChatStore {
  return { entries: [], suggestions: [] }
}

function normalizeRole(raw: unknown): AiChatRole {
  return raw === 'assistant' ? 'assistant' : 'user'
}

function normalizeKind(raw: unknown): FeedbackKind {
  return raw === 'bug' ? 'bug' : 'idea'
}

function normalizeStatus(raw: unknown): FeedbackStatus {
  if (raw === 'seen' || raw === 'done' || raw === 'new') return raw
  return 'new'
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
  const item: SuggestionEntry = {
    id: typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID(),
    ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : Date.now(),
    userId: typeof r.userId === 'string' ? r.userId : null,
    userName: typeof r.userName === 'string' ? r.userName : '—',
    roleId: typeof r.roleId === 'string' ? r.roleId : '',
    view: typeof r.view === 'string' ? r.view : '',
    text,
    kind: normalizeKind(r.kind),
    status: normalizeStatus(r.status),
  }
  if (typeof r.title === 'string' && r.title.trim()) item.title = r.title.trim()
  if (typeof r.userLogin === 'string' && r.userLogin.trim()) {
    item.userLogin = r.userLogin.trim().toLowerCase()
  }
  if (typeof r.statusUpdatedAt === 'number' && Number.isFinite(r.statusUpdatedAt)) {
    item.statusUpdatedAt = r.statusUpdatedAt
  }
  if (typeof r.statusUpdatedBy === 'string') item.statusUpdatedBy = r.statusUpdatedBy
  // Ответ админа обязателен: без этого normalize при sync/reload стирал письмо,
  // а следующий save мог затереть reply в облаке.
  if (typeof r.adminReply === 'string' && r.adminReply.trim()) {
    item.adminReply = r.adminReply.trim()
  }
  if (typeof r.adminReplyAt === 'number' && Number.isFinite(r.adminReplyAt)) {
    item.adminReplyAt = r.adminReplyAt
  }
  if (typeof r.adminReplyBy === 'string' && r.adminReplyBy.trim()) {
    item.adminReplyBy = r.adminReplyBy.trim()
  }
  return item
}

/** Сколько своих обращений с ответом админа ещё не «просмотрены» (session). */
export function countUnseenAdminReplies(
  store: AiChatStore | undefined,
  userId: string | null | undefined,
  userName?: string,
  userLogin?: string | null,
): number {
  if (typeof sessionStorage === 'undefined') return 0
  return suggestionsOwnedBy(store, userId, userName, userLogin).filter((s) => {
    if (!s.adminReply?.trim()) return false
    const key = `fst-feedback-reply-seen:${s.id}:${s.adminReplyAt ?? 0}`
    try {
      return !sessionStorage.getItem(key)
    } catch {
      return true
    }
  }).length
}

export function markAdminReplySeen(suggestionId: string, adminReplyAt?: number): void {
  if (typeof sessionStorage === 'undefined') return
  const key = `fst-feedback-reply-seen:${suggestionId}:${adminReplyAt ?? 0}`
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    /* ignore */
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
  const normalized: SuggestionEntry = {
    ...item,
    kind: item.kind ?? 'idea',
    status: item.status ?? 'new',
  }
  const merged = [...(store.suggestions ?? []), normalized]
  return { ...store, suggestions: merged.slice(-MAX_SUGGESTIONS) }
}

export function patchSuggestionStatus(
  store: AiChatStore,
  id: string,
  status: FeedbackStatus,
  byName?: string,
): AiChatStore {
  const now = Date.now()
  return {
    ...store,
    suggestions: (store.suggestions ?? []).map((s) =>
      s.id === id
        ? {
            ...s,
            status,
            statusUpdatedAt: now,
            statusUpdatedBy: byName,
          }
        : s,
    ),
  }
}

export function replyToSuggestion(
  store: AiChatStore,
  id: string,
  reply: string,
  byName?: string,
  close = true,
): AiChatStore {
  const text = reply.trim()
  const now = Date.now()
  return {
    ...store,
    suggestions: (store.suggestions ?? []).map((s) =>
      s.id === id
        ? {
            ...s,
            adminReply: text || s.adminReply,
            adminReplyAt: text ? now : s.adminReplyAt,
            adminReplyBy: text ? byName : s.adminReplyBy,
            status: close ? 'done' : s.status,
            statusUpdatedAt: close ? now : s.statusUpdatedAt,
            statusUpdatedBy: close ? byName : s.statusUpdatedBy,
          }
        : s,
    ),
  }
}

export function countNewFeedback(store: AiChatStore | undefined): number {
  return (store?.suggestions ?? []).filter((s) => s.status === 'new').length
}

/** Свои обращения отправителя (по login, userId, иначе по имени). */
export function suggestionsOwnedBy(
  store: AiChatStore | undefined,
  userId: string | null | undefined,
  userName?: string,
  userLogin?: string | null,
): SuggestionEntry[] {
  const list = store?.suggestions ?? []
  const id = userId?.trim() || ''
  const name = userName?.trim() || ''
  const login = userLogin?.trim().toLowerCase() || ''
  return list
    .filter((s) => {
      const sLogin = s.userLogin?.trim().toLowerCase() || ''
      if (login && sLogin && sLogin === login) return true
      if (login && !sLogin && s.userId?.trim().toLowerCase() === login) return true
      if (id && s.userId === id) return true
      if (!id && !login && name && s.userName === name) return true
      return false
    })
    .sort((a, b) => b.ts - a.ts)
}

/** Админ — все; остальные — только свои. */
export function suggestionsVisibleTo(
  store: AiChatStore | undefined,
  opts: {
    isAdmin: boolean
    userId?: string | null
    userName?: string
    userLogin?: string | null
  },
): SuggestionEntry[] {
  if (opts.isAdmin) {
    return [...(store?.suggestions ?? [])].sort((a, b) => b.ts - a.ts)
  }
  return suggestionsOwnedBy(store, opts.userId, opts.userName, opts.userLogin)
}

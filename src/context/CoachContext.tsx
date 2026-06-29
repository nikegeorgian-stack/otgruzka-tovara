import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { runCoach, type CoachSuggestion, type CoachTurn } from '@/lib/ai/coachClient'
import { detectTopic, type Locale } from '@/lib/ai/coachTargets'
import { resolveAiConnection } from '@/lib/ai/providers'
import type { AiChatEntry, SuggestionEntry } from '@/lib/aiChat/types'
import type { AiSettings } from '@/lib/types'

export type CoachUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  suggestions?: CoachSuggestion[]
}

type CoachContextValue = {
  available: boolean
  open: boolean
  setOpen: (v: boolean) => void
  messages: CoachUiMessage[]
  loading: boolean
  error: string | null
  send: (text: string) => Promise<void>
  startNewTopic: () => void
  highlight: (target: string) => void
  navigateTo: (view: string) => void
  activeHighlight: string | null
  submitSuggestion: (text: string) => void
}

const CoachContext = createContext<CoachContextValue | null>(null)

type ProviderProps = {
  aiSettings?: AiSettings
  locale: Locale
  view: string
  currentUser: { id: string; displayName?: string; roleId?: string } | null
  /** Человекочитаемое название роли (для тона ответа). */
  roleLabel?: string
  /** Разделы в рамках компетенции пользователя (ограничивает подсказки). */
  allowedViews: string[]
  onNavigate: (view: string) => void
  appendAiChatEntries: (entries: AiChatEntry[]) => void
  addSuggestion: (item: SuggestionEntry) => void
  children: ReactNode
}

export function CoachProvider({
  aiSettings,
  locale,
  view,
  currentUser,
  roleLabel,
  allowedViews,
  onNavigate,
  appendAiChatEntries,
  addSuggestion,
  children,
}: ProviderProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<CoachUiMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
  const historyRef = useRef<CoachTurn[]>([])
  const sessionRef = useRef<string>(crypto.randomUUID())
  const abortRef = useRef<AbortController | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const allowedViewsRef = useRef(allowedViews)
  allowedViewsRef.current = allowedViews
  const roleLabelRef = useRef(roleLabel)
  roleLabelRef.current = roleLabel

  const conn = useMemo(() => resolveAiConnection(aiSettings), [aiSettings])
  const available = conn !== null && conn.provider !== 'local'

  const highlight = useCallback((target: string) => {
    setActiveHighlight(null)
    // двойной rAF, чтобы перезапустить анимацию даже на той же цели
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setActiveHighlight(target))
    })
    if (highlightTimer.current) clearTimeout(highlightTimer.current)
    highlightTimer.current = setTimeout(() => setActiveHighlight(null), 4000)
  }, [])

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      abortRef.current?.abort()
    },
    [],
  )

  const navigateTo = useCallback(
    (target: string) => {
      onNavigate(target)
      setOpen(false)
    },
    [onNavigate],
  )

  const logEntry = useCallback(
    (role: 'user' | 'assistant', content: string, topic?: string) => {
      const entry: AiChatEntry = {
        id: crypto.randomUUID(),
        sessionId: sessionRef.current,
        ts: Date.now(),
        userId: currentUser?.id ?? null,
        userName: currentUser?.displayName ?? '—',
        roleId: currentUser?.roleId ?? '',
        view: viewRef.current,
        role,
        content,
        topic,
      }
      appendAiChatEntries([entry])
    },
    [appendAiChatEntries, currentUser],
  )

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading) return
      if (!conn || conn.provider === 'local') {
        setError('coach.notConfigured')
        return
      }

      setError(null)
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'user', content: trimmed },
      ])
      logEntry('user', trimmed, detectTopic(trimmed) ?? undefined)
      setLoading(true)

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const fallbackModel =
        conn.provider === 'gemini' && conn.model !== 'gemini-2.0-flash-lite'
          ? 'gemini-2.0-flash-lite'
          : undefined

      try {
        const result = await runCoach({
          apiKey: conn.apiKey,
          baseUrl: conn.baseUrl,
          model: conn.model,
          locale,
          currentView: viewRef.current,
          history: historyRef.current,
          userText: trimmed,
          roleLabel: roleLabelRef.current,
          allowedViews: allowedViewsRef.current,
          fallbackModel,
          signal: controller.signal,
        })
        historyRef.current = [
          ...historyRef.current,
          { role: 'user' as const, content: trimmed },
          { role: 'assistant' as const, content: result.reply },
        ].slice(-16)
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: result.reply,
            suggestions: result.suggestions,
          },
        ])
        logEntry('assistant', result.reply)
      } catch (e) {
        // запрос отменён (новая тема/новый вопрос/закрытие) — молча выходим
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
          return
        }
        const msg = e instanceof Error ? e.message : String(e)
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', content: `⚠️ ${msg}` },
        ])
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          setLoading(false)
        }
      }
    },
    [loading, conn, locale, logEntry],
  )

  const startNewTopic = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    sessionRef.current = crypto.randomUUID()
    historyRef.current = []
    setMessages([])
    setError(null)
    setLoading(false)
  }, [])

  const submitSuggestion = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      addSuggestion({
        id: crypto.randomUUID(),
        ts: Date.now(),
        userId: currentUser?.id ?? null,
        userName: currentUser?.displayName ?? '—',
        roleId: currentUser?.roleId ?? '',
        view: viewRef.current,
        text: trimmed,
      })
    },
    [addSuggestion, currentUser],
  )

  const value = useMemo(
    () => ({
      available,
      open,
      setOpen,
      messages,
      loading,
      error,
      send,
      startNewTopic,
      highlight,
      navigateTo,
      activeHighlight,
      submitSuggestion,
    }),
    [
      available,
      open,
      messages,
      loading,
      error,
      send,
      startNewTopic,
      highlight,
      navigateTo,
      activeHighlight,
      submitSuggestion,
    ],
  )

  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>
}

export function useCoach() {
  const ctx = useContext(CoachContext)
  if (!ctx) throw new Error('useCoach outside provider')
  return ctx
}

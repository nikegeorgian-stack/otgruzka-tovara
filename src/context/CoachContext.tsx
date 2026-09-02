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
import {
  readStoredCoachDepth,
  stepsForDepth,
  writeStoredCoachDepth,
  type CoachDepth,
} from '@/lib/coach/depth'
import { findGuide, guidesForView } from '@/lib/coach/guides/catalog'
import type { CoachGuide, CoachGuideStep } from '@/lib/coach/guides/types'
import type { AiChatEntry, SuggestionEntry } from '@/lib/aiChat/types'
import type { AiSettings } from '@/lib/types'

export type CoachUiMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  suggestions?: CoachSuggestion[]
}

export type CoachPanelMode = 'guides' | 'ask'

type CoachContextValue = {
  /** Гид всегда доступен (без Gemini). */
  available: boolean
  /** AI-чат доступен только при настроенном ключе. */
  aiAvailable: boolean
  open: boolean
  setOpen: (v: boolean) => void
  panelMode: CoachPanelMode
  setPanelMode: (m: CoachPanelMode) => void
  /** Каталог функций текущего раздела. */
  guides: CoachGuide[]
  activeGuide: CoachGuide | null
  /** Глубина: просто / с сопровождением / до конца сценария. */
  depth: CoachDepth
  setDepth: (d: CoachDepth) => void
  /** Шаги активного гида с учётом глубины. */
  activeSteps: CoachGuideStep[]
  stepIndex: number
  currentStep: CoachGuideStep | null
  /** Цель подсветки (data-coach). */
  activeHighlight: string | null
  /** Цель не найдена в DOM. */
  targetMissing: boolean
  /** Короткий тост после последнего шага. */
  justFinished: boolean
  startGuide: (guideId: string) => void
  stopGuide: () => void
  retryTarget: () => void
  /** AI chat (legacy, optional) */
  messages: CoachUiMessage[]
  loading: boolean
  error: string | null
  send: (text: string) => Promise<void>
  startNewTopic: () => void
  highlight: (target: string) => void
  navigateTo: (view: string) => void
  submitSuggestion: (text: string) => void
}

const CoachContext = createContext<CoachContextValue | null>(null)

type ProviderProps = {
  aiSettings?: AiSettings
  locale: Locale
  view: string
  currentUser: { id: string; displayName?: string; roleId?: string; login?: string } | null
  roleLabel?: string
  allowedViews: string[]
  onNavigate: (view: string) => void
  appendAiChatEntries: (entries: AiChatEntry[]) => void
  addSuggestion: (item: SuggestionEntry) => void
  children: ReactNode
}

function queryCoachTarget(target: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-coach="${CSS.escape(target)}"]`)
  let best: HTMLElement | null = null
  for (const el of nodes) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) best = el
  }
  return best ?? nodes[nodes.length - 1] ?? null
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
  const [panelMode, setPanelMode] = useState<CoachPanelMode>('guides')
  const [messages, setMessages] = useState<CoachUiMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null)
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [targetMissing, setTargetMissing] = useState(false)
  const [justFinished, setJustFinished] = useState(false)
  const [pulse, setPulse] = useState(0)
  const [depth, setDepthState] = useState<CoachDepth>(() => readStoredCoachDepth())
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setDepth = useCallback((d: CoachDepth) => {
    setDepthState(d)
    writeStoredCoachDepth(d)
  }, [])

  const historyRef = useRef<CoachTurn[]>([])
  const sessionRef = useRef<string>(crypto.randomUUID())
  const abortRef = useRef<AbortController | null>(null)
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const advancingRef = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const allowedViewsRef = useRef(allowedViews)
  allowedViewsRef.current = allowedViews
  const roleLabelRef = useRef(roleLabel)
  roleLabelRef.current = roleLabel

  const conn = useMemo(() => resolveAiConnection(aiSettings), [aiSettings])
  const aiAvailable = conn !== null && conn.provider !== 'local'
  const available = true

  const guides = useMemo(
    () => guidesForView(view, allowedViews),
    [view, allowedViews],
  )

  const activeGuide = activeGuideId ? findGuide(activeGuideId) ?? null : null
  const activeSteps = useMemo(
    () => (activeGuide ? stepsForDepth(activeGuide.steps, depth) : []),
    [activeGuide, depth],
  )
  const currentStep =
    stepIndex >= 0 && stepIndex < activeSteps.length ? activeSteps[stepIndex]! : null
  const activeStepsRef = useRef(activeSteps)
  activeStepsRef.current = activeSteps
  const depthRef = useRef(depth)
  depthRef.current = depth

  // При смене глубины во время гида — не выходить за пределы шагов
  useEffect(() => {
    if (!activeGuideId) return
    if (stepIndex >= activeSteps.length) {
      setStepIndex(Math.max(0, activeSteps.length - 1))
    }
  }, [activeGuideId, activeSteps.length, stepIndex])

  const setHighlightSticky = useCallback((target: string | null) => {
    setActiveHighlight(null)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setActiveHighlight(target)
        setPulse((n) => n + 1)
      })
    })
  }, [])

  const stopGuide = useCallback(() => {
    setActiveGuideId(null)
    setStepIndex(0)
    setTargetMissing(false)
    setHighlightSticky(null)
    advancingRef.current = false
  }, [setHighlightSticky])

  const markFinished = useCallback(() => {
    setJustFinished(true)
    if (finishTimer.current) clearTimeout(finishTimer.current)
    finishTimer.current = setTimeout(() => setJustFinished(false), 2600)
  }, [])

  const focusStepTarget = useCallback(
    (target: string) => {
      const el = queryCoachTarget(target)
      setTargetMissing(!el)
      setHighlightSticky(target)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      }
    },
    [setHighlightSticky],
  )

  const startGuide = useCallback(
    (guideId: string) => {
      const guide = findGuide(guideId)
      if (!guide || guide.steps.length === 0) return
      const steps = stepsForDepth(guide.steps, depthRef.current)
      if (steps.length === 0) return
      if (guide.view !== viewRef.current) {
        onNavigate(guide.view)
      }
      setPanelMode('guides')
      setOpen(false)
      setActiveGuideId(guide.id)
      setStepIndex(0)
      advancingRef.current = false
      // дать разделу отрисоваться после навигации
      window.setTimeout(() => {
        focusStepTarget(steps[0]!.target)
      }, guide.view !== viewRef.current ? 450 : 80)
    },
    [focusStepTarget, onNavigate],
  )

  const retryTarget = useCallback(() => {
    if (!currentStep) return
    focusStepTarget(currentStep.target)
  }, [currentStep, focusStepTarget])

  const advanceGuide = useCallback(() => {
    if (!activeGuide || advancingRef.current) return
    advancingRef.current = true
    const steps = activeStepsRef.current
    const next = stepIndex + 1
    if (next >= steps.length) {
      setHighlightSticky(null)
      setTargetMissing(false)
      setActiveGuideId(null)
      setStepIndex(0)
      advancingRef.current = false
      markFinished()
      return
    }
    setStepIndex(next)
    // модалки открываются дольше — дать DOM дорисоваться
    const delay = steps[next]!.target.includes(':') && next > 0 ? 520 : 380
    window.setTimeout(() => {
      focusStepTarget(steps[next]!.target)
      advancingRef.current = false
    }, delay)
  }, [activeGuide, stepIndex, focusStepTarget, setHighlightSticky, markFinished])

  // Клик по подсвеченной цели → следующий шаг (единственный способ продвижения)
  useEffect(() => {
    if (!activeGuide || !currentStep || !activeHighlight) return

    const onClickCapture = (e: MouseEvent) => {
      const raw = e.target
      if (!(raw instanceof Element)) return
      const hit = raw.closest<HTMLElement>(`[data-coach="${CSS.escape(activeHighlight)}"]`)
      if (!hit) return
      // клик проходит в кнопку (действие выполняется), шаг двигаем чуть позже
      window.setTimeout(() => advanceGuide(), 220)
    }

    document.addEventListener('click', onClickCapture, true)
    return () => document.removeEventListener('click', onClickCapture, true)
  }, [activeGuide, currentStep, activeHighlight, advanceGuide, pulse])

  // Перепроверить цель при смене DOM / шага
  useEffect(() => {
    if (!currentStep) return
    const t = window.setTimeout(() => {
      const el = queryCoachTarget(currentStep.target)
      setTargetMissing(!el)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }, 200)
    return () => clearTimeout(t)
  }, [currentStep, view, pulse])

  // AI one-shot highlight (не гид)
  const highlight = useCallback(
    (target: string) => {
      if (activeGuideId) return
      setHighlightSticky(target)
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlightSticky(null), 4000)
    },
    [activeGuideId, setHighlightSticky],
  )

  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      if (finishTimer.current) clearTimeout(finishTimer.current)
      abortRef.current?.abort()
    },
    [],
  )

  const navigateTo = useCallback(
    (target: string) => {
      onNavigate(target)
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
        userLogin: (() => {
          const login = currentUser?.login?.trim().toLowerCase()
          return login && login.includes('@') ? login : undefined
        })(),
        roleId: currentUser?.roleId ?? '',
        view: viewRef.current,
        text: trimmed,
        kind: 'idea',
        status: 'new',
      })
    },
    [addSuggestion, currentUser],
  )

  const value = useMemo(
    () => ({
      available,
      aiAvailable,
      open,
      setOpen,
      panelMode,
      setPanelMode,
      guides,
      activeGuide,
      depth,
      setDepth,
      activeSteps,
      stepIndex,
      currentStep,
      activeHighlight,
      targetMissing,
      justFinished,
      startGuide,
      stopGuide,
      retryTarget,
      messages,
      loading,
      error,
      send,
      startNewTopic,
      highlight,
      navigateTo,
      submitSuggestion,
    }),
    [
      available,
      aiAvailable,
      open,
      panelMode,
      guides,
      activeGuide,
      depth,
      setDepth,
      activeSteps,
      stepIndex,
      currentStep,
      activeHighlight,
      targetMissing,
      justFinished,
      startGuide,
      stopGuide,
      retryTarget,
      messages,
      loading,
      error,
      send,
      startNewTopic,
      highlight,
      navigateTo,
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

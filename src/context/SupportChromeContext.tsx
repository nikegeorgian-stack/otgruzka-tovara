import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type SupportChromeValue = {
  /** Сигнал открыть форму ОС (инкремент). */
  feedbackOpenSignal: number
  requestOpenFeedback: () => void
  /** Открыть сразу вкладку «Мои обращения». */
  feedbackMineSignal: number
  requestOpenFeedbackMine: () => void
  /** Сигнал открыть журнал писем админа. */
  mailOpenSignal: number
  requestOpenMail: () => void
  mailBadge: number
  setMailBadge: (n: number) => void
  /** Непросмотренные ответы админа (для кнопки «Отчёт»). */
  feedbackReplyBadge: number
  setFeedbackReplyBadge: (n: number) => void
}

const SupportChromeContext = createContext<SupportChromeValue | null>(null)

export function SupportChromeProvider({ children }: { children: ReactNode }) {
  const [feedbackOpenSignal, setFeedbackOpenSignal] = useState(0)
  const [feedbackMineSignal, setFeedbackMineSignal] = useState(0)
  const [mailOpenSignal, setMailOpenSignal] = useState(0)
  const [mailBadge, setMailBadge] = useState(0)
  const [feedbackReplyBadge, setFeedbackReplyBadge] = useState(0)

  const requestOpenFeedback = useCallback(() => {
    setFeedbackOpenSignal((n) => n + 1)
  }, [])
  const requestOpenFeedbackMine = useCallback(() => {
    setFeedbackMineSignal((n) => n + 1)
    setFeedbackOpenSignal((n) => n + 1)
  }, [])
  const requestOpenMail = useCallback(() => {
    setMailOpenSignal((n) => n + 1)
  }, [])

  const value = useMemo(
    () => ({
      feedbackOpenSignal,
      requestOpenFeedback,
      feedbackMineSignal,
      requestOpenFeedbackMine,
      mailOpenSignal,
      requestOpenMail,
      mailBadge,
      setMailBadge,
      feedbackReplyBadge,
      setFeedbackReplyBadge,
    }),
    [
      feedbackOpenSignal,
      requestOpenFeedback,
      feedbackMineSignal,
      requestOpenFeedbackMine,
      mailOpenSignal,
      requestOpenMail,
      mailBadge,
      feedbackReplyBadge,
    ],
  )

  return (
    <SupportChromeContext.Provider value={value}>{children}</SupportChromeContext.Provider>
  )
}

export function useSupportChrome(): SupportChromeValue {
  const ctx = useContext(SupportChromeContext)
  if (!ctx) {
    throw new Error('useSupportChrome must be used within SupportChromeProvider')
  }
  return ctx
}

/** Для оболочки: если провайдера нет — no-op (тесты / лабораторные экраны). */
export function useSupportChromeOptional(): SupportChromeValue | null {
  return useContext(SupportChromeContext)
}

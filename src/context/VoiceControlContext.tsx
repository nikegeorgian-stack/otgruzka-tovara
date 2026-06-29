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
import { VoiceHelpModal } from '@/components/voice/VoiceHelpModal'
import { VoiceControlBar } from '@/components/voice/VoiceControlBar'
import { useVoiceRecognition } from '@/hooks/useVoiceRecognition'
import { describeVoiceAction, voiceActionNeedsConfirm } from '@/lib/voiceConfirm'
import { parseVoiceCommand, type VoiceAction } from '@/lib/voiceCommands'
import type { DayCode, Group2x2, ScheduleType, ShiftMode, ViewId } from '@/lib/types'
import type { PrintVariant } from '@/components/print/PrintPreviewModal'

export type VoiceHandlers = {
  onMonthShift?: (delta: -1 | 1) => void
  onGoMonth?: (month: string) => string | void
  onCurrentMonth?: () => string | void
  onLayout?: (layout: 'dual' | 'plan' | 'fact') => void
  onPrint?: (opts?: { brigadeQuery?: string; variant?: PrintVariant }) => string | void
  onAddSlot?: () => void
  onRemoveEmptySlot?: () => void
  onBulkHoliday?: () => void
  onBulkCopy52?: () => void
  onSearch?: (query: string) => void
  onClearSearch?: () => void
  onClearFilters?: () => void
  onFilterBrigade?: (query: string) => string | void
  onFilterSchedule?: (schedule: ScheduleType | '') => void
  onAssignByName?: (name: string, brigadeQuery?: string) => string | void
  onUnassignByName?: (name: string) => string | void
  onReplaceInBrigade?: (args: {
    brigadeQuery?: string
    fromName: string
    toName: string
  }) => string | void
  onSwapEmployees?: (args: { nameA: string; nameB: string }) => string | void
  onChangeSchedule?: (args: {
    name: string
    fromDay: number
    schedule: ScheduleType
  }) => string | void
  onChangeEmployeeShift?: (args: {
    name: string
    fromDay: number
    schedule?: ScheduleType
    group2x2?: Group2x2
    shiftMode?: ShiftMode
  }) => string | void
  onPermanentAssign?: (args: { name: string; brigadeQuery: string }) => string | void
  onRegenerateMonth?: () => void
  onRegenerateEmployee?: (name: string) => string | void
  onSetCode?: (args: {
    name?: string
    day?: number
    code: DayCode
    mode?: 'plan' | 'fact'
  }) => string | void
  onSetCodeRange?: (args: {
    name: string
    fromDay: number
    toDay: number
    code: DayCode
    mode?: 'plan' | 'fact'
  }) => string | void
  onCaptureUndo?: (label: string) => void
  onUndo?: () => string | void
  onLocale?: (locale: 'ru' | 'ka') => void
  onExport?: () => void
  onHotkeys?: () => void
  onWarehouseReceipt?: (name: string, qty: number) => string | void
  onWarehouseBalance?: (name: string) => string | void
  onWarehouseExport?: () => string | void
  onWarehousePrint?: () => string | void
}

type VoiceControlContextValue = {
  registerHandlers: (handlers: VoiceHandlers) => () => void
  feedback: string
  setFeedback: (msg: string) => void
}

const VoiceControlContext = createContext<VoiceControlContextValue | null>(null)

type ProviderProps = {
  locale: 'ru' | 'ka'
  vocabulary?: string[]
  onNavigate: (view: ViewId) => void
  children: ReactNode
}

export function VoiceControlProvider({ locale, vocabulary = [], onNavigate, children }: ProviderProps) {
  const handlersRef = useRef<VoiceHandlers>({})
  const pendingRef = useRef<VoiceAction | null>(null)
  const [feedback, setFeedback] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)

  const registerHandlers = useCallback((handlers: VoiceHandlers) => {
    handlersRef.current = { ...handlersRef.current, ...handlers }
    return () => {
      const cur = handlersRef.current
      for (const key of Object.keys(handlers) as (keyof VoiceHandlers)[]) {
        if (cur[key] === handlers[key]) {
          delete cur[key]
        }
      }
    }
  }, [])

  const execute = useCallback(
    (action: VoiceAction, confirmed = false) => {
      const h = handlersRef.current

      if (action.type === 'confirm') {
        if (pendingRef.current) {
          const pending = pendingRef.current
          pendingRef.current = null
          execute(pending, true)
        } else {
          setFeedback('Нет команды для подтверждения')
        }
        return
      }

      if (action.type === 'cancelPending') {
        if (pendingRef.current) {
          pendingRef.current = null
          setFeedback('Отменено')
        }
        return
      }

      if (action.type === 'undo') {
        const msg = h.onUndo?.()
        setFeedback(msg ? `↩ ${msg}` : 'Нечего отменять')
        return
      }

      if (!confirmed && voiceActionNeedsConfirm(action)) {
        pendingRef.current = action
        setFeedback(`⚠ ${describeVoiceAction(action)}? Скажите «да»`)
        return
      }

      if (confirmed && voiceActionNeedsConfirm(action)) {
        h.onCaptureUndo?.(describeVoiceAction(action))
      }

      switch (action.type) {
        case 'nav':
          onNavigate(action.view)
          setFeedback(`→ ${action.view}`)
          break
        case 'month':
          h.onMonthShift?.(action.delta)
          setFeedback(action.delta > 0 ? '→ след. месяц' : '→ пред. месяц')
          break
        case 'goMonth': {
          const msg = h.onGoMonth?.(action.month)
          setFeedback(msg ?? `→ ${action.month}`)
          break
        }
        case 'currentMonth': {
          const msg = h.onCurrentMonth?.()
          setFeedback(msg ?? '→ текущий месяц')
          break
        }
        case 'layout':
          h.onLayout?.(action.layout)
          setFeedback(`→ ${action.layout}`)
          break
        case 'print': {
          const msg = h.onPrint?.(
            action.brigadeQuery
              ? { brigadeQuery: action.brigadeQuery, variant: action.variant }
              : undefined,
          )
          setFeedback(msg ?? (action.brigadeQuery ? '→ печать бригады' : '→ печать'))
          break
        }
        case 'addSlot':
          h.onAddSlot?.()
          setFeedback('+ место')
          break
        case 'removeEmptySlot':
          h.onRemoveEmptySlot?.()
          setFeedback('− место')
          break
        case 'bulkHoliday':
          h.onBulkHoliday?.()
          setFeedback('→ праздники В')
          break
        case 'bulkCopy52':
          h.onBulkCopy52?.()
          setFeedback('→ план→факт')
          break
        case 'search':
          h.onSearch?.(action.query)
          setFeedback(`🔍 ${action.query}`)
          break
        case 'clearSearch':
          h.onClearSearch?.()
          setFeedback('→ все')
          break
        case 'clearFilters':
          h.onClearFilters?.()
          setFeedback('→ фильтры сброшены')
          break
        case 'filterBrigade': {
          const msg = h.onFilterBrigade?.(action.query)
          setFeedback(msg ?? `→ ${action.query}`)
          break
        }
        case 'filterSchedule':
          h.onFilterSchedule?.(action.schedule)
          setFeedback(action.schedule || '→ все графики')
          break
        case 'assign': {
          const msg = h.onAssignByName?.(action.name, action.brigadeQuery)
          setFeedback(msg ?? `→ ${action.name}`)
          break
        }
        case 'unassign': {
          const msg = h.onUnassignByName?.(action.name)
          setFeedback(msg ?? `↩ ${action.name}`)
          break
        }
        case 'replaceInBrigade': {
          const msg = h.onReplaceInBrigade?.(action)
          setFeedback(msg ?? `↔ ${action.fromName}`)
          break
        }
        case 'swapEmployees': {
          const msg = h.onSwapEmployees?.(action)
          setFeedback(msg ?? `⇄`)
          break
        }
        case 'changeSchedule': {
          const msg = h.onChangeSchedule?.(action)
          setFeedback(msg ?? `↻ ${action.schedule}`)
          break
        }
        case 'changeEmployeeShift': {
          const msg = h.onChangeEmployeeShift?.(action)
          setFeedback(msg ?? `↻ ${action.name}`)
          break
        }
        case 'permanentAssign': {
          const msg = h.onPermanentAssign?.(action)
          setFeedback(msg ?? `→ ${action.name}`)
          break
        }
        case 'regenerateMonth':
          h.onRegenerateMonth?.()
          setFeedback('→ пересчёт плана')
          break
        case 'regenerateEmployee': {
          const msg = h.onRegenerateEmployee?.(action.name)
          setFeedback(msg ?? `↻ ${action.name}`)
          break
        }
        case 'setCode': {
          const msg = h.onSetCode?.(action)
          setFeedback(msg ?? `→ код ${action.code || '·'}`)
          break
        }
        case 'setCodeRange': {
          const msg = h.onSetCodeRange?.(action)
          setFeedback(msg ?? `→ ${action.fromDay}–${action.toDay}`)
          break
        }
        case 'locale':
          h.onLocale?.(action.locale)
          setFeedback(action.locale === 'ru' ? '→ RU' : '→ GE')
          break
        case 'exportJson':
          h.onExport?.()
          setFeedback('→ JSON')
          break
        case 'help':
          setShowHelp(true)
          break
        case 'hotkeys':
          h.onHotkeys?.()
          break
        case 'warehouseReceipt': {
          const msg = h.onWarehouseReceipt?.(action.name, action.qty)
          setFeedback(msg ?? `+${action.qty}`)
          break
        }
        case 'warehouseBalance': {
          const msg = h.onWarehouseBalance?.(action.name)
          setFeedback(msg ?? action.name)
          break
        }
        case 'warehouseExport': {
          const msg = h.onWarehouseExport?.()
          setFeedback(msg ?? '→ Excel')
          break
        }
        case 'warehousePrint': {
          const msg = h.onWarehousePrint?.()
          setFeedback(msg ?? '→ печать')
          break
        }
      }
    },
    [onNavigate],
  )

  const onResult = useCallback(
    (text: string) => {
      const t = text.toLowerCase()
      if (/^(стоп|выключи|хватит|тише|замолчи)/.test(t)) {
        pendingRef.current = null
        setVoiceEnabled(false)
        setFeedback('')
        return
      }
      const action = parseVoiceCommand(text)
      if (action) execute(action)
      else setFeedback(`? ${text.slice(0, 40)}`)
    },
    [execute],
  )

  const { listening, interim, toggle, stop, supported } = useVoiceRecognition({
    lang: locale === 'ka' ? 'ka-GE' : 'ru-RU',
    enabled: voiceEnabled,
    vocabulary,
    onResult,
    onError: (err) => setFeedback(`⚠ ${err}`),
  })

  useEffect(() => {
    if (!voiceEnabled) stop()
  }, [voiceEnabled, stop])

  const value = useMemo(
    () => ({ registerHandlers, feedback, setFeedback }),
    [registerHandlers, feedback],
  )

  return (
    <VoiceControlContext.Provider value={value}>
      {children}
      {supported && (
        <VoiceControlBar
          listening={listening && voiceEnabled}
          interim={interim}
          feedback={feedback}
          active={voiceEnabled}
          onToggle={() => {
            if (voiceEnabled) {
              setVoiceEnabled(false)
              stop()
            } else {
              setVoiceEnabled(true)
              toggle()
            }
          }}
          onHelp={() => setShowHelp(true)}
        />
      )}
      {showHelp && <VoiceHelpModal onClose={() => setShowHelp(false)} />}
    </VoiceControlContext.Provider>
  )
}

export function useVoiceControl() {
  const ctx = useContext(VoiceControlContext)
  if (!ctx) throw new Error('useVoiceControl outside provider')
  return ctx
}

export function useVoiceHandlers(handlers: VoiceHandlers) {
  const { registerHandlers } = useVoiceControl()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    const proxy: VoiceHandlers = {
      onMonthShift: (d) => handlersRef.current.onMonthShift?.(d),
      onGoMonth: (m) => handlersRef.current.onGoMonth?.(m),
      onCurrentMonth: () => handlersRef.current.onCurrentMonth?.(),
      onLayout: (l) => handlersRef.current.onLayout?.(l),
      onPrint: (o) => handlersRef.current.onPrint?.(o),
      onAddSlot: () => handlersRef.current.onAddSlot?.(),
      onRemoveEmptySlot: () => handlersRef.current.onRemoveEmptySlot?.(),
      onBulkHoliday: () => handlersRef.current.onBulkHoliday?.(),
      onBulkCopy52: () => handlersRef.current.onBulkCopy52?.(),
      onSearch: (q) => handlersRef.current.onSearch?.(q),
      onClearSearch: () => handlersRef.current.onClearSearch?.(),
      onClearFilters: () => handlersRef.current.onClearFilters?.(),
      onFilterBrigade: (q) => handlersRef.current.onFilterBrigade?.(q),
      onFilterSchedule: (s) => handlersRef.current.onFilterSchedule?.(s),
      onAssignByName: (n, b) => handlersRef.current.onAssignByName?.(n, b),
      onUnassignByName: (n) => handlersRef.current.onUnassignByName?.(n),
      onReplaceInBrigade: (a) => handlersRef.current.onReplaceInBrigade?.(a),
      onSwapEmployees: (a) => handlersRef.current.onSwapEmployees?.(a),
      onChangeSchedule: (a) => handlersRef.current.onChangeSchedule?.(a),
      onChangeEmployeeShift: (a) => handlersRef.current.onChangeEmployeeShift?.(a),
      onPermanentAssign: (a) => handlersRef.current.onPermanentAssign?.(a),
      onRegenerateMonth: () => handlersRef.current.onRegenerateMonth?.(),
      onRegenerateEmployee: (n) => handlersRef.current.onRegenerateEmployee?.(n),
      onSetCode: (a) => handlersRef.current.onSetCode?.(a),
      onSetCodeRange: (a) => handlersRef.current.onSetCodeRange?.(a),
      onCaptureUndo: (l) => handlersRef.current.onCaptureUndo?.(l),
      onUndo: () => handlersRef.current.onUndo?.(),
      onLocale: (l) => handlersRef.current.onLocale?.(l),
      onExport: () => handlersRef.current.onExport?.(),
      onHotkeys: () => handlersRef.current.onHotkeys?.(),
      onWarehouseReceipt: (n, q) => handlersRef.current.onWarehouseReceipt?.(n, q),
      onWarehouseBalance: (n) => handlersRef.current.onWarehouseBalance?.(n),
      onWarehouseExport: () => handlersRef.current.onWarehouseExport?.(),
      onWarehousePrint: () => handlersRef.current.onWarehousePrint?.(),
    }
    return registerHandlers(proxy)
  }, [registerHandlers])
}

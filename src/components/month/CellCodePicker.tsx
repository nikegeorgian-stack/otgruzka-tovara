import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { hoursForCode } from '@/lib/codes'
import { FACT_EXTRA_HOURS_OPTIONS, isWorkCode } from '@/lib/factExtra'
import { scheduleShortLabel } from '@/lib/schedules'
import type { DayCode, ScheduleType } from '@/lib/types'
import { CELL_CODE_STYLES } from './DayCell'

const PLAN_PICK_CODES: DayCode[] = [
  'ОТ',
  'ОО',
  'Б',
  'В',
  '4',
  '6',
  '8',
  '11',
  'Н',
  '22',
  'X',
  'ПР',
  '',
]

const FACT_BASE_CODES: DayCode[] = [
  'ОТ',
  'ОО',
  'Б',
  'В',
  '4',
  '6',
  '8',
  '11',
  'Н',
  '22',
  'X',
  'ПР',
  '',
]

/** Частые варианты неполной / полной смены (4, 7 и т.д.). */
const HOUR_OVERRIDE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

const KEEP_OPEN_FOR_HOURS: ReadonlySet<DayCode> = new Set([
  '4',
  '6',
  '8',
  '11',
  'Н',
  '22',
])

type Props = {
  x: number
  y: number
  dateLabel: string
  mode: 'plan' | 'fact'
  current: DayCode
  currentExtra?: number
  currentOverrideHours?: number | null
  /** Код плана этой ячейки — для кнопки «Как по плану» (как в перекличке). */
  planCode?: DayCode
  onPick: (code: DayCode) => void
  onPickExtra?: (hours: number) => void
  /** Точные отработанные часы смены (override). */
  onPickHoursOverride?: (hours: number | null) => void
  /** Циклический график сотрудника (2/2 или 1/1) — включает блок «цикл с этого дня». */
  cycleSchedule?: ScheduleType
  onPickCycle?: (variant: 'first' | 'last') => void
  onClose: () => void
}

function CodeBtn({
  code,
  active,
  title,
  label,
  onClick,
}: {
  code: DayCode
  active: boolean
  title: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      className={`flex h-9 flex-col items-center justify-center rounded-sm border font-mono text-sm font-bold transition-all hover:ring-2 hover:ring-accent/50 ${
        active ? 'ring-2 ring-accent ring-offset-1' : 'border-transparent'
      } ${CELL_CODE_STYLES[code] ?? CELL_CODE_STYLES['']}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export function CellCodePicker({
  x,
  y,
  dateLabel,
  mode,
  current,
  currentExtra = 0,
  currentOverrideHours = null,
  planCode,
  onPick,
  onPickExtra,
  onPickHoursOverride,
  cycleSchedule,
  onPickCycle,
  onClose,
}: Props) {
  const { t, tf, codeLabel } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const popoverZ = usePopoverZIndex()
  const [pos, setPos] = useState({ left: x, top: y })
  const [customHours, setCustomHours] = useState(
    () => (currentOverrideHours != null ? String(currentOverrideHours) : ''),
  )
  const canAddExtra = mode === 'fact' && !!onPickExtra
  const canOverrideHours = mode === 'fact' && !!onPickHoursOverride
  const workCode = isWorkCode(current)
  const planOff = hoursForCode((planCode ?? '') as DayCode) <= 0
  /** На выходном плане можно сразу указать часы — код подставится сам. */
  const hoursEnabled = workCode || (canOverrideHours && planOff)

  useEffect(() => {
    setCustomHours(currentOverrideHours != null ? String(currentOverrideHours) : '')
  }, [currentOverrideHours])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad)
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad)
    }
    setPos({ left, top })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const codes = mode === 'fact' ? FACT_BASE_CODES : PLAN_PICK_CODES

  return createPortal(
    <div
      ref={ref}
      className={`app-dialog-panel fixed overflow-hidden rounded-sm border border-grid bg-white shadow-sm  ${
        canAddExtra || canOverrideHours ? 'w-[18rem]' : 'w-[16rem]'
      }`}
      style={{ left: pos.left, top: pos.top, zIndex: popoverZ }}
      role="dialog"
      aria-label={t('cellPicker.title')}
    >
      <div className="border-b border-grid bg-stone-50 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
          {t('cellPicker.title')}
        </p>
        <p className="font-mono text-sm font-medium text-ink">{dateLabel}</p>
      </div>
      <div className="p-2">
      {mode === 'fact' && planCode !== undefined ? (
        <button
          type="button"
          className={`mb-2 w-full rounded-sm border px-2 py-1.5 text-left text-xs font-semibold transition-all hover:ring-2 hover:ring-emerald-400/50 ${
            current === planCode
              ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
              : 'border-grid bg-paper hover:bg-paper-dark'
          }`}
          title={t('rollcall.cameHint')}
          onClick={() => {
            onPick(planCode)
            onClose()
          }}
        >
          {t('rollcall.came')}
          <span className="ml-1 font-mono text-stone-500">
            ({planCode || '·'})
          </span>
        </button>
      ) : null}
      <div className="grid grid-cols-5 gap-1">
        {codes.map((code) => {
          const active = code === current
          const label =
            code === 'Н' && mode === 'fact'
              ? 'Н'
              : code || '·'
          const title =
            code === 'Н' && mode === 'fact'
              ? t('cellPicker.night11')
              : code
                ? codeLabel(code)
                : t('cellPicker.clear')
          return (
            <CodeBtn
              key={code || 'empty'}
              code={code}
              active={active}
              title={title}
              label={label}
              onClick={() => {
                onPick(code)
                const keepOpenForHours =
                  canOverrideHours && KEEP_OPEN_FOR_HOURS.has(code)
                if (!keepOpenForHours) onClose()
              }}
            />
          )
        })}
      </div>

      {mode === 'plan' && cycleSchedule && onPickCycle && (
        <div className="mt-2 border-t border-grid pt-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {tf('cellPicker.cycleTitle', { s: scheduleShortLabel(cycleSchedule) })}
          </p>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              title={t('cellPicker.cycleFirstHint')}
              className="rounded-sm border border-sky-200 bg-sky-50 px-2 py-1.5 text-left text-xs font-medium text-sky-900 transition-all hover:ring-2 hover:ring-sky-400/50"
              onClick={() => {
                onPickCycle('first')
                onClose()
              }}
            >
              {t('cellPicker.cycleFirst')}
            </button>
            {cycleSchedule === '2/2 11ч' && (
              <button
                type="button"
                title={t('cellPicker.cycleLastHint')}
                className="rounded-sm border border-sky-200 bg-sky-50 px-2 py-1.5 text-left text-xs font-medium text-sky-900 transition-all hover:ring-2 hover:ring-sky-400/50"
                onClick={() => {
                  onPickCycle('last')
                  onClose()
                }}
              >
                {t('cellPicker.cycleLast')}
              </button>
            )}
          </div>
        </div>
      )}

      {canOverrideHours && (
        <div className="mt-2 border-t border-grid pt-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {planOff && !workCode
              ? t('cellPicker.hoursWeekendTitle')
              : t('cellPicker.hoursTitle')}
          </p>
          <div className="grid grid-cols-6 gap-1">
            {HOUR_OVERRIDE_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                title={tf('cellPicker.hoursExact', { n: h })}
                disabled={!hoursEnabled}
                className={`rounded-sm border px-0.5 py-1.5 font-mono text-xs font-bold transition-all hover:ring-2 hover:ring-rose-400/60 disabled:cursor-not-allowed disabled:opacity-35 ${
                  currentOverrideHours === h ||
                  (currentOverrideHours == null && workCode && hoursForCode(current) === h)
                    ? 'border-rose-500 bg-rose-100 text-rose-900 ring-2 ring-rose-400 ring-offset-1'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
                onClick={() => onPickHoursOverride!(h)}
              >
                {h}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={24}
              step={1}
              inputMode="numeric"
              disabled={!hoursEnabled}
              placeholder={t('cellPicker.hoursCustom')}
              title={t('cellPicker.hoursCustomHint')}
              className="min-w-0 flex-1 rounded-sm border border-rose-200 bg-rose-50/50 px-2 py-1.5 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-35"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                const n = Number(customHours.replace(',', '.'))
                if (!Number.isFinite(n)) return
                onPickHoursOverride!(Math.max(0, Math.min(24, Math.round(n))))
              }}
            />
            <button
              type="button"
              title={t('cellPicker.hoursApply')}
              disabled={!hoursEnabled || !customHours.trim()}
              className="rounded-sm border border-rose-300 bg-rose-100 px-2 py-1.5 text-[10px] font-semibold text-rose-900 hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => {
                const n = Number(customHours.replace(',', '.'))
                if (!Number.isFinite(n)) return
                onPickHoursOverride!(Math.max(0, Math.min(24, Math.round(n))))
              }}
            >
              OK
            </button>
            <button
              type="button"
              title={t('cellPicker.hoursClear')}
              disabled={currentOverrideHours == null}
              className="rounded-sm border border-stone-200 bg-stone-50 px-2 py-1.5 font-mono text-xs text-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => onPickHoursOverride!(null)}
            >
              —
            </button>
          </div>
          {!hoursEnabled ? (
            <p className="mt-1.5 px-1 text-[10px] text-stone-400">{t('cellPicker.extraNeedWork')}</p>
          ) : planOff && !workCode ? (
            <p className="mt-1.5 px-1 text-[10px] text-amber-700">{t('cellPicker.hoursWeekendHint')}</p>
          ) : null}
        </div>
      )}

      {canAddExtra && (
        <div className="mt-2 border-t border-grid pt-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {t('cellPicker.extraTitle')}
          </p>
          <div className="grid grid-cols-7 gap-1">
            {FACT_EXTRA_HOURS_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                title={tf('cellPicker.extraHours', { n: h })}
                disabled={!workCode}
                className={`rounded-sm border px-0.5 py-1.5 font-mono text-xs font-bold transition-all hover:ring-2 hover:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-35 ${
                  currentExtra === h
                    ? 'border-amber-500 bg-amber-100 text-amber-900 ring-2 ring-amber-400 ring-offset-1'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
                onClick={() => onPickExtra!(h)}
              >
                +{h}
              </button>
            ))}
            <button
              type="button"
              title={t('cellPicker.extraClear')}
              disabled={currentExtra <= 0}
              className="rounded-sm border border-stone-200 bg-stone-50 px-0.5 py-1.5 font-mono text-xs text-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => onPickExtra!(0)}
            >
              —
            </button>
          </div>
          {mode === 'fact' && current === 'Н' && (
            <p className="mt-1.5 px-1 text-[10px] text-violet-700">{t('cellPicker.nightHint')}</p>
          )}
          {canAddExtra && current && !workCode && (
            <p className="mt-1.5 px-1 text-[10px] text-stone-400">{t('cellPicker.extraNeedWork')}</p>
          )}
        </div>
      )}

      <p className="mt-2 border-t border-grid px-1 pt-2 text-[10px] leading-snug text-stone-400">
        {mode === 'fact' ? t('cellPicker.hintFact') : t('cellPicker.hint')}
      </p>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}

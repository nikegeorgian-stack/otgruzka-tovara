import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { FACT_EXTRA_HOURS_OPTIONS } from '@/lib/factExtra'
import { scheduleShortLabel } from '@/lib/schedules'
import type { DayCode, ScheduleType } from '@/lib/types'
import { CELL_CODE_STYLES } from './DayCell'

const PLAN_PICK_CODES: DayCode[] = ['ОТ', 'ОО', 'Б', 'В', '8', '11', 'Н', '22', 'X', 'ПР', '']

const FACT_BASE_CODES: DayCode[] = ['ОТ', 'ОО', 'Б', 'В', '8', '11', 'Н', '22', 'X', 'ПР', '']

type Props = {
  x: number
  y: number
  dateLabel: string
  mode: 'plan' | 'fact'
  current: DayCode
  currentExtra?: number
  onPick: (code: DayCode) => void
  onPickExtra?: (hours: number) => void
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
  onPick,
  onPickExtra,
  cycleSchedule,
  onPickCycle,
  onClose,
}: Props) {
  const { t, tf, codeLabel } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const popoverZ = usePopoverZIndex()
  const [pos, setPos] = useState({ left: x, top: y })
  const canAddExtra = mode === 'fact' && !!onPickExtra

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
        canAddExtra ? 'w-[18rem]' : 'w-[16rem]'
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
                onClose()
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
                disabled={!current || !['8', '11', 'Н', '22'].includes(current)}
                className={`rounded-sm border px-0.5 py-1.5 font-mono text-xs font-bold transition-all hover:ring-2 hover:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-35 ${
                  currentExtra === h
                    ? 'border-amber-500 bg-amber-100 text-amber-900 ring-2 ring-amber-400 ring-offset-1'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
                onClick={() => {
                  onPickExtra!(h)
                  onClose()
                }}
              >
                +{h}
              </button>
            ))}
            <button
              type="button"
              title={t('cellPicker.extraClear')}
              disabled={currentExtra <= 0}
              className="rounded-sm border border-stone-200 bg-stone-50 px-0.5 py-1.5 font-mono text-xs text-stone-500 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={() => {
                onPickExtra!(0)
                onClose()
              }}
            >
              —
            </button>
          </div>
          {mode === 'fact' && current === 'Н' && (
            <p className="mt-1.5 px-1 text-[10px] text-violet-700">{t('cellPicker.nightHint')}</p>
          )}
          {canAddExtra && current && !['8', '11', 'Н', '22'].includes(current) && (
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

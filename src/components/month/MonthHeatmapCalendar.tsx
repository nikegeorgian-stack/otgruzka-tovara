import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { Locale } from '@/i18n/types'
import { parseMonthKey } from '@/lib/dates'
import { monthDayHeatmap, type DayHeatStatus } from '@/lib/monthDayStats'
import type { AppStore, MonthSheet } from '@/lib/types'

const HEAT_CLASS: Record<DayHeatStatus, string> = {
  future: 'bg-stone-50 text-stone-300 border-stone-100',
  weekend: 'bg-stone-100 text-stone-500 border-stone-200',
  holiday: 'bg-violet-50 text-violet-700 border-violet-200',
  empty: 'bg-amber-50 text-amber-800 border-amber-200',
  partial: 'bg-sky-50 text-sky-900 border-sky-200',
  ok: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  warn: 'bg-rose-50 text-rose-900 border-rose-300 ring-1 ring-rose-200',
}

function weekLabels(locale: Locale): string[] {
  if (locale === 'ka') return ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვ']
  if (locale === 'en') return ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
  return ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
}

function mondayPad(year: number, month: number): number {
  const sun0 = new Date(year, month - 1, 1).getDay()
  return (sun0 + 6) % 7
}

type Props = {
  store: AppStore
  sheet: MonthSheet
  mode: 'plan' | 'fact'
  selectedDay: number | null
  onSelectDay: (day: number) => void
  brigades?: Set<string>
  className?: string
}

export function MonthHeatmapCalendar({
  store,
  sheet,
  mode,
  selectedDay,
  onSelectDay,
  brigades,
  className = '',
}: Props) {
  const { t, tf, locale } = useI18n()
  const { year, month: mo } = parseMonthKey(sheet.month)
  const cells = useMemo(
    () => monthDayHeatmap(store, sheet, mode, { brigades }),
    [store, sheet, mode, brigades],
  )
  const pad = mondayPad(year, mo)

  const grid: Array<(typeof cells)[0] | null> = []
  for (let i = 0; i < pad; i++) grid.push(null)
  for (const c of cells) grid.push(c)

  return (
    <section
      className={`rounded-2xl border border-stone-200/80 bg-white/95 p-3 shadow-sm print:hidden ${className}`.trim()}
      data-coach="month:heatmapCalendar"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-stone-700">{t('month.calendar.title')}</p>
        <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-stone-500">
          {(['ok', 'partial', 'empty', 'warn', 'weekend', 'holiday'] as DayHeatStatus[]).map(
            (s) => (
              <li key={s} className="flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-sm border ${HEAT_CLASS[s].split(' ').find((x) => x.startsWith('bg-')) ?? 'bg-stone-200'}`}
                  aria-hidden
                />
                {t(`month.calendar.heat.${s}`)}
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-stone-400">
        {weekLabels(locale).map((w) => (
          <div key={w} className="py-0.5">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {grid.map((cell, idx) => {
          if (!cell) {
            return <div key={`pad-${idx}`} className="aspect-square min-h-[2.5rem]" />
          }
          const active = selectedDay === cell.day
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() => onSelectDay(cell.day)}
              className={[
                'flex min-h-[2.5rem] flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-xs font-semibold tabular-nums transition',
                HEAT_CLASS[cell.status],
                active ? 'ring-2 ring-sky-500 ring-offset-1' : 'hover:brightness-95',
              ].join(' ')}
              title={tf('month.calendar.dayHint', {
                day: String(cell.day),
                filled: String(cell.filled),
                total: String(cell.total),
              })}
            >
              <span>{cell.day}</span>
              {cell.total > 0 ? (
                <span className="text-[9px] font-medium opacity-80">
                  {cell.filled}/{cell.total}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-stone-500">{t('month.calendar.tapHint')}</p>
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { Locale } from '@/i18n/types'
import {
  type CabinetDayKind,
  type CabinetDayRow,
} from '@/lib/employeeCabinet/snapshot'
import { parseMonthKey } from '@/lib/dates'

type Props = {
  month: string
  days: CabinetDayRow[]
}

const KIND_CELL: Record<CabinetDayKind, string> = {
  empty: 'bg-stone-50 text-stone-300 border border-stone-100',
  off: 'bg-stone-200/80 text-stone-600 border border-stone-300/60',
  planned: 'bg-orange-50 text-orange-900 border border-orange-300/70',
  work: 'bg-emerald-500 text-white border border-emerald-600 shadow-sm shadow-emerald-900/10',
  overtime: 'bg-[#ff5500] text-white border border-[#e04b00] shadow-sm',
  night: 'bg-indigo-600 text-white border border-indigo-700 shadow-sm',
  double: 'bg-violet-600 text-white border border-violet-700 shadow-sm',
  vacation: 'bg-sky-500 text-white border border-sky-600 shadow-sm',
  sick: 'bg-amber-400 text-amber-950 border border-amber-500 shadow-sm',
  idle: 'bg-cyan-500 text-white border border-cyan-600 shadow-sm',
  absent: 'bg-red-600 text-white border border-red-700 shadow-sm',
  missed: 'bg-amber-200 text-amber-950 border border-amber-400 border-dashed',
  diff: 'bg-stone-400 text-white border border-stone-500',
}

const KIND_DOT: Record<CabinetDayKind, string> = {
  empty: 'bg-stone-200',
  off: 'bg-stone-400',
  planned: 'bg-orange-400',
  work: 'bg-emerald-500',
  overtime: 'bg-[#ff5500]',
  night: 'bg-indigo-500',
  double: 'bg-violet-500',
  vacation: 'bg-sky-500',
  sick: 'bg-amber-400',
  idle: 'bg-cyan-500',
  absent: 'bg-red-600',
  missed: 'bg-amber-600',
  diff: 'bg-stone-500',
}

const KIND_LIST_BAR: Record<CabinetDayKind, string> = {
  empty: 'bg-stone-200',
  off: 'bg-stone-400',
  planned: 'bg-orange-400',
  work: 'bg-emerald-500',
  overtime: 'bg-[#ff5500]',
  night: 'bg-indigo-500',
  double: 'bg-violet-500',
  vacation: 'bg-sky-500',
  sick: 'bg-amber-400',
  idle: 'bg-cyan-500',
  absent: 'bg-red-600',
  missed: 'bg-amber-600',
  diff: 'bg-stone-500',
}

const LEGEND_KINDS: CabinetDayKind[] = [
  'work',
  'overtime',
  'night',
  'double',
  'vacation',
  'sick',
  'idle',
  'absent',
  'missed',
  'off',
  'planned',
]

function weekStartLabels(locale: Locale): string[] {
  if (locale === 'ka') return ['ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ', 'კვ']
  if (locale === 'en') return ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
  return ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
}

function mondayPad(year: number, month: number): number {
  const sun0 = new Date(year, month - 1, 1).getDay()
  return (sun0 + 6) % 7
}

function codeLabelKey(code: string): string | null {
  if (!code) return null
  return `code.label.${code}`
}

function hoursLabel(n: number): string {
  if (!n) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

export function EmployeeTimesheetCalendar({ month, days }: Props) {
  const { t, tf, locale } = useI18n()
  const { year, month: mo } = parseMonthKey(month)
  const byDay = useMemo(() => {
    const map = new Map<number, CabinetDayRow>()
    for (const d of days) map.set(d.day, d)
    return map
  }, [days])

  const pad = mondayPad(year, mo)
  const daysCount = days.length
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    setSelectedKey(null)
  }, [month])

  const selected = useMemo(
    () => days.find((d) => d.dateKey === selectedKey) ?? null,
    [days, selectedKey],
  )

  const listedDays = useMemo(
    () =>
      days.filter(
        (d) =>
          d.kind !== 'empty' &&
          d.kind !== 'off' &&
          (d.plan || d.fact || d.isBrigadier),
      ),
    [days],
  )

  const cells: Array<CabinetDayRow | null> = []
  for (let i = 0; i < pad; i++) cells.push(null)
  for (let d = 1; d <= daysCount; d++) {
    cells.push(byDay.get(d) ?? null)
  }

  return (
    <section className="rounded-2xl border border-stone-200/70 bg-white/90 px-4 py-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">{t('my.cal.title')}</h2>
        <p className="text-[11px] text-stone-400">{t('my.hintReadonly')}</p>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-stone-400">
        {weekStartLabels(locale).map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1.5">
        {cells.map((cell, idx) => {
          if (!cell) {
            return <div key={`pad-${idx}`} className="aspect-square" />
          }
          const active = selectedKey === cell.dateKey
          const showHours =
            cell.workedHours > 0
              ? hoursLabel(cell.workedHours)
              : cell.kind === 'planned' && cell.planHours > 0
                ? hoursLabel(cell.planHours)
                : ''
          const mark = cell.fact || (cell.kind === 'planned' ? cell.plan : '') || ''
          return (
            <button
              key={cell.dateKey}
              type="button"
              onClick={() =>
                setSelectedKey((prev) => (prev === cell.dateKey ? null : cell.dateKey))
              }
              className={`relative flex min-h-[3.25rem] flex-col items-center justify-center rounded-xl px-0.5 py-1 text-sm font-semibold tabular-nums transition ${KIND_CELL[cell.kind]} ${
                active ? 'ring-2 ring-[#ff5500] ring-offset-1' : ''
              } ${cell.isBrigadier ? 'outline outline-2 outline-offset-[-3px] outline-teal-300' : ''}`}
              aria-pressed={active}
              aria-label={`${cell.day}`}
            >
              {cell.isBrigadier ? (
                <span
                  className="absolute right-0.5 top-0.5 rounded bg-teal-700 px-0.5 text-[7px] font-bold leading-none text-white"
                  title={t('my.cal.brigadierMark')}
                >
                  Бр
                </span>
              ) : null}
              <span className="text-[11px] font-bold leading-none opacity-90">{cell.day}</span>
              {mark ? (
                <span className="mt-0.5 max-w-full truncate text-[10px] font-extrabold leading-none">
                  {mark}
                  {cell.extraHours > 0 ? `+${hoursLabel(cell.extraHours)}` : ''}
                </span>
              ) : null}
              {showHours ? (
                <span className="mt-0.5 text-[9px] font-semibold leading-none opacity-90">
                  {showHours}
                  {t('my.cal.hoursUnit')}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <ul className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
        {LEGEND_KINDS.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5 text-[11px] text-stone-600">
            <span className={`h-2.5 w-2.5 rounded-sm ${KIND_DOT[kind]}`} aria-hidden />
            {t(`my.cal.kind.${kind}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-[11px] text-stone-600">
          <span
            className="h-2.5 w-2.5 rounded-sm bg-teal-600 outline outline-1 outline-teal-300"
            aria-hidden
          />
          {t('my.cal.brigadierMark')}
        </li>
      </ul>

      {selected ? (
        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50/80 px-3.5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {tf('my.cal.selected', { day: String(selected.day) })}
          </p>
          <p className="mt-1.5 text-sm font-semibold text-ink">
            {t(`my.cal.kind.${selected.kind}`)}
            {selected.isBrigadier ? ` · ${t('my.cal.brigadierMark')}` : ''}
          </p>
          <dl className="mt-2 space-y-1.5 text-sm text-stone-600">
            <div className="flex justify-between gap-3">
              <dt>{t('my.col.plan')}</dt>
              <dd className="text-right font-medium text-ink">
                {selected.plan
                  ? `${selected.plan} · ${t(codeLabelKey(selected.plan)!)}${
                      selected.planHours > 0
                        ? ` · ${hoursLabel(selected.planHours)} ${t('my.cal.hoursUnit')}`
                        : ''
                    }`
                  : t('my.cal.none')}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{t('my.col.fact')}</dt>
              <dd className="text-right font-medium text-ink">
                {selected.fact
                  ? `${selected.fact} · ${t(codeLabelKey(selected.fact)!)}`
                  : t('my.cal.none')}
              </dd>
            </div>
            {selected.workedHours > 0 ? (
              <div className="flex justify-between gap-3">
                <dt>{t('my.cal.workedHours')}</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {hoursLabel(selected.workedHours)} {t('my.cal.hoursUnit')}
                </dd>
              </div>
            ) : null}
            {selected.extraHours > 0 ? (
              <div className="flex justify-between gap-3">
                <dt>{t('my.cal.overtime')}</dt>
                <dd className="font-semibold tabular-nums text-[#c2410c]">
                  +{hoursLabel(selected.extraHours)} {t('my.cal.hoursUnit')}
                </dd>
              </div>
            ) : null}
            {selected.isBrigadier ? (
              <div className="flex justify-between gap-3">
                <dt>{t('my.cal.brigadierMark')}</dt>
                <dd className="font-semibold text-teal-800">{t('my.cal.brigadierYes')}</dd>
              </div>
            ) : null}
            {selected.brigade ? (
              <div className="flex justify-between gap-3">
                <dt>{t('my.cal.brigade')}</dt>
                <dd className="text-right font-medium text-ink">{selected.brigade}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            {t(`my.cal.hint.${selected.kind}`)}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-stone-400">{t('my.cal.tapHint')}</p>
      )}

      {listedDays.length > 0 ? (
        <div className="mt-5 border-t border-stone-100 pt-4">
          <p className="text-sm font-semibold text-ink">{t('my.cal.dayList')}</p>
          <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {listedDays.map((d) => (
              <li key={d.dateKey}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(d.dateKey)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left text-sm transition ${
                    selectedKey === d.dateKey
                      ? 'border-[#ff5500]/40 bg-orange-50/80'
                      : 'border-stone-100 bg-stone-50/60 hover:bg-stone-50'
                  }`}
                >
                  <span
                    className={`h-8 w-1 shrink-0 rounded-full ${KIND_LIST_BAR[d.kind]}`}
                    aria-hidden
                  />
                  <span className="w-7 shrink-0 text-xs font-bold tabular-nums text-stone-500">
                    {String(d.day).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {t(`my.cal.kind.${d.kind}`)}
                    {d.fact ? ` · ${d.fact}` : d.plan ? ` · ${d.plan}` : ''}
                    {d.isBrigadier ? ` · ${t('my.cal.brigadierShort')}` : ''}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-stone-600">
                    {d.workedHours > 0
                      ? `${hoursLabel(d.workedHours)} ${t('my.cal.hoursUnit')}`
                      : d.planHours > 0
                        ? `${hoursLabel(d.planHours)} ${t('my.cal.hoursUnit')}`
                        : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

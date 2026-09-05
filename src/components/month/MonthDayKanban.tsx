import { useMemo } from 'react'
import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { brigadeLabel } from '@/lib/brigadeText'
import { dayDateKey, parseMonthKey } from '@/lib/dates'
import {
  bucketForCode,
  defaultCodeForBucket,
  type DayCodeBucket,
} from '@/lib/monthDayStats'
import { getFactMark } from '@/lib/stats'
import type { AppStore, DayCode, MonthSheet } from '@/lib/types'

const COLUMNS: DayCodeBucket[] = ['empty', 'work', 'absence', 'off']

type DayRowCard = {
  rowId: string
  employeeId: string
  brigade: string
  code: DayCode
  planCode: DayCode
  bucket: DayCodeBucket
}

type Props = {
  store: AppStore
  sheet: MonthSheet
  day: number
  mode: 'plan' | 'fact'
  brigades?: Set<string>
  readOnly?: boolean
  onSetCode: (rowId: string, dateKey: string, code: DayCode) => void
}

export function MonthDayKanban({
  store,
  sheet,
  day,
  mode,
  brigades,
  readOnly = false,
  onSetCode,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { year, month } = parseMonthKey(sheet.month)
  const dateKey = dayDateKey(year, month, day)
  const { draggingId, dropColumnId, cardDragProps, columnDropProps } =
    useKanbanDrag<DayCodeBucket>()

  const cards = useMemo(() => {
    const list: DayRowCard[] = []
    for (const row of sheet.rows) {
      if (!row.employeeId) continue
      if (brigades && brigades.size > 0 && !brigades.has(row.brigade)) continue
      const emp = store.employees.find((e) => e.id === row.employeeId)
      if (!emp) continue
      const planCode = (sheet.plan[row.id]?.[dateKey] ?? '') as DayCode
      const code = (
        mode === 'plan' ? planCode : getFactMark(sheet, row.id, dateKey)
      ) as DayCode
      list.push({
        rowId: row.id,
        employeeId: row.employeeId,
        brigade: row.brigade,
        code,
        planCode,
        bucket: bucketForCode(code),
      })
    }
    return list.sort((a, b) => {
      const ea = store.employees.find((e) => e.id === a.employeeId)!
      const eb = store.employees.find((e) => e.id === b.employeeId)!
      return employeeName(ea, locale).localeCompare(employeeName(eb, locale), locale === 'ka' ? 'ka' : 'ru')
    })
  }, [sheet, store.employees, brigades, dateKey, mode, locale])

  function byBucket(bucket: DayCodeBucket) {
    return cards.filter((c) => c.bucket === bucket)
  }

  function handleDrop(rowId: string, bucket: DayCodeBucket) {
    if (readOnly) return
    const card = cards.find((c) => c.rowId === rowId)
    if (!card || card.bucket === bucket) return
    const next = defaultCodeForBucket(bucket, card.planCode)
    onSetCode(rowId, dateKey, next)
  }

  return (
    <div data-coach="month:dayKanban">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">
          {tf('month.dayKanban.title', { day: String(day) })}
        </h3>
        <span className="text-xs text-stone-500">
          {mode === 'plan' ? t('month.plan') : t('month.fact')}
        </span>
      </div>
      <KanbanBoard>
        {COLUMNS.map((bucket) => {
          const col = byBucket(bucket)
          return (
            <KanbanColumn
              key={bucket}
              title={t(`month.dayKanban.col.${bucket}`)}
              count={col.length}
              isDropTarget={!readOnly && dropColumnId === bucket}
              isDragging={!!draggingId}
              dropHandlers={
                readOnly
                  ? { onDragOver: (e) => e.preventDefault(), onDragLeave: () => {}, onDrop: (e) => e.preventDefault() }
                  : columnDropProps(bucket, handleDrop)
              }
            >
              {col.map((c) => {
                const emp = store.employees.find((e) => e.id === c.employeeId)!
                const cardBody = (
                  <>
                    <div className="truncate text-xs font-semibold text-ink">
                      {employeeName(emp, locale)}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-stone-500">
                      {brigadeLabel(c.brigade, store.brigadeNamesKa, locale)}
                    </div>
                    <div className="mt-1.5 inline-flex rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-bold text-stone-800">
                      {c.code || '—'}
                      {mode === 'fact' && c.planCode && c.planCode !== c.code ? (
                        <span className="ml-1 font-normal text-stone-400">/{c.planCode}</span>
                      ) : null}
                    </div>
                  </>
                )
                if (readOnly) {
                  return (
                    <div
                      key={c.rowId}
                      className="w-full rounded-xl border border-stone-200/90 bg-white p-2.5 text-left text-sm shadow-sm"
                    >
                      {cardBody}
                    </div>
                  )
                }
                return (
                  <KanbanCardShell
                    key={c.rowId}
                    dragging={draggingId === c.rowId}
                    dragProps={cardDragProps(c.rowId)}
                  >
                    {cardBody}
                  </KanbanCardShell>
                )
              })}
            </KanbanColumn>
          )
        })}
      </KanbanBoard>
    </div>
  )
}

import { Fragment, useMemo } from 'react'
import { getBrigades } from '@/lib/brigades'
import { CODE_DEFS } from '@/lib/codes'
import {
  dayDateKey,
  daysInMonth,
  isWeekend,
  parseMonthKey,
  weekdayShort,
} from '@/lib/dates'
import { employeeName, t } from '@/i18n'
import { buildTimesheetLayout } from '@/lib/monthTimesheetLayout'
import {
  employeeStructuralUnitKey,
  type MonthGroupMode,
} from '@/lib/monthViewOptions'
import { getSubstitution, substitutionLabel } from '@/lib/substitutions'
import { getFactMark, rowStats } from '@/lib/stats'
import type { AppStore, DayCode, Locale, MonthSheet } from '@/lib/types'

const CODE_PRINT: Record<string, string> = {
  '8': 'print-code--8',
  '11': 'print-code--11',
  'Н': 'print-code--n',
  '22': 'print-code--22',
  'В': 'print-code--v',
  'ОТ': 'print-code--ot',
  'ОО': 'print-code--oo',
  'Б': 'print-code--b',
  'X': 'print-code--x',
  'ПР': 'print-code--pr',
  '': 'print-code--empty',
}

function PrintCode({ code }: { code: DayCode }) {
  return (
    <span className={`print-day-cell ${CODE_PRINT[code] ?? CODE_PRINT['']}`}>
      {code || '·'}
    </span>
  )
}

type Props = {
  store: AppStore
  sheet: MonthSheet
  mode: 'plan' | 'fact'
  brigades: string[]
  printLocale: Locale
  groupMode?: MonthGroupMode
  structuralUnitIds?: string[]
  showTotals?: boolean
}

export function PrintTimesheetTable({
  store,
  sheet,
  mode,
  brigades,
  printLocale,
  groupMode = 'brigade',
  structuralUnitIds,
  showTotals = true,
}: Props) {
  const brigadeSet = new Set(brigades)
  const allBrigades = getBrigades(store)
  const { year, month } = parseMonthKey(sheet.month)
  const days = daysInMonth(year, month)
  const dayNums = Array.from({ length: days }, (_, i) => i + 1)
  const totalCols = 4 + days + (showTotals ? (mode === 'fact' ? 2 : 1) : 0)
  const unitFilter = structuralUnitIds?.length ? new Set(structuralUnitIds) : null

  const fixedPct = mode === 'fact' ? 34 : 30
  const dayPct = (100 - fixedPct) / days

  const layoutBlocks = useMemo(
    () =>
      buildTimesheetLayout(
        {
          store,
          sheet,
          brigades: allBrigades,
          groupMode,
          brigadeShown: (b) => brigadeSet.has(b),
          rowVisible: (_rowId, _brigade, employeeId) => {
            if (!employeeId) return false
            const emp = store.employees.find((e) => e.id === employeeId)
            if (!emp) return false
            if (unitFilter && !unitFilter.has(employeeStructuralUnitKey(emp))) {
              return false
            }
            return true
          },
          searchActive: false,
        },
        (key) => t(printLocale, key),
      ),
    [allBrigades, brigadeSet, groupMode, printLocale, sheet, store, unitFilter],
  )

  return (
    <table className="print-table">
      <colgroup>
        <col style={{ width: '3%' }} />
        <col style={{ width: '15%' }} />
        <col style={{ width: '4%' }} />
        <col style={{ width: '4%' }} />
        {dayNums.map((d) => (
          <col key={d} style={{ width: `${dayPct}%` }} />
        ))}
        {showTotals && (
          <>
            <col style={{ width: '4%' }} />
            {mode === 'fact' && <col style={{ width: '4%' }} />}
          </>
        )}
      </colgroup>
      <thead>
        <tr>
          <th className="print-th">{t(printLocale, 'print.colNo')}</th>
          <th className="print-th print-th-left">{t(printLocale, 'print.colName')}</th>
          <th className="print-th">{t(printLocale, 'print.colTab')}</th>
          <th className="print-th">{t(printLocale, 'print.colSchedule')}</th>
          {dayNums.map((d) => (
            <th
              key={d}
              className={`print-th print-th-day ${isWeekend(year, month, d) ? 'print-weekend' : ''}`}
            >
              <span className="print-day-num">{d}</span>
              <span className="print-dow">{weekdayShort(year, month, d)}</span>
            </th>
          ))}
          {showTotals && (
            <>
              <th className="print-th">{t(printLocale, 'print.colPlanH')}</th>
              {mode === 'fact' && (
                <th className="print-th">{t(printLocale, 'print.colFactH')}</th>
              )}
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {layoutBlocks.map((block) => {
          if (block.kind === 'unit') {
            return (
              <tr key={`unit-${block.unitId}`} className="print-brigade-row print-unit-row">
                <td colSpan={totalCols}>{block.unitLabel}</td>
              </tr>
            )
          }

          const brigade = block.brigade
          const visibleRows = block.rows.filter((r) => r.employeeId)
          if (!visibleRows.length) return null

          return (
            <Fragment key={`${block.kind}-${block.unitId ?? 'x'}-${brigade}`}>
              <tr className="print-brigade-row">
                <td colSpan={totalCols}>{brigade}</td>
              </tr>
              {visibleRows.map((row, idx) => {
                const emp = store.employees.find((e) => e.id === row.employeeId)!
                const rs = rowStats(sheet, row.id, days, year, month)
                return (
                  <tr key={row.id}>
                    <td className="print-td print-td-center">{idx + 1}</td>
                    <td className="print-td print-td-name">{employeeName(emp, printLocale)}</td>
                    <td className="print-td print-td-center">{emp.tabNumber}</td>
                    <td className="print-td print-td-center">
                      {emp.schedule === '5/2 8ч'
                        ? '5/2'
                        : emp.schedule === '1/1 11ч'
                          ? '1/1'
                          : '2/2'}
                    </td>
                    {dayNums.map((d) => {
                      const dateKey = dayDateKey(year, month, d)
                      const planCode = sheet.plan[row.id]?.[dateKey] ?? ''
                      const factCode = getFactMark(sheet, row.id, dateKey)
                      const code = mode === 'plan' ? planCode : factCode
                      const mismatch = planCode !== factCode
                      const subTitle =
                        mode === 'fact'
                          ? substitutionLabel(sheet, store.employees, row.id, dateKey)
                          : undefined
                      return (
                        <td
                          key={d}
                          className={`print-td print-td-day ${mismatch && mode === 'fact' ? 'print-mismatch' : ''}`}
                          title={subTitle}
                        >
                          <PrintCode code={code} />
                          {getSubstitution(sheet, row.id, dateKey) && mode === 'fact' && (
                            <span className="print-sub-mark">З</span>
                          )}
                        </td>
                      )
                    })}
                    {showTotals && (
                      <>
                        <td className="print-td print-td-center print-td-bold">
                          {rs.planHours}
                        </td>
                        {mode === 'fact' && (
                          <td className="print-td print-td-center print-td-bold">
                            {rs.factHours}
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                )
              })}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}

export function PrintCodeLegend({ locale }: { locale: Locale }) {
  return (
    <div className="print-legend">
      <span>{t(locale, 'print.legend')}:</span>
      {CODE_DEFS.map((c) => (
        <span key={c.code}>
          <strong>{c.code}</strong>={t(locale, `code.label.${c.code}`)}
        </span>
      ))}
    </div>
  )
}

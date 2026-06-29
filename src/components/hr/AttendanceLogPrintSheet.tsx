import { Fragment } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import {
  ATTENDANCE_LOG_MANUAL_ROWS,
  chunkAttendancePages,
  formatEmployeeAttendanceNameLines,
  formatWeekRange,
  weekDaysFromMonday,
} from '@/lib/hr/attendanceLog'
import { t, tf } from '@/i18n'
import type { Employee, Locale } from '@/lib/types'

type Props = {
  employees: Employee[]
  mondayIso: string
  site: string
  responsible?: string
  locale: Locale
}

export function AttendanceLogPrintSheet({
  employees,
  mondayIso,
  site,
  responsible,
  locale,
}: Props) {
  const days = weekDaysFromMonday(mondayIso)
  const pages = chunkAttendancePages(employees)
  const weekRange = formatWeekRange(mondayIso, locale)
  const title = t(locale, 'hr.attendanceLog.printTitle')
  const printHint = t(locale, 'hr.attendanceLog.printHint')
  const colName = t(locale, 'hr.attendanceLog.printColName')
  const totalListed = employees.length
  const isLastPage = (idx: number) => idx === pages.length - 1

  function rowNumber(pageIdx: number, idxOnPage: number): number {
    let n = 0
    for (let p = 0; p < pageIdx; p++) n += pages[p]!.length
    return n + idxOnPage + 1
  }

  return (
    <>
      {pages.map((pageEmployees, pageIdx) => {
        const compact = pageIdx > 0
        return (
          <article
            key={pageIdx}
            className={`print-sheet-page print-attendance-log-page${pageIdx < pages.length - 1 ? ' print-page-break-after' : ''}`}
          >
            <div className="print-sheet-content print-attendance-content">
              {compact ? (
                <header className="print-attendance-header-compact">
                  <span className="print-attendance-compact-title">{title}</span>
                  <span className="print-attendance-compact-week">{weekRange}</span>
                  {pages.length > 1 ? (
                    <span className="print-attendance-compact-page">
                      {tf(locale, 'hr.attendanceLog.pageOf', {
                        page: pageIdx + 1,
                        total: pages.length,
                      })}
                    </span>
                  ) : null}
                </header>
              ) : (
                <header className="print-sheet-header print-attendance-header">
                  <div className="print-fc-header-row">
                    <FiberCellBrand variant="print" />
                    <div className="print-fc-header-text">
                      <p className="print-org">{t(locale, 'print.sheetTitle')}</p>
                      <h1 className="print-title print-attendance-title">{title}</h1>
                      <p className="print-attendance-print-hint">{printHint}</p>
                      <p className="print-meta print-attendance-meta">
                        {t(locale, 'print.site')}: {site}
                        {responsible
                          ? ` · ${t(locale, 'print.responsible')}: ${responsible}`
                          : ''}
                        {' · '}
                        {t(locale, 'hr.attendanceLog.week')}: <strong>{weekRange}</strong>
                      </p>
                    </div>
                  </div>
                </header>
              )}

              <table className="print-table print-attendance-log-table">
                <colgroup>
                  <col className="print-att-col-no" />
                  <col className="print-att-col-name" />
                  {days.map((d) => (
                    <Fragment key={d.iso}>
                      <col className="print-att-col-time" />
                      <col className="print-att-col-time" />
                      <col className="print-att-col-sign" />
                    </Fragment>
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2} className="print-th print-att-th-no">
                      №
                    </th>
                    <th rowSpan={2} className="print-th print-th-left print-att-th-name">
                      {colName}
                    </th>
                    {days.map((d) => (
                      <th key={d.iso} colSpan={3} className="print-th print-att-day-head">
                        <span className="print-att-dow">
                          {locale === 'ka' ? d.weekdayKa : d.weekdayRu}
                        </span>
                        <span className="print-att-date">{d.dateShort}</span>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {days.map((d) => (
                      <DaySubHeaders key={d.iso} locale={locale} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageEmployees.map((emp, idx) => (
                    <tr key={emp.id}>
                      <td className="print-td print-td-center print-att-td-no">
                        {rowNumber(pageIdx, idx)}
                      </td>
                      <AttendanceNameCell emp={emp} />
                      {days.map((d) => (
                        <TimeCells key={d.iso} />
                      ))}
                    </tr>
                  ))}
                  {isLastPage(pageIdx)
                    ? Array.from({ length: ATTENDANCE_LOG_MANUAL_ROWS }, (_, manualIdx) => (
                        <tr key={`manual-${manualIdx}`} className="print-att-manual-row">
                          <td className="print-td print-td-center print-att-td-no print-att-manual-no">
                            {totalListed + manualIdx + 1}
                          </td>
                          <td className="print-td print-att-name print-att-manual-name" aria-label="name" />
                          {days.map((d) => (
                            <TimeCells key={d.iso} />
                          ))}
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>

              {isLastPage(pageIdx) ? (
                <>
                  <p className="print-attendance-hr-note">
                    {t(locale, 'hr.attendanceLog.notInListHint')}
                  </p>
                  <footer className="print-attendance-footer">
                    <div className="print-attendance-sign">
                      <span>{t(locale, 'hr.attendanceLog.signManager')}:</span>
                      <span className="print-attendance-sign-line" />
                    </div>
                    <div className="print-attendance-sign">
                      <span>{t(locale, 'hr.attendanceLog.signResponsible')}:</span>
                      <span className="print-attendance-sign-line" />
                    </div>
                  </footer>
                </>
              ) : null}
            </div>
          </article>
        )
      })}
    </>
  )
}

function AttendanceNameCell({ emp }: { emp: Employee }) {
  const { ru, ka } = formatEmployeeAttendanceNameLines(emp)
  return (
    <td className="print-td print-td-name print-att-name">
      <span className="print-att-name-ru">{ru}</span>
      {ka ? <span className="print-att-name-ka">{ka}</span> : null}
    </td>
  )
}

function DaySubHeaders({ locale }: { locale: Locale }) {
  return (
    <>
      <th className="print-th print-att-time-head">{t(locale, 'hr.attendanceLog.colIn')}</th>
      <th className="print-th print-att-time-head">{t(locale, 'hr.attendanceLog.colOut')}</th>
      <th className="print-th print-att-time-head print-att-sign-head">
        {t(locale, 'hr.attendanceLog.colSign')}
      </th>
    </>
  )
}

function TimeCells() {
  return (
    <>
      <td className="print-td print-att-time-cell" aria-label="in" />
      <td className="print-td print-att-time-cell" aria-label="out" />
      <td className="print-td print-att-time-cell print-att-sign-cell" aria-label="sign" />
    </>
  )
}

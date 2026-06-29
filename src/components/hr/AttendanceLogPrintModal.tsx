import { useEffect, useMemo, useRef, useState } from 'react'
import { AttendanceLogPrintSheet } from '@/components/hr/AttendanceLogPrintSheet'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Skeleton'
import { useI18n } from '@/context/I18nContext'
import { addDaysIso, mondayOfWeekIso } from '@/lib/dates'
import {
  defaultAttendanceEmployeeIds,
  fitAttendanceLogPages,
  formatEmployeeAttendanceNameLines,
  formatWeekRange,
  loadAttendanceLogSelection,
  resetAttendanceLogFit,
  saveAttendanceLogSelection,
  scheduleShortLabel,
  sortEmployeesForAttendance,
} from '@/lib/hr/attendanceLog'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  site: string
  responsible?: string
  onClose: () => void
}

export function AttendanceLogPrintModal({ employees, site, responsible, onClose }: Props) {
  const { t, tf, locale } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState<'setup' | 'preview'>('setup')
  const [mondayIso, setMondayIso] = useState(() => mondayOfWeekIso())
  const [selected, setSelected] = useState<Set<string>>(() =>
    loadAttendanceLogSelection(employees),
  )
  const [search, setSearch] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [selectionError, setSelectionError] = useState(false)

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.active !== false).sort(sortEmployeesForAttendance),
    [employees],
  )

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return activeEmployees
    return activeEmployees.filter((e) => {
      const hay = [e.fullName, e.nameKa, e.tabNumber, e.position, e.brigade]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [activeEmployees, search])

  const selectedEmployees = useMemo(
    () => activeEmployees.filter((e) => selected.has(e.id)),
    [activeEmployees, selected],
  )

  useEffect(() => {
    saveAttendanceLogSelection(selected)
  }, [selected])

  useEffect(() => {
    if (step !== 'preview') return
    document.body.classList.add('print-preview-open', 'print-attendance-log')

    const runFit = () => fitAttendanceLogPages(printRef.current)
    const raf = requestAnimationFrame(() => requestAnimationFrame(runFit))
    const ro =
      typeof ResizeObserver !== 'undefined' && printRef.current
        ? new ResizeObserver(runFit)
        : null
    ro?.observe(printRef.current!)

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      resetAttendanceLogFit(printRef.current)
      document.body.classList.remove('print-preview-open', 'print-attendance-log')
    }
  }, [step, selectedEmployees, mondayIso, locale])

  function toggle(id: string) {
    setSelectionError(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectDefault() {
    setSelected(new Set(defaultAttendanceEmployeeIds(employees)))
  }

  function selectAll() {
    setSelected(new Set(activeEmployees.map((e) => e.id)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  function shiftWeek(delta: number) {
    setMondayIso(addDaysIso(mondayIso, delta * 7))
  }

  function openPreview() {
    if (selected.size === 0) {
      setSelectionError(true)
      return
    }
    setSelectionError(false)
    setStep('preview')
  }

  function handlePrint() {
    fitAttendanceLogPages(printRef.current)
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      fitAttendanceLogPages(printRef.current)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await exportPrintAreaToPdf(printRef.current, `attendance_${mondayIso}.pdf`, {
        pageSelector: '.print-attendance-log-page',
        orientation: 'landscape',
      })
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <PrintModalShell open onClose={onClose} zIndex={100}>
      <div className="flex min-h-0 flex-1 flex-col bg-stone-100">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-300 bg-white px-4 py-3 print:hidden">
          <div>
            <h2 className="text-lg font-bold text-ink">{t('hr.attendanceLog.title')}</h2>
            <p className="text-sm text-stone-500">{t('hr.attendanceLog.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 'preview' ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setStep('setup')}>
                  {t('hr.attendanceLog.back')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handlePrint}>
                  {t('common.print')}
                </Button>
                <Button variant="primary" size="sm" disabled={pdfBusy} onClick={() => void handlePdf()}>
                  {pdfBusy ? <Spinner size={14} label="PDF…" /> : 'PDF'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" size="sm" onClick={onClose}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" size="sm" onClick={openPreview}>
                  {t('hr.attendanceLog.preview')}
                </Button>
              </>
            )}
          </div>
        </div>

        {step === 'setup' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 print:hidden">
            {selectionError ? (
              <p className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('hr.attendanceLog.emptySelection')}
              </p>
            ) : null}
            <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <p className="mb-3 text-sm font-semibold text-ink">{t('hr.attendanceLog.week')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => shiftWeek(-1)}>
                  ←
                </Button>
                <Input
                  type="date"
                  value={mondayIso}
                  onChange={(e) => setMondayIso(mondayOfWeekIso(e.target.value))}
                  className="w-auto"
                />
                <Button variant="secondary" size="sm" type="button" onClick={() => shiftWeek(1)}>
                  →
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => setMondayIso(mondayOfWeekIso())}>
                  {t('hr.attendanceLog.thisWeek')}
                </Button>
                <span className="text-sm text-stone-600">{formatWeekRange(mondayIso, locale)}</span>
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col rounded-sm border border-grid bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink">{t('hr.attendanceLog.selectEmployees')}</p>
                  <p className="text-xs text-stone-500">
                    {tf('hr.attendanceLog.selectedCount', { n: selected.size })}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button variant="secondary" size="xs" type="button" onClick={selectDefault}>
                    {t('hr.attendanceLog.defaultList')}
                  </Button>
                  <Button variant="ghost" size="xs" type="button" onClick={selectAll}>
                    {t('hr.attendanceLog.selectAll')}
                  </Button>
                  <Button variant="ghost" size="xs" type="button" onClick={selectNone}>
                    {t('hr.attendanceLog.selectNone')}
                  </Button>
                </div>
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('hr.attendanceLog.search')}
                className="mb-3"
              />
              <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-grid">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-stone-50 text-left text-xs uppercase text-stone-500">
                    <tr>
                      <th className="w-10 px-2 py-2" />
                      <th className="px-2 py-2">{t('hr.attendanceLog.colName')}</th>
                      <th className="px-2 py-2">{t('hr.attendanceLog.colTab')}</th>
                      <th className="px-2 py-2">{t('hr.attendanceLog.colSchedule')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp) => {
                      const nameLines = formatEmployeeAttendanceNameLines(emp)
                      return (
                      <tr key={emp.id} className="border-t border-grid hover:bg-stone-50/80">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-stone-300 text-accent focus:ring-accent"
                            checked={selected.has(emp.id)}
                            onChange={() => toggle(emp.id)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="leading-snug">
                            <div>{nameLines.ru}</div>
                            {nameLines.ka ? (
                              <div className="text-xs text-stone-500">{nameLines.ka}</div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs">{emp.tabNumber || '—'}</td>
                        <td className="px-2 py-1.5 text-xs">{scheduleShortLabel(emp.schedule)}</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-500">{t('hr.attendanceLog.hint')}</p>
              <p className="mt-1 text-xs text-stone-400">{t('hr.attendanceLog.selectionSaved')}</p>
            </section>
          </div>
        ) : (
          <div className="print-modal-body min-h-0 flex-1">
            <div ref={printRef} id="print-area" className="print-area">
              <AttendanceLogPrintSheet
                employees={selectedEmployees}
                mondayIso={mondayIso}
                site={site}
                responsible={responsible}
                locale={locale}
              />
            </div>
          </div>
        )}
      </div>
    </PrintModalShell>
  )
}

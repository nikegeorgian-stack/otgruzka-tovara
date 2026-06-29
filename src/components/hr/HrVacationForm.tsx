import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { newId } from '@/lib/hr/files'
import { hrAbsenceLabel } from '@/lib/hr/labels'
import { segmentsForDateRange } from '@/lib/hr/timesheetRange'
import type { DayCode, Employee, HrAbsence, HrAbsenceType } from '@/lib/types'

type Props = {
  employees: Employee[]
  existingMonthKeys: string[]
  onSaveEmployee: (e: Employee) => void
  onSetEmployeeFactRange: (
    month: string,
    employeeId: string,
    fromDay: number,
    toDay: number,
    code: DayCode,
  ) => void
}

const TYPE_TO_CODE: Partial<Record<HrAbsenceType, DayCode>> = {
  vacation: 'ОТ',
  sick: 'Б',
}

export function HrVacationForm({
  employees,
  onSaveEmployee,
  onSetEmployeeFactRange,
}: Props) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState<HrAbsenceType>('vacation')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const active = employees
    .filter((e) => (e.hrStatus ?? 'active') !== 'fired')
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  function apply() {
    setError(null)
    if (!employeeId) {
      setError(t('hr.vacation.pickEmployee'))
      return
    }
    const segments = segmentsForDateRange(from, to)
    if (segments.length === 0) {
      setError(t('hr.vacation.badDates'))
      return
    }
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return

    // HR-запись об отсутствии.
    const absence: HrAbsence = {
      id: newId(),
      type,
      startDate: from,
      endDate: to,
    }
    onSaveEmployee({ ...emp, hrAbsences: [...(emp.hrAbsences ?? []), absence] })

    // Простановка факта в табеле (после upsert — переживёт ресинк через factOverrides).
    const code = TYPE_TO_CODE[type] ?? 'ОТ'
    for (const seg of segments) {
      onSetEmployeeFactRange(seg.monthKey, employeeId, seg.fromDay, seg.toDay, code)
    }

    setNotice(t('hr.vacation.done'))
    setEmployeeId('')
    setFrom('')
    setTo('')
    setType('vacation')
    setOpen(false)
  }

  return (
    <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('hr.vacation.title')}</h3>
          <p className="mt-0.5 text-xs text-stone-500">{t('hr.vacation.hint')}</p>
        </div>
        <button
          type="button"
          className="btn-add-outline px-3 py-1.5 text-sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? '−' : '+'} {t('hr.vacation.title')}
        </button>
      </div>

      {notice && (
        <div className="mt-3 rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {notice}
          <button className="ml-2 text-xs underline" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          {error && (
            <p className="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-medium text-stone-500">
              {t('hr.vacation.employee')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">— {t('hr.vacation.pickEmployee')} —</option>
                {active.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} (№ {e.tabNumber})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-stone-500">
              {t('hr.vacation.type')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as HrAbsenceType)}
              >
                {(['vacation', 'sick', 'business_trip', 'absence'] as HrAbsenceType[]).map((tp) => (
                  <option key={tp} value={tp}>
                    {hrAbsenceLabel(tp, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-stone-500">
              {t('hr.vacation.from')}
              <input
                type="date"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-stone-500">
              {t('hr.vacation.to')}
              <input
                type="date"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </div>
          <button type="button" className="btn-add" onClick={apply}>
            {t('hr.vacation.apply')}
          </button>
        </div>
      )}
    </div>
  )
}

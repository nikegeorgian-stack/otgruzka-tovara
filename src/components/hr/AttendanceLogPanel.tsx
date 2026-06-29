import { useState } from 'react'
import { AttendanceLogPrintModal } from '@/components/hr/AttendanceLogPrintModal'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { defaultAttendanceEmployeeIds } from '@/lib/hr/attendanceLog'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  site: string
  responsible?: string
}

export function AttendanceLogPanel({ employees, site, responsible }: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState(false)
  const defaultCount = defaultAttendanceEmployeeIds(employees).length

  return (
    <>
      <section className="rounded-sm border border-sky-200 bg-sky-50 p-5 shadow-sm">
        <h3 className="text-base font-bold text-ink">{t('hr.attendanceLog.title')}</h3>
        <p className="mt-1 text-sm text-stone-600">{t('hr.attendanceLog.panelHint')}</p>
        <p className="mt-2 text-xs text-stone-500">
          {tf('hr.attendanceLog.defaultCount', { n: defaultCount })}
        </p>
        <Button variant="primary" size="sm" className="mt-4" onClick={() => setOpen(true)}>
          {t('hr.attendanceLog.open')}
        </Button>
      </section>

      {open && (
        <AttendanceLogPrintModal
          employees={employees}
          site={site}
          responsible={responsible}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

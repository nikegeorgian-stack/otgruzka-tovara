import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { CODE_DEFS } from '@/lib/codes'
import {
  ABSENCE_CODES,
  SUBSTITUTE_WORK_CODES,
  defaultSubstituteCode,
  findRowByEmployeeId,
  getSubstitution,
} from '@/lib/substitutions'
import type { DayCode, DaySubstitution, Employee, MonthSheet } from '@/lib/types'

type Props = {
  sheet: MonthSheet
  employees: Employee[]
  rowId: string
  dateKey: string
  onSave: (sub: DaySubstitution) => void
  onClear: () => void
  onClose: () => void
}

export function SubstitutionModal({
  sheet,
  employees,
  rowId,
  dateKey,
  onSave,
  onClear,
  onClose,
}: Props) {
  const { t, employeeName } = useI18n()
  const row = sheet.rows.find((r) => r.id === rowId)
  const absentEmp = row?.employeeId
    ? employees.find((e) => e.id === row.employeeId)
    : undefined

  const existing = getSubstitution(sheet, rowId, dateKey)

  const [absentCode, setAbsentCode] = useState<DayCode>(existing?.absentCode ?? 'Б')
  const [substituteEmployeeId, setSubstituteEmployeeId] = useState(
    existing?.substituteEmployeeId ?? '',
  )
  const [substituteCode, setSubstituteCode] = useState<DayCode>(
    existing?.substituteCode ?? '8',
  )
  const [note, setNote] = useState(existing?.note ?? '')

  const brigade = row?.brigade ?? ''

  const substituteOptions = useMemo(() => {
    const active = employees.filter(
      (e) => e.active && (e.hrStatus ?? 'active') !== 'fired' && e.id !== row?.employeeId,
    )
    const same = active.filter((e) => e.brigade === brigade)
    const other = active.filter((e) => e.brigade !== brigade)
    return [...same, ...other]
  }, [employees, brigade, row?.employeeId])

  function handleSubstituteChange(empId: string | null) {
    if (!empId) {
      setSubstituteEmployeeId('')
      return
    }
    setSubstituteEmployeeId(empId)
    const subRowId = findRowByEmployeeId(sheet, empId)
    if (subRowId) {
      setSubstituteCode(defaultSubstituteCode(sheet, subRowId, dateKey))
    }
  }

  function handleSave() {
    if (!substituteEmployeeId) return
    onSave({
      absentCode,
      substituteEmployeeId,
      substituteCode,
      note: note.trim() || undefined,
    })
    onClose()
  }

  const absenceDefs = CODE_DEFS.filter((c) => ABSENCE_CODES.includes(c.code))
  const workDefs = CODE_DEFS.filter((c) => SUBSTITUTE_WORK_CODES.includes(c.code))

  const subtitle = absentEmp
    ? `${dateKey} · ${t('substitution.absent')}: ${employeeName(absentEmp)}`
    : dateKey

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('substitution.title')}
      subtitle={subtitle}
      size="md"
      zIndex={110}
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          {existing && (
            <Button
              variant="danger"
              size="sm"
              className="mr-auto"
              onClick={() => {
                onClear()
                onClose()
              }}
            >
              {t('substitution.clear')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!substituteEmployeeId}
            onClick={handleSave}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <FormField label={t('substitution.absentCode')}>
          <select
            className="fc-input"
            value={absentCode}
            onChange={(e) => setAbsentCode(e.target.value as DayCode)}
          >
            {absenceDefs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={t('substitution.substitute')}>
          <EmployeePicker
            employees={substituteOptions}
            value={substituteEmployeeId || null}
            brigade={brigade}
            excludeId={row?.employeeId ?? undefined}
            placeholder={t('substitution.pickSubstitute')}
            onChange={handleSubstituteChange}
          />
        </FormField>

        <FormField label={t('substitution.substituteCode')}>
          <select
            className="fc-input font-mono"
            value={substituteCode}
            onChange={(e) => setSubstituteCode(e.target.value as DayCode)}
          >
            {workDefs.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={t('substitution.note')}>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('substitution.notePlaceholder')}
          />
        </FormField>
      </div>
    </AppDialog>
  )
}

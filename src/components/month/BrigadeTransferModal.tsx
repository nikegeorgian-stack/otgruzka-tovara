import { useMemo, useState, useEffect } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useI18n } from '@/context/I18nContext'
import { dayDateKey, daysInMonth, parseMonthKey } from '@/lib/dates'
import { SCHEDULE_OPTIONS, SHIFT_HOURS_OPTIONS_22, SHIFT_HOURS_OPTIONS_52, is52Schedule, is22Schedule, usesGroup2x2, usesShiftMode } from '@/lib/schedules'
import type { AppStore, Group2x2, ScheduleType, ShiftMode } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  open: boolean
  onClose: () => void
  onTransfer: (
    employeeId: string,
    toBrigade: string,
    fromDateKey: string,
    opts: {
      schedule: ScheduleType
      shiftHours?: number
      group2x2?: Group2x2
      shiftMode?: ShiftMode
    },
  ) => boolean
  initialEmployeeId?: string | null
  initialToBrigade?: string
}

export function BrigadeTransferModal({
  store,
  month,
  open,
  onClose,
  onTransfer,
  initialEmployeeId = null,
  initialToBrigade,
}: Props) {
  const { t, tf } = useI18n()
  const { year, month: mo } = parseMonthKey(month)
  const maxDay = daysInMonth(year, mo)
  const defaultDay = (() => {
    const now = new Date()
    if (now.getFullYear() === year && now.getMonth() + 1 === mo) {
      return Math.min(Math.max(now.getDate(), 1), maxDay)
    }
    return Math.min(15, maxDay)
  })()
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [toBrigade, setToBrigade] = useState(
    (Array.isArray(store.brigades) ? store.brigades[0] : undefined) ?? '',
  )
  const [day, setDay] = useState(defaultDay)
  const [schedule, setSchedule] = useState<ScheduleType>('5/2 8ч')
  const [shiftHours, setShiftHours] = useState<number | ''>('')
  const [group2x2, setGroup2x2] = useState<Group2x2>('')
  const [shiftMode, setShiftMode] = useState<ShiftMode>('day')
  const [error, setError] = useState<string | null>(null)

  const emp = useMemo(
    () => store.employees.find((e) => e.id === employeeId) ?? null,
    [store.employees, employeeId],
  )

  function onPickEmployee(id: string | null) {
    setEmployeeId(id)
    setError(null)
    const e = store.employees.find((x) => x.id === id)
    if (e) {
      setSchedule(e.schedule)
      setShiftHours(e.shiftHours ?? '')
      setGroup2x2(e.group2x2 ?? '')
      setShiftMode(e.shiftMode ?? 'day')
      if (e.brigade && store.brigades.includes(e.brigade)) {
        const other = store.brigades.find((b) => b !== e.brigade)
        if (other && !initialToBrigade) setToBrigade(other)
      }
    }
  }

  useEffect(() => {
    if (!open) return
    if (initialEmployeeId) onPickEmployee(initialEmployeeId)
    else setEmployeeId(null)
    if (initialToBrigade && store.brigades.includes(initialToBrigade)) {
      setToBrigade(initialToBrigade)
    }
    setError(null)
  }, [open, initialEmployeeId, initialToBrigade, store.brigades])

  function submit() {
    if (!employeeId || !toBrigade) {
      setError(t('transfer.err.pick'))
      return
    }
    const fromDateKey = dayDateKey(year, mo, day)
    const ok = onTransfer(employeeId, toBrigade, fromDateKey, {
      schedule,
      shiftHours: shiftHours === '' ? undefined : Number(shiftHours),
      group2x2: usesGroup2x2(schedule) ? group2x2 : '',
      shiftMode: usesShiftMode(schedule) ? shiftMode : undefined,
    })
    if (!ok) {
      setError(t('transfer.err.failed'))
      return
    }
    onClose()
  }

  const hourOpts = is52Schedule(schedule)
    ? SHIFT_HOURS_OPTIONS_52
    : is22Schedule(schedule)
      ? SHIFT_HOURS_OPTIONS_22
      : null

  return (
    <AppDialog
      open={open}
      title={t('transfer.title')}
      onClose={onClose}
      size="md"
      ephemeral
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit}>{t('transfer.submit')}</Button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-stone-600">{t('transfer.hint')}</p>
      <div className="flex flex-col gap-3">
        <label className="block text-sm">
          <span className="text-xs font-semibold text-stone-600">{t('transfer.employee')}</span>
          <div className="mt-1">
            <EmployeePicker
              employees={store.employees}
              value={employeeId}
              month={month}
              onChange={onPickEmployee}
            />
          </div>
        </label>
        {emp && (
          <p className="text-xs text-stone-500">
            {tf('transfer.current', {
              brigade: emp.brigade || '—',
              schedule: emp.schedule,
            })}
          </p>
        )}
        <label className="block text-sm">
          <span className="text-xs font-semibold text-stone-600">{t('transfer.toBrigade')}</span>
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
            value={toBrigade}
            onChange={(e) => setToBrigade(e.target.value)}
          >
            {store.brigades.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-stone-600">{t('transfer.fromDay')}</span>
          <input
            type="number"
            min={1}
            max={maxDay}
            className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
            value={day}
            onChange={(e) => setDay(Math.max(1, Math.min(maxDay, Number(e.target.value) || 1)))}
          />
          <p className="mt-1 text-[11px] text-stone-500">{t('transfer.fromDayHint')}</p>
          {day === 1 ? (
            <p className="mt-1 text-[11px] text-amber-800">{t('transfer.fromDay1Warn')}</p>
          ) : null}
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold text-stone-600">{t('transfer.schedule')}</span>
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as ScheduleType)}
          >
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {hourOpts && (
          <label className="block text-sm">
            <span className="text-xs font-semibold text-stone-600">{t('transfer.shiftHours')}</span>
            <select
              className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
              value={shiftHours === '' ? '' : String(shiftHours)}
              onChange={(e) =>
                setShiftHours(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">{t('transfer.shiftHoursDefault')}</option>
              {hourOpts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
        )}
        {usesGroup2x2(schedule) && (
          <label className="block text-sm">
            <span className="text-xs font-semibold text-stone-600">{t('transfer.group2x2')}</span>
            <select
              className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
              value={group2x2}
              onChange={(e) => setGroup2x2(e.target.value as Group2x2)}
            >
              <option value="">{t('transfer.groupNone')}</option>
              <option value="А">А</option>
              <option value="Б">Б</option>
            </select>
          </label>
        )}
        {usesShiftMode(schedule) && (
          <label className="block text-sm">
            <span className="text-xs font-semibold text-stone-600">{t('transfer.shiftMode')}</span>
            <select
              className="mt-1 w-full rounded-sm border border-grid bg-white px-2 py-1.5 text-sm"
              value={shiftMode}
              onChange={(e) => setShiftMode(e.target.value as ShiftMode)}
            >
              <option value="day">{t('transfer.shiftDay')}</option>
              <option value="night">{t('transfer.shiftNight')}</option>
            </select>
          </label>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    </AppDialog>
  )
}

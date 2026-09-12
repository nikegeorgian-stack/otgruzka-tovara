import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { CELL_CODE_STYLES } from '@/components/month/DayCell'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { brigadeAllowsBrigadier } from '@/lib/brigadeHasBrigadier'
import { brigadeLabel } from '@/lib/brigadeText'
import { dayDateKey, daysInMonth, parseMonthKey } from '@/lib/dates'
import { getDayTransfer, isTransferredIn, isTransferredOut } from '@/lib/dayTransfer'
import { factWorkedHours, getFactHoursOverride, isWorkCode } from '@/lib/factExtra'
import { getFactMark } from '@/lib/stats'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import { rollCallPersonVisible } from '@/lib/rollCallVisible'
import type { AppStore, DayCode } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  /** Бригады по умолчанию (фильтр при открытии) */
  defaultBrigades?: string[]
  /** Жёсткая область ACL — без кнопки «Все бригады». */
  lockBrigadeScope?: boolean
  /** Только просмотр (роль view). */
  readOnly?: boolean
  onClose: () => void
  onSetFact: (rowId: string, dateKey: string, code: DayCode) => void
  onSetFactHours: (rowId: string, dateKey: string, hours: number | null) => void
  onAddDayWorker: (
    brigade: string,
    employeeId: string,
    dateKey: string,
    code: DayCode,
  ) => boolean
  onAssignPermanent: (employeeId: string, brigade: string) => boolean
  /** Перевод с даты переклички (с выбором графика). */
  onTransferFromDate?: (
    employeeId: string,
    toBrigade: string,
    fromDateKey: string,
    opts: {
      schedule: import('@/lib/types').ScheduleType
      shiftHours?: number
      group2x2?: import('@/lib/types').Group2x2
      shiftMode?: import('@/lib/types').ShiftMode
    },
  ) => boolean
  onClearDayTransfer?: (employeeId: string, dateKey: string) => boolean
  onOpenNightShift?: (day: number) => void
  /** Постоянный бригадир бригады (store.brigadiers). */
  onSetBrigadier?: (brigade: string, employeeId: string | null) => void
  onMarkBrigadier?: (rowId: string, dateKey: string, on: boolean) => void
  /** Заместитель с этого дня до конца месяца. */
  onMarkBrigadierFromDay?: (rowId: string, dateKey: string, on: boolean) => void
}

/** Коды для быстрой отметки отсутствия в перекличке. */
const ABSENCE_CODES: DayCode[] = ['В', 'Б', 'ОТ', 'ПР', 'X']

/** Наиболее частый рабочий код бригады в этот день (для добавления человека «как у бригады»). */
function brigadeDayCode(
  store: AppStore,
  month: string,
  brigade: string,
  dateKey: string,
): DayCode {
  const sheet = store.months[month]
  if (!sheet) return '11'
  const freq = new Map<DayCode, number>()
  for (const r of sheet.rows) {
    if (r.brigade !== brigade || !r.employeeId) continue
    const f = getFactMark(sheet, r.id, dateKey)
    if (isWorkCode(f)) freq.set(f, (freq.get(f) ?? 0) + 1)
  }
  let best: DayCode = '11'
  let bestN = 0
  for (const [code, n] of freq) {
    if (n > bestN) {
      best = code
      bestN = n
    }
  }
  return best
}

export function DayRollCallModal({
  store,
  month,
  defaultBrigades = [],
  lockBrigadeScope = false,
  readOnly = false,
  onClose,
  onSetFact,
  onSetFactHours,
  onAddDayWorker,
  onAssignPermanent,
  onTransferFromDate,
  onClearDayTransfer,
  onOpenNightShift,
  onSetBrigadier,
  onMarkBrigadier,
  onMarkBrigadierFromDay,
}: Props) {
  const { t, tf, employeeName, employeeNameLines, locale } = useI18n()
  const { confirm } = useConfirm()
  const { year, month: mo } = parseMonthKey(month)
  const totalDays = daysInMonth(year, mo)
  const primarySet = useMemo(() => new Set(defaultBrigades), [defaultBrigades])

  const initialDay = useMemo(() => {
    const now = new Date()
    if (now.getFullYear() === year && now.getMonth() + 1 === mo) return now.getDate()
    return 1
  }, [year, mo])

  const [day, setDay] = useState(Math.min(initialDay, totalDays))
  const [showOff, setShowOff] = useState(false)
  const [addPicker, setAddPicker] = useState<{ brigade: string; empId: string | null } | null>(
    null,
  )
  const [addError, setAddError] = useState<string | null>(null)
  const [visibleBrigades, setVisibleBrigades] = useState<Set<string>>(() =>
    primarySet.size > 0 ? new Set(primarySet) : new Set(store.brigades),
  )

  // «Заполнить день» / перекличка по бригаде — подтянуть фильтр при каждом открытии
  useEffect(() => {
    setVisibleBrigades(
      primarySet.size > 0 ? new Set(primarySet) : new Set(store.brigades),
    )
  }, [primarySet, store.brigades])

  const poolBrigades = useMemo(() => {
    if (lockBrigadeScope && primarySet.size > 0) {
      return store.brigades.filter((b) => primarySet.has(b))
    }
    return store.brigades
  }, [lockBrigadeScope, primarySet, store.brigades])

  const dateKey = dayDateKey(year, mo, day)
  const sheet = store.months[month]

  const brigadesToShow = useMemo(() => {
    return poolBrigades.filter((b) => visibleBrigades.has(b))
  }, [poolBrigades, visibleBrigades])

  const groups = useMemo(() => {
    if (!sheet) return []
    return brigadesToShow
      .map((brigade) => {
        const allowsBrigadier = brigadeAllowsBrigadier(store, brigade)
        const brigadierId = allowsBrigadier ? store.brigadiers?.[brigade] : undefined
        const brigadeRows = sheet.rows.filter((r) => r.brigade === brigade && r.employeeId)
        const markedRowId = allowsBrigadier
          ? (brigadeRows.find((r) => sheet.brigadierDays?.[`${r.id}|${dateKey}`])?.id ?? null)
          : null
        const designatedRowId = brigadierId
          ? brigadeRows.find((r) => r.employeeId === brigadierId)?.id
          : undefined
        // Назначенный без собственных отметок оплачивается по плану (все рабочие дни),
        // поэтому отмечать его день не нужно — иначе месяц схлопнется до одной даты.
        const designatedHasOwnMarks = designatedRowId
          ? Object.entries(sheet.brigadierDays ?? {}).some(
              ([key, on]) => on && key.startsWith(`${designatedRowId}|`),
            )
          : false
        const rows = brigadeRows
          .map((r) => {
            const emp = store.employees.find((e) => e.id === r.employeeId)
            if (!emp) return null
            const planCode = (sheet.plan[r.id]?.[dateKey] ?? '') as DayCode
            const factCode = getFactMark(sheet, r.id, dateKey)
            const transfer = emp ? getDayTransfer(sheet, emp.id, dateKey) : undefined
            const isBrigadierDay = markedRowId === r.id
            const isDesignatedBrigadier = allowsBrigadier && brigadierId === r.employeeId
            return {
              rowId: r.id,
              emp,
              planCode,
              factCode,
              worked: factWorkedHours(sheet, r.id, dateKey, factCode),
              hasOverride: getFactHoursOverride(sheet, r.id, dateKey) != null,
              isBrigadierDay,
              isDesignatedBrigadier,
              /** Бригадир именно этого дня: отметка дня, иначе постоянный по плану. */
              isDayBrigadier:
                isBrigadierDay ||
                (isDesignatedBrigadier && !designatedHasOwnMarks && !markedRowId),
              /** Постоянный бригадир по плану — день отмечать не нужно. */
              brigadierByPlan: isDesignatedBrigadier && !designatedHasOwnMarks,
              transferredOut: isTransferredOut(sheet, r.id, dateKey),
              transferredIn: isTransferredIn(sheet, r.id, dateKey),
              transferTo: transfer?.toBrigade,
            }
          })
          .filter((x): x is NonNullable<typeof x> => !!x)
          .filter((x) =>
            rollCallPersonVisible({
              showOff,
              planCode: x.planCode,
              factCode: x.factCode,
              isDesignatedBrigadier: x.isDesignatedBrigadier,
              isBrigadierDay: x.isBrigadierDay,
            }),
          )
          .sort((a, b) =>
            employeeNameLines(a.emp).primary.localeCompare(employeeNameLines(b.emp).primary, 'ru'),
          )
        return { brigade, rows }
      })
      .filter((g) => g.rows.length || addPicker?.brigade === g.brigade)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sheet,
    brigadesToShow,
    store.employees,
    store.brigadiers,
    store.brigadeHasBrigadier,
    dateKey,
    showOff,
    addPicker,
  ])

  const counts = useMemo(() => {
    let onShift = 0
    let off = 0
    let changed = 0
    for (const g of groups) {
      for (const r of g.rows) {
        if (isWorkCode(r.factCode)) onShift++
        else off++
        if (r.factCode !== r.planCode) changed++
      }
    }
    return { onShift, off, changed }
  }, [groups])

  const dateLabel = `${String(day).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${year}`
  const allBrigadesOn = visibleBrigades.size >= (Array.isArray(store.brigades) ? store.brigades.length : 0)
  const primaryOnlyOn =
    primarySet.size > 0 &&
    visibleBrigades.size === primarySet.size &&
    [...primarySet].every((b) => visibleBrigades.has(b))

  const todayDay = useMemo(() => {
    const now = new Date()
    if (now.getFullYear() === year && now.getMonth() + 1 === mo) return now.getDate()
    return null
  }, [year, mo])

  function applyAllPlanVisible() {
    for (const g of groups) {
      for (const r of g.rows) {
        if (r.factCode !== r.planCode) onSetFact(r.rowId, dateKey, r.planCode)
      }
    }
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('rollcall.title')}
      subtitle={t('rollcall.hint')}
      size="xl"
    >
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 sm:py-4">
        {/* Панель дня — всегда на виду */}
        <div className="sticky top-0 z-10 -mx-1 space-y-2 rounded-sm border border-grid bg-white/95 p-2 shadow-sm backdrop-blur sm:p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="rounded-sm border border-grid px-2.5 py-1.5 text-sm hover:bg-paper-dark disabled:opacity-40"
                onClick={() => setDay((d) => Math.max(1, d - 1))}
                disabled={day <= 1}
                aria-label="prev"
              >
                ‹
              </button>
              <input
                type="number"
                min={1}
                max={totalDays}
                value={day}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setDay(Math.min(totalDays, Math.max(1, v)))
                }}
                className="w-14 rounded-sm border border-grid px-2 py-1.5 text-center text-sm font-mono"
              />
              <button
                type="button"
                className="rounded-sm border border-grid px-2.5 py-1.5 text-sm hover:bg-paper-dark disabled:opacity-40"
                onClick={() => setDay((d) => Math.min(totalDays, d + 1))}
                disabled={day >= totalDays}
                aria-label="next"
              >
                ›
              </button>
              <span className="ml-1 text-sm font-semibold text-ink">{dateLabel}</span>
              {todayDay != null && day !== todayDay ? (
                <button
                  type="button"
                  className="rounded-sm border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-900 hover:bg-sky-100"
                  onClick={() => setDay(todayDay)}
                >
                  {t('rollcall.today')}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1.5 text-stone-600">
                <input
                  type="checkbox"
                  checked={showOff}
                  onChange={(e) => setShowOff(e.target.checked)}
                />
                {t('rollcall.showOff')}
              </label>
              <span className="rounded-sm bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                {t('rollcall.onShift')}: {counts.onShift}
              </span>
              <span className="rounded-sm bg-stone-100 px-2 py-1 font-medium text-stone-600">
                {t('rollcall.offShift')}: {counts.off}
              </span>
              {counts.changed > 0 ? (
                <span className="rounded-sm bg-amber-50 px-2 py-1 font-medium text-amber-900">
                  {tf('rollcall.changedCount', { n: counts.changed })}
                </span>
              ) : (
                <span className="rounded-sm bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                  {t('rollcall.allMatchPlan')}
                </span>
              )}
            </div>
          </div>
          {!readOnly ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-emerald-400 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                title={t('rollcall.allPlanAllHint')}
                onClick={applyAllPlanVisible}
              >
                {t('rollcall.allPlanAll')}
              </button>
              {onOpenNightShift ? (
                <button
                  type="button"
                  className="rounded-sm border border-violet-400 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-950 hover:bg-violet-100"
                  title={t('nightShift.hint')}
                  onClick={() => onOpenNightShift(day)}
                >
                  {t('nightShift.open')}
                </button>
              ) : null}
              <span className="self-center text-[11px] text-stone-400">{t('rollcall.workflowHint')}</span>
            </div>
          ) : null}
          {addError ? <p className="text-xs text-red-700">{addError}</p> : null}
        </div>

        {primarySet.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-stone-500">{t('rollcall.brigadesFilter')}:</span>
            <button
              type="button"
              className="rounded-sm border border-accent/40 bg-accent/5 px-2 py-1 font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
              disabled={primaryOnlyOn}
              onClick={() => setVisibleBrigades(new Set(primarySet))}
            >
              {t('month.masterBrigadesOnly')}
            </button>
            {!lockBrigadeScope ? (
              <button
                type="button"
                className="rounded-sm border border-grid px-2 py-1 font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
                disabled={allBrigadesOn}
                onClick={() => setVisibleBrigades(new Set(store.brigades))}
              >
                {t('month.masterBrigadesAll')}
              </button>
            ) : null}
          </div>
        ) : null}

        {readOnly ? (
          <p className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {t('month.viewOnlyAcl')}
          </p>
        ) : null}

        <div
          className={`max-h-[min(62vh,36rem)] space-y-3 overflow-y-auto pr-1 ${
            readOnly ? 'pointer-events-none opacity-70' : ''
          }`}
        >
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-stone-400">{t('rollcall.noAssigned')}</p>
          )}
          {groups.map((g) => {
            const allowsBrigadier = brigadeAllowsBrigadier(store, g.brigade)
            const brigadierId = store.brigadiers?.[g.brigade] ?? ''
            const brigadierCandidates = (() => {
              const ids = new Set<string>()
              for (const r of g.rows) ids.add(r.emp.id)
              for (const e of store.employees) {
                if (employeeActiveInMonth(e, month) && e.brigade === g.brigade) ids.add(e.id)
              }
              if (brigadierId) ids.add(brigadierId)
              return store.employees
                .filter((e) => ids.has(e.id))
                .sort((a, b) => employeeName(a).localeCompare(employeeName(b), 'ru'))
            })()
            const candidates = store.employees.filter(
              (e) =>
                employeeActiveInMonth(e, month) &&
                !sheet?.rows.some((r) => r.brigade === g.brigade && r.employeeId === e.id),
            )
            const pickerOpen = addPicker?.brigade === g.brigade
            const brigadeChanged = g.rows.filter((r) => r.factCode !== r.planCode).length
            return (
              <div key={g.brigade} className="overflow-hidden rounded-sm border border-grid">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid bg-stone-50 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-ink">
                      {brigadeLabel(g.brigade, store.brigadeNamesKa, locale)}
                      {primarySet.has(g.brigade) ? (
                        <span className="ml-1 text-[10px] font-normal text-accent">★</span>
                      ) : null}
                    </span>
                    <span className="ml-2 text-[11px] text-stone-500">
                      {g.rows.length} ·{' '}
                      {brigadeChanged > 0
                        ? tf('rollcall.changedCount', { n: brigadeChanged })
                        : t('rollcall.allMatchPlan')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {onSetBrigadier && allowsBrigadier ? (
                      <label className="flex items-center gap-1 text-[11px] font-medium text-stone-600">
                        <span>{t('table.brigadier')}:</span>
                        <select
                          value={brigadierId}
                          className="max-w-[12rem] rounded-sm border border-grid bg-white px-1.5 py-1 text-[11px] text-ink"
                          title={t('rollcall.setBrigadierHint')}
                          onChange={(e) => {
                            const id = e.target.value || null
                            onSetBrigadier(g.brigade, id)
                            if (id && !g.rows.some((r) => r.emp.id === id)) {
                              onAddDayWorker(
                                g.brigade,
                                id,
                                dateKey,
                                brigadeDayCode(store, month, g.brigade, dateKey),
                              )
                            }
                          }}
                        >
                          <option value="">{t('table.brigadierNone')}</option>
                          {brigadierCandidates.map((e) => (
                            <option key={e.id} value={e.id}>
                              {employeeName(e)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                      onClick={() =>
                        setAddPicker(pickerOpen ? null : { brigade: g.brigade, empId: null })
                      }
                    >
                      {pickerOpen ? t('common.cancel') : `+ ${t('rollcall.addWorker')}`}
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-700 hover:bg-paper-dark"
                      title={t('rollcall.allPlanHint')}
                      onClick={() => {
                        for (const r of g.rows) {
                          if (r.factCode !== r.planCode) onSetFact(r.rowId, dateKey, r.planCode)
                        }
                      }}
                    >
                      {t('rollcall.allPlan')}
                    </button>
                  </div>
                </div>

                {pickerOpen && (
                  <div className="flex flex-wrap items-end gap-2 border-b border-grid bg-emerald-50/50 px-3 py-2">
                    <div className="min-w-[14rem] flex-1">
                      <EmployeePicker
                        employees={candidates}
                        value={addPicker?.empId ?? null}
                        month={month}
                        placeholder={t('rollcall.pickWorker')}
                        compact
                        onChange={(id) => setAddPicker({ brigade: g.brigade, empId: id })}
                      />
                    </div>
                    <button
                      type="button"
                      className="rounded-sm border border-emerald-300 bg-white px-2 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"
                      disabled={!addPicker?.empId}
                      title={t('rollcall.addDayHint')}
                      onClick={() => {
                        if (!addPicker?.empId) return
                        const ok = onAddDayWorker(
                          g.brigade,
                          addPicker.empId,
                          dateKey,
                          brigadeDayCode(store, month, g.brigade, dateKey),
                        )
                        if (!ok) {
                          setAddError(t('rollcall.addFailed'))
                          return
                        }
                        setAddError(null)
                        setAddPicker(null)
                      }}
                    >
                      {t('rollcall.addDay')}
                    </button>
                    <button
                      type="button"
                      className="rounded-sm border border-grid px-2 py-1.5 text-xs font-medium hover:bg-paper-dark disabled:opacity-40"
                      disabled={!addPicker?.empId}
                      title={t('rollcall.addTransferHint')}
                      onClick={() => {
                        void (async () => {
                          if (!addPicker?.empId) return
                          const picked = store.employees.find((e) => e.id === addPicker.empId)
                          if (
                            !(await confirm({
                              message: tf('rollcall.transferConfirm', {
                                day: String(day),
                                brigade: g.brigade,
                              }),
                            }))
                          ) {
                            return
                          }
                          const ok = onTransferFromDate
                            ? onTransferFromDate(addPicker.empId, g.brigade, dateKey, {
                                schedule: picked?.schedule ?? '2/2 11ч',
                                shiftHours: picked?.shiftHours,
                                group2x2: picked?.group2x2,
                                shiftMode: picked?.shiftMode,
                              })
                            : onAssignPermanent(addPicker.empId, g.brigade)
                          if (!ok) {
                            setAddError(t('rollcall.addFailed'))
                            return
                          }
                          setAddError(null)
                          setAddPicker(null)
                        })()
                      }}
                    >
                      {t('rollcall.addTransfer')}
                    </button>
                  </div>
                )}

                <ul className="divide-y divide-grid">
                  {g.rows.map((r) => {
                    const changed = r.factCode !== r.planCode
                    const onShift = isWorkCode(r.factCode)
                    return (
                      <li
                        key={r.rowId}
                        className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${
                          changed ? 'bg-amber-50/40' : 'bg-white'
                        }`}
                      >
                        <span
                          className={`h-8 w-1 shrink-0 rounded-full ${
                            changed ? 'bg-amber-400' : onShift ? 'bg-emerald-400' : 'bg-stone-300'
                          }`}
                          aria-hidden
                        />
                        <div className="min-w-[9rem] flex-1">
                          <div className="truncate font-medium text-ink">
                            {employeeNameLines(r.emp).primary}
                            {r.isDayBrigadier ? (
                              <span
                                className="ml-1 text-[10px] text-amber-700"
                                title={
                                  r.isBrigadierDay
                                    ? t('brigadier.markDay')
                                    : t('table.brigadier')
                                }
                              >
                                ★
                              </span>
                            ) : null}
                            {r.transferredIn ? (
                              <span
                                className="ml-1 text-[10px] text-teal-700"
                                title={t('rollcall.transferredIn')}
                              >
                                ↪
                              </span>
                            ) : null}
                            {r.transferredOut ? (
                              <span
                                className="ml-1 text-[10px] text-stone-400"
                                title={tf('rollcall.transferredOut', {
                                  brigade: r.transferTo ?? '—',
                                })}
                              >
                                ↩
                              </span>
                            ) : null}
                            {r.transferredIn && onClearDayTransfer && !readOnly ? (
                              <button
                                type="button"
                                className="ml-1 rounded border border-teal-200 bg-teal-50 px-1 py-0.5 text-[10px] font-medium text-teal-900 hover:bg-teal-100"
                                title={t('rollcall.undoTransferHint')}
                                onClick={() => {
                                  if (!onClearDayTransfer(r.emp.id, dateKey)) {
                                    setAddError(t('rollcall.addFailed'))
                                  }
                                }}
                              >
                                {t('rollcall.undoTransfer')}
                              </button>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-stone-500">
                            <span
                              className={`rounded px-1 font-mono ${
                                CELL_CODE_STYLES[r.planCode] ?? CELL_CODE_STYLES['']
                              }`}
                            >
                              {t('rollcall.plan')} {r.planCode || '·'}
                            </span>
                            <span aria-hidden>→</span>
                            <span
                              className={`rounded px-1 font-mono font-semibold ${
                                CELL_CODE_STYLES[r.factCode] ?? CELL_CODE_STYLES['']
                              }`}
                            >
                              {t('rollcall.fact')} {r.factCode || '·'}
                            </span>
                          </div>
                        </div>

                        {onShift ? (
                          <div
                            className={`flex items-center gap-0.5 rounded-sm border px-1 py-0.5 ${
                              r.hasOverride
                                ? 'border-amber-300 bg-amber-50'
                                : 'border-grid bg-white'
                            }`}
                            title={t('rollcall.hoursHint')}
                          >
                            <button
                              type="button"
                              className="px-1.5 py-0.5 text-sm leading-none text-stone-600 hover:text-ink"
                              onClick={() =>
                                onSetFactHours(r.rowId, dateKey, Math.max(0, r.worked - 1))
                              }
                            >
                              −
                            </button>
                            <span className="w-10 text-center text-xs font-mono">
                              {r.worked}
                              {t('common.hoursShort')}
                            </span>
                            <button
                              type="button"
                              className="px-1.5 py-0.5 text-sm leading-none text-stone-600 hover:text-ink"
                              onClick={() =>
                                onSetFactHours(r.rowId, dateKey, Math.min(24, r.worked + 1))
                              }
                            >
                              +
                            </button>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-1">
                          {onMarkBrigadier && allowsBrigadier ? (
                            <>
                              <button
                                type="button"
                                disabled={r.brigadierByPlan}
                                className={`rounded-sm border px-2 py-1.5 text-xs font-semibold disabled:cursor-default disabled:opacity-70 ${
                                  r.isDayBrigadier
                                    ? 'border-amber-400 bg-amber-50 text-amber-900'
                                    : 'border-grid text-stone-500 hover:bg-paper-dark'
                                }`}
                                title={
                                  r.brigadierByPlan
                                    ? t('rollcall.brigadierByPlanHint')
                                    : r.isBrigadierDay
                                      ? t('brigadier.unmarkDay')
                                      : t('rollcall.brigadierDayHint')
                                }
                                onClick={() =>
                                  onMarkBrigadier(r.rowId, dateKey, !r.isBrigadierDay)
                                }
                              >
                                Бр
                              </button>
                              {onMarkBrigadierFromDay ? (
                                <button
                                  type="button"
                                  disabled={r.brigadierByPlan}
                                  className="rounded-sm border border-amber-200 bg-amber-50/80 px-1.5 py-1.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-default disabled:opacity-50"
                                  title={
                                    r.brigadierByPlan
                                      ? t('rollcall.brigadierByPlanHint')
                                      : t('brigadier.markFromDay')
                                  }
                                  onClick={() => onMarkBrigadierFromDay(r.rowId, dateKey, true)}
                                >
                                  {t('brigadier.fromDayShort')}
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          <button
                            type="button"
                            className={`rounded-sm border px-2.5 py-1.5 text-xs font-semibold ${
                              !changed
                                ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                                : 'border-grid hover:bg-paper-dark'
                            }`}
                            title={t('rollcall.cameHint')}
                            onClick={() => onSetFact(r.rowId, dateKey, r.planCode)}
                          >
                            {t('rollcall.came')}
                          </button>
                          {ABSENCE_CODES.map((code) => (
                            <button
                              key={code}
                              type="button"
                              title={t(`code.label.${code}`)}
                              className={`min-w-[2rem] rounded-sm border px-1.5 py-1.5 text-xs font-mono font-bold ${
                                r.factCode === code && changed
                                  ? 'border-accent bg-accent-soft/50 text-ink ring-1 ring-accent/30'
                                  : 'border-grid hover:bg-paper-dark'
                              }`}
                              onClick={() => onSetFact(r.rowId, dateKey, code)}
                            >
                              {code}
                            </button>
                          ))}
                        </div>
                      </li>
                    )
                  })}
                  {g.rows.length === 0 && (
                    <li className="px-3 py-3 text-xs text-stone-400">
                      {tf('rollcall.emptyOnDay', { date: dateLabel })}
                    </li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </AppDialog>
  )
}

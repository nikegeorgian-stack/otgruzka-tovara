import { useMemo, useState } from 'react'

import { AppDialog } from '@/components/ui/AppDialog'

import { EmployeePicker } from '@/components/ui/EmployeePicker'

import { CELL_CODE_STYLES } from '@/components/month/DayCell'

import { useI18n } from '@/context/I18nContext'

import { brigadeLabel } from '@/lib/brigadeText'

import { dayDateKey, daysInMonth, parseMonthKey } from '@/lib/dates'

import { getDayTransfer, isTransferredIn, isTransferredOut } from '@/lib/dayTransfer'

import { factWorkedHours, getFactHoursOverride, isWorkCode } from '@/lib/factExtra'

import { getFactMark } from '@/lib/stats'

import { employeeActiveInMonth } from '@/lib/hr/employeeActive'

import type { AppStore, DayCode } from '@/lib/types'



type Props = {

  store: AppStore

  month: string

  /** Бригады по умолчанию (фильтр при открытии) */

  defaultBrigades?: string[]

  onClose: () => void

  onSetFact: (rowId: string, dateKey: string, code: DayCode) => void

  onSetFactHours: (rowId: string, dateKey: string, hours: number | null) => void

  onAddDayWorker: (

    brigade: string,

    employeeId: string,

    dateKey: string,

    code: DayCode,

  ) => void

  onAssignPermanent: (employeeId: string, brigade: string) => void

  onMarkBrigadier?: (rowId: string, dateKey: string, on: boolean) => void

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

  onClose,

  onSetFact,

  onSetFactHours,

  onAddDayWorker,

  onAssignPermanent,

  onMarkBrigadier,

}: Props) {

  const { t, tf, employeeNameLines, locale } = useI18n()

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

  const [visibleBrigades, setVisibleBrigades] = useState<Set<string>>(() =>

    primarySet.size > 0 ? new Set(primarySet) : new Set(store.brigades),

  )



  const dateKey = dayDateKey(year, mo, day)

  const sheet = store.months[month]



  const brigadesToShow = useMemo(() => {

    return store.brigades.filter((b) => visibleBrigades.has(b))

  }, [store.brigades, visibleBrigades])



  const groups = useMemo(() => {

    if (!sheet) return []

    return brigadesToShow

      .map((brigade) => {

        const brigadierId = store.brigadiers?.[brigade]

        const rows = sheet.rows

          .filter((r) => r.brigade === brigade && r.employeeId)

          .map((r) => {

            const emp = store.employees.find((e) => e.id === r.employeeId)

            if (!emp) return null

            const planCode = (sheet.plan[r.id]?.[dateKey] ?? '') as DayCode

            const factCode = getFactMark(sheet, r.id, dateKey)

            const transfer = emp ? getDayTransfer(sheet, emp.id, dateKey) : undefined

            return {

              rowId: r.id,

              emp,

              planCode,

              factCode,

              worked: factWorkedHours(sheet, r.id, dateKey, factCode),

              hasOverride: getFactHoursOverride(sheet, r.id, dateKey) != null,

              isBrigadierDay: !!sheet.brigadierDays?.[`${r.id}|${dateKey}`],

              isDesignatedBrigadier: brigadierId === r.employeeId,

              transferredOut: isTransferredOut(sheet, r.id, dateKey),

              transferredIn: isTransferredIn(sheet, r.id, dateKey),

              transferTo: transfer?.toBrigade,

            }

          })

          .filter((x): x is NonNullable<typeof x> => !!x)

          .filter((x) => showOff || isWorkCode(x.planCode) || isWorkCode(x.factCode))

          .sort((a, b) =>

            employeeNameLines(a.emp).primary.localeCompare(employeeNameLines(b.emp).primary, 'ru'),

          )

        return { brigade, rows }

      })

      .filter((g) => g.rows.length || addPicker?.brigade === g.brigade)

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [sheet, brigadesToShow, store.employees, store.brigadiers, dateKey, showOff, addPicker])



  const counts = useMemo(() => {

    let onShift = 0

    let off = 0

    for (const g of groups)

      for (const r of g.rows) (isWorkCode(r.factCode) ? onShift++ : off++)

    return { onShift, off }

  }, [groups])



  const dateLabel = `${String(day).padStart(2, '0')}.${String(mo).padStart(2, '0')}.${year}`

  const allBrigadesOn = visibleBrigades.size >= store.brigades.length

  const primaryOnlyOn =

    primarySet.size > 0 &&

    visibleBrigades.size === primarySet.size &&

    [...primarySet].every((b) => visibleBrigades.has(b))



  return (

    <AppDialog

      open

      onClose={onClose}

      title={t('rollcall.title')}

      subtitle={t('rollcall.hint')}

      size="lg"

    >

      <div className="flex flex-col gap-3 px-5 py-4">

        <div className="flex flex-wrap items-center justify-between gap-3">

          <div className="flex items-center gap-1">

            <button

              type="button"

              className="rounded-sm border border-grid px-2 py-1 text-sm hover:bg-paper-dark disabled:opacity-40"

              onClick={() => setDay((d) => Math.max(1, d - 1))}

              disabled={day <= 1}

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

              className="w-14 rounded-sm border border-grid px-2 py-1 text-center text-sm font-mono"

            />

            <button

              type="button"

              className="rounded-sm border border-grid px-2 py-1 text-sm hover:bg-paper-dark disabled:opacity-40"

              onClick={() => setDay((d) => Math.min(totalDays, d + 1))}

              disabled={day >= totalDays}

            >

              ›

            </button>

            <span className="ml-2 text-sm font-semibold text-ink">{dateLabel}</span>

          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">

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

          </div>

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

            <button

              type="button"

              className="rounded-sm border border-grid px-2 py-1 font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"

              disabled={allBrigadesOn}

              onClick={() => setVisibleBrigades(new Set(store.brigades))}

            >

              {t('month.masterBrigadesAll')}

            </button>

          </div>

        ) : null}



        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">

          {groups.length === 0 && (

            <p className="py-8 text-center text-sm text-stone-400">{t('rollcall.noAssigned')}</p>

          )}

          {groups.map((g) => {

            const candidates = store.employees.filter(

              (e) =>

                employeeActiveInMonth(e, month) &&

                !sheet?.rows.some(

                  (r) => r.brigade === g.brigade && r.employeeId === e.id,

                ),

            )

            const pickerOpen = addPicker?.brigade === g.brigade

            return (

              <div key={g.brigade} className="rounded-sm border border-grid">

                <div className="flex items-center justify-between border-b border-grid bg-paper/50 px-3 py-1.5">

                  <span className="text-sm font-semibold text-ink">

                    {brigadeLabel(g.brigade, store.brigadeNamesKa, locale)}

                    {primarySet.has(g.brigade) ? (

                      <span className="ml-1 text-[10px] font-normal text-accent">★</span>

                    ) : null}

                  </span>

                  <div className="flex items-center gap-1">

                    <button

                      type="button"

                      className="rounded-sm border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"

                      onClick={() =>

                        setAddPicker(pickerOpen ? null : { brigade: g.brigade, empId: null })

                      }

                    >

                      {pickerOpen ? t('common.cancel') : `+ ${t('rollcall.addWorker')}`}

                    </button>

                    <button

                      type="button"

                      className="rounded-sm border border-grid px-2 py-0.5 text-[11px] text-stone-600 hover:bg-paper-dark"

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

                  <div className="flex flex-wrap items-end gap-2 border-b border-grid bg-emerald-50/40 px-3 py-2">

                    <div className="min-w-[14rem] flex-1">

                      <EmployeePicker

                        employees={candidates}

                        value={addPicker?.empId ?? null}

                        month={month}

                        placeholder={t('rollcall.pickWorker')}

                        compact

                        onChange={(id) =>

                          setAddPicker({ brigade: g.brigade, empId: id })

                        }

                      />

                    </div>

                    <button

                      type="button"

                      className="rounded-sm border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"

                      disabled={!addPicker?.empId}

                      title={t('rollcall.addDayHint')}

                      onClick={() => {

                        if (!addPicker?.empId) return

                        onAddDayWorker(

                          g.brigade,

                          addPicker.empId,

                          dateKey,

                          brigadeDayCode(store, month, g.brigade, dateKey),

                        )

                        setAddPicker(null)

                      }}

                    >

                      {t('rollcall.addDay')}

                    </button>

                    <button

                      type="button"

                      className="rounded-sm border border-grid px-2 py-1 text-xs font-medium hover:bg-paper-dark disabled:opacity-40"

                      disabled={!addPicker?.empId}

                      title={t('rollcall.addPermanentHint')}

                      onClick={() => {

                        if (!addPicker?.empId) return

                        onAssignPermanent(addPicker.empId, g.brigade)

                        setAddPicker(null)

                      }}

                    >

                      {t('rollcall.addPermanent')}

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

                        className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm"

                      >

                        <span className="min-w-[10rem] flex-1 truncate">

                          {employeeNameLines(r.emp).primary}

                          {r.isDesignatedBrigadier ? (

                            <span className="ml-1 text-[10px] text-amber-700" title={t('table.brigadier')}>

                              ★

                            </span>

                          ) : null}

                          {r.transferredIn ? (

                            <span className="ml-1 text-[10px] text-teal-700" title={t('rollcall.transferredIn')}>

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

                        </span>

                        <span

                          className={`rounded-sm px-1.5 py-0.5 text-xs font-mono ${

                            CELL_CODE_STYLES[r.planCode] ?? CELL_CODE_STYLES['']

                          }`}

                          title={t('rollcall.plan')}

                        >

                          {t('rollcall.plan')}: {r.planCode || '·'}

                        </span>

                        {onShift && (

                          <div

                            className={`flex items-center gap-0.5 rounded-sm border px-1 py-0.5 ${

                              r.hasOverride

                                ? 'border-amber-300 bg-amber-50'

                                : 'border-grid'

                            }`}

                            title={t('rollcall.hoursHint')}

                          >

                            <button

                              type="button"

                              className="px-1 text-sm leading-none text-stone-600 hover:text-ink"

                              onClick={() =>

                                onSetFactHours(r.rowId, dateKey, Math.max(0, r.worked - 1))

                              }

                            >

                              −

                            </button>

                            <span className="w-10 text-center text-xs font-mono">

                              {r.worked} {t('common.hoursShort')}

                            </span>

                            <button

                              type="button"

                              className="px-1 text-sm leading-none text-stone-600 hover:text-ink"

                              onClick={() =>

                                onSetFactHours(r.rowId, dateKey, Math.min(24, r.worked + 1))

                              }

                            >

                              +

                            </button>

                          </div>

                        )}

                        <div className="flex items-center gap-1">

                          {onMarkBrigadier && onShift ? (

                            <button

                              type="button"

                              className={`rounded-sm border px-1.5 py-1 text-xs font-semibold ${

                                r.isBrigadierDay

                                  ? 'border-amber-400 bg-amber-50 text-amber-900'

                                  : 'border-grid text-stone-500 hover:bg-paper-dark'

                              }`}

                              title={

                                r.isBrigadierDay

                                  ? t('brigadier.unmarkDay')

                                  : t('brigadier.markDay')

                              }

                              onClick={() =>

                                onMarkBrigadier(r.rowId, dateKey, !r.isBrigadierDay)

                              }

                            >

                              Бр

                            </button>

                          ) : null}

                          <button

                            type="button"

                            className={`rounded-sm border px-2 py-1 text-xs font-medium ${

                              !changed

                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'

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

                              className={`w-8 rounded-sm border px-1 py-1 text-xs font-mono font-semibold ${

                                r.factCode === code && changed

                                  ? 'border-accent bg-accent-soft/40 text-ink'

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

                    <li className="px-3 py-2 text-xs text-stone-400">

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



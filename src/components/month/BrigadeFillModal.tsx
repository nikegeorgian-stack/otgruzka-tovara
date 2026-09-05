import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useEmployeeEditorApi } from '@/context/EmployeeEditorContext'
import { EmployeeAvatar } from '@/components/ui/EmployeeAvatar'
import { useI18n } from '@/context/I18nContext'
import { employeeSearchText } from '@/i18n'
import {
  applyBrigadeRoster,
  employeesInBrigadeFromHr,
  rosterIdsFromPreviousMonth,
  rosterIdsInMonthSheet,
} from '@/lib/brigadeFill'
import { brigadeLabel } from '@/lib/brigadeText'
import { formatMonthTitle } from '@/lib/dates'
import { findMonthAssignment } from '@/lib/monthAssignment'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'

type Props = {
  store: AppStore
  sheet: MonthSheet
  brigade: string
  /**
   * roster — состав бригады в табеле месяца (по умолчанию).
   * pick — только выбор людей (ночная смена и т.п.), без записи в строки табеля.
   */
  mode?: 'roster' | 'pick'
  /** Стартовый набор для mode=pick (иначе — состав бригады в листе). */
  initialIds?: string[]
  /** Подпись области вместо имени бригады (например группа ночной смены). */
  scopeTitle?: string
  /** Кандидаты вкладки «В бригаде/группе» и кнопки «Из кадров» (для групп ночи). */
  scopeEmployeeIds?: string[]
  /** Якоря коуча для ночной смены (mode=pick). */
  pickCoach?: boolean
  onSave: (employeeIds: string[], syncHr: boolean) => void
  /** Предупреждения о конфликтах при применении состава. */
  onConflicts?: (messages: string[]) => void
  onUpsertEmployee: (employee: Employee) => void
  onClose: () => void
}

type ListFilter = 'all' | 'brigade' | 'selected'

export function BrigadeFillModal({
  store,
  sheet,
  brigade,
  mode = 'roster',
  initialIds,
  scopeTitle,
  scopeEmployeeIds,
  pickCoach = false,
  onSave,
  onConflicts,
  onUpsertEmployee: _onUpsertEmployee,
  onClose,
}: Props) {
  const { t, tf, locale, employeeName } = useI18n()
  const pickMode = mode === 'pick'
  const initial = useMemo(() => {
    if (pickMode && initialIds) return initialIds
    const ids = rosterIdsInMonthSheet(sheet, brigade)
    const brigadierId = store.brigadiers?.[brigade]
    if (brigadierId && !ids.includes(brigadierId)) return [...ids, brigadierId]
    return ids
  }, [pickMode, initialIds, sheet, brigade, store.brigadiers])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial))
  const [search, setSearch] = useState('')
  const [syncHr, setSyncHr] = useState(!pickMode)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const [warnId, setWarnId] = useState<string | null>(null)
  const employeeEditor = useEmployeeEditorApi()
  const creating = employeeEditor.ctx !== null

  const q = search.trim().toLowerCase()
  const activeEmployees = useMemo(
    () =>
      store.employees
        .filter((e) => employeeActiveInMonth(e, sheet.month))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [store.employees, sheet.month],
  )

  const hrInBrigade = useMemo(() => {
    if (scopeEmployeeIds?.length) {
      const want = new Set(scopeEmployeeIds)
      return activeEmployees.filter((e) => want.has(e.id))
    }
    return employeesInBrigadeFromHr(store.employees, brigade, sheet.month)
  }, [scopeEmployeeIds, activeEmployees, store.employees, brigade, sheet.month])

  /** Состав этой же бригады в прошлом месяце (не из других групп). */
  const fromPrevMonth = useMemo(() => {
    const { prevMonth, ids } = rosterIdsFromPreviousMonth(
      store.months,
      sheet.month,
      brigade,
      store.employees,
    )
    if (scopeEmployeeIds?.length) {
      const want = new Set(scopeEmployeeIds)
      return { prevMonth, ids: ids.filter((id) => want.has(id)) }
    }
    return { prevMonth, ids }
  }, [store.months, store.employees, sheet.month, brigade, scopeEmployeeIds])

  const filtered = useMemo(() => {
    let list = activeEmployees
    if (listFilter === 'brigade') {
      list = hrInBrigade
    } else if (listFilter === 'selected') {
      list = activeEmployees.filter((e) => selected.has(e.id))
    }
    if (!q) return list
    return list.filter((e) => employeeSearchText(e).includes(q))
  }, [activeEmployees, hrInBrigade, listFilter, q, selected])

  const selectedEmployees = useMemo(
    () => activeEmployees.filter((e) => selected.has(e.id)),
    [activeEmployees, selected],
  )

  const brigadeTitle =
    scopeTitle || brigadeLabel(brigade, store.brigadeNamesKa, locale)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        if (warnId === id) setWarnId(null)
      } else {
        if (!pickMode) {
          const elsewhere = findMonthAssignment(sheet, id)
          if (elsewhere && elsewhere.brigade !== brigade) {
            setWarnId(id)
          }
        }
        next.add(id)
      }
      return next
    })
  }

  function fillFromHr() {
    setSelected(new Set(hrInBrigade.map((e) => e.id)))
    setListFilter('selected')
  }

  function fillFromPreviousMonth() {
    if (!fromPrevMonth.ids.length) return
    setSelected(new Set(fromPrevMonth.ids))
    setListFilter('selected')
  }

  function clearAll() {
    setSelected(new Set())
    setWarnId(null)
  }

  function handleSave() {
    if (!pickMode) {
      const messages: string[] = []
      for (const id of selected) {
        const emp = store.employees.find((e) => e.id === id)
        if (!emp) continue
        const elsewhere = findMonthAssignment(sheet, id)
        if (elsewhere && elsewhere.brigade !== brigade) {
          messages.push(
            tf('brigadeFill.conflictMonth', {
              name: employeeName(emp),
              brigade: elsewhere.brigade,
            }),
          )
        } else if (emp.brigade && emp.brigade !== brigade) {
          messages.push(
            tf('brigadeFill.conflictHr', {
              name: employeeName(emp),
              brigade: emp.brigade,
            }),
          )
        }
      }
      if (messages.length) onConflicts?.(messages)
    }
    onSave([...selected], pickMode ? false : syncHr)
    onClose()
  }

  const tabs: { id: ListFilter; label: string; count?: number }[] = [
    { id: 'all', label: t('brigadeFill.tabAll'), count: activeEmployees.length },
    {
      id: 'brigade',
      label: pickMode && scopeEmployeeIds ? t('brigadeFill.tabScope') : t('brigadeFill.tabBrigade'),
      count: hrInBrigade.length,
    },
    { id: 'selected', label: t('brigadeFill.tabSelected'), count: selected.size },
  ]

  return (
    <>
      <AppDialog
        open
        onClose={onClose}
        size="xl"
        blockBackdropClose={creating}
        ephemeral={pickMode}
        title={tf('brigadeFill.title', { brigade: brigadeTitle })}
        subtitle={pickMode ? t('brigadeFill.subtitlePick') : t('brigadeFill.subtitle')}
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {pickMode ? (
              <p className="text-sm text-stone-500">
                {tf('brigadeFill.selectedCount', { count: String(selected.size) })}
              </p>
            ) : (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-stone-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-grid text-accent focus:ring-accent/30"
                  checked={syncHr}
                  onChange={(e) => setSyncHr(e.target.checked)}
                />
                {t('brigadeFill.syncHr')}
              </label>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-grid bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-paper-dark"
                onClick={onClose}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                data-coach={pickCoach ? 'nightShift:applyFill' : undefined}
                className="rounded-sm bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
                onClick={handleSave}
              >
                {tf('brigadeFill.applyWithCount', { count: String(selected.size) })}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          {/* Быстрые действия */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95"
              onClick={fillFromHr}
              title={t('brigadeFill.fromHrHint')}
            >
              {t('brigadeFill.fromHr')}
              {hrInBrigade.length > 0 && (
                <span className="rounded-sm bg-white/20 px-2 py-0.5 text-xs">
                  {hrInBrigade.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-sm border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-900 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={fillFromPreviousMonth}
              disabled={!fromPrevMonth.ids.length}
              title={
                fromPrevMonth.ids.length
                  ? tf('brigadeFill.fromPrevMonthHint', {
                      month: formatMonthTitle(fromPrevMonth.prevMonth, locale),
                    })
                  : tf('brigadeFill.fromPrevMonthEmpty', {
                      month: formatMonthTitle(fromPrevMonth.prevMonth, locale),
                    })
              }
            >
              {t('brigadeFill.fromPrevMonth')}
              {fromPrevMonth.ids.length > 0 && (
                <span className="rounded-sm bg-sky-200/60 px-2 py-0.5 text-xs">
                  {fromPrevMonth.ids.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              onClick={() =>
                employeeEditor.openNew({
                  brigade,
                  onSavedExtra: (emp) => {
                    setSelected((prev) => new Set([...prev, emp.id]))
                    setListFilter('selected')
                  },
                })
              }
            >
              <span className="text-base leading-none">+</span>
              {t('employee.picker.addNew')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-grid bg-white px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50"
              onClick={clearAll}
            >
              {t('brigadeFill.clear')}
            </button>
          </div>

          {/* Выбранные — чипы */}
          {selectedEmployees.length > 0 && (
            <div className="rounded-sm border border-accent/20 bg-accent-soft/40 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-accent">
                {tf('brigadeFill.selectedCount', { count: String(selected.size) })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-accent/30 bg-white py-1 pl-1 pr-2 text-left text-xs font-medium text-ink shadow-sm hover:bg-red-50 hover:border-red-200"
                    title={t('brigadeFill.removeFromSelection')}
                    onClick={() => toggle(emp.id)}
                  >
                    <EmployeeAvatar employee={emp} size="sm" />
                    <span className="truncate">{employeeName(emp)}</span>
                    <span className="text-stone-400">×</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Поиск + вкладки */}
          <div className="space-y-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
                ⌕
              </span>
              <input
                type="search"
                className="w-full rounded-sm border border-grid bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder={t('brigadeFill.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                    listFilter === tab.id
                      ? 'bg-white text-ink shadow-sm'
                      : 'text-stone-500 hover:text-ink'
                  }`}
                  onClick={() => setListFilter(tab.id)}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="ml-1 font-mono text-stone-400">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Список */}
          <ul className="space-y-1.5">
            {filtered.length === 0 && (
              <li className="rounded-sm border border-dashed border-grid px-4 py-12 text-center">
                <p className="text-sm text-stone-500">{t('brigadeFill.empty')}</p>
                {listFilter === 'brigade' && hrInBrigade.length === 0 && (
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold text-accent hover:underline"
                    onClick={() =>
                employeeEditor.openNew({
                  brigade,
                  onSavedExtra: (emp) => {
                    setSelected((prev) => new Set([...prev, emp.id]))
                    setListFilter('selected')
                  },
                })
              }
                  >
                    {t('employee.picker.addNew')}
                  </button>
                )}
              </li>
            )}
            {filtered.map((emp) => {
              const checked = selected.has(emp.id)
              const inHrBrigade = emp.brigade === brigade
              const inOtherBrigade = emp.brigade && emp.brigade !== brigade
              const monthElsewhere = findMonthAssignment(sheet, emp.id)
              const inOtherMonthBrigade =
                monthElsewhere && monthElsewhere.brigade !== brigade
              return (
                <li key={emp.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 transition ${
                      checked
                        ? 'border-accent/40 bg-accent/5 shadow-sm'
                        : 'border-transparent bg-stone-50/80 hover:border-grid hover:bg-white'
                    } ${warnId === emp.id ? 'ring-2 ring-amber-400/60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-grid text-accent focus:ring-accent/30"
                      checked={checked}
                      onChange={() => toggle(emp.id)}
                    />
                    <EmployeeAvatar employee={emp} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {employeeName(emp)}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-500">
                        <span className="font-mono">№ {emp.tabNumber}</span>
                        {emp.position && (
                          <span className="truncate">{emp.position}</span>
                        )}
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-grid">
                          {emp.schedule}
                        </span>
                        {inHrBrigade && (
                          <span className="rounded-sm bg-accent/10 px-2 py-0.5 font-semibold text-accent">
                            {t('brigadeFill.inHr')}
                          </span>
                        )}
                        {inOtherMonthBrigade ? (
                          <span className="rounded-sm bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-200">
                            {tf('brigadeFill.inMonthElsewhere', {
                              brigade: monthElsewhere!.brigade,
                            })}
                          </span>
                        ) : inOtherBrigade ? (
                          <span className="text-amber-700">
                            {tf('brigadeFill.otherBrigade', { brigade: emp.brigade })}
                          </span>
                        ) : null}
                      </span>
                      {warnId === emp.id && inOtherMonthBrigade ? (
                        <span className="mt-1 block text-[11px] text-amber-800">
                          {tf('brigadeFill.conflictMonthHint', {
                            brigade: monthElsewhere!.brigade,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      </AppDialog>
    </>
  )
}

/** Предпросмотр без UI — для тестов. */
export function previewBrigadeRoster(
  sheet: MonthSheet,
  employees: AppStore['employees'],
  brigade: string,
  ids: string[],
): MonthSheet {
  return applyBrigadeRoster(sheet, employees, brigade, ids)
}

import { useMemo, useState } from 'react'
import { EmployeeEditorHost } from '@/components/hr/EmployeeEditorHost'
import { AppDialog } from '@/components/ui/AppDialog'
import { useEmployeeEditor } from '@/hooks/useEmployeeEditor'
import { EmployeeAvatar } from '@/components/ui/EmployeeAvatar'
import { useI18n } from '@/context/I18nContext'
import { employeeSearchText } from '@/i18n'
import {
  applyBrigadeRoster,
  employeesInBrigadeFromHr,
  rosterIdsInMonthSheet,
} from '@/lib/brigadeFill'
import { brigadeLabel } from '@/lib/brigadeText'
import type { AppStore, Employee, MonthSheet } from '@/lib/types'

type Props = {
  store: AppStore
  sheet: MonthSheet
  brigade: string
  onSave: (employeeIds: string[], syncHr: boolean) => void
  onUpsertEmployee: (employee: Employee) => void
  onClose: () => void
}

type ListFilter = 'all' | 'brigade' | 'selected'

export function BrigadeFillModal({
  store,
  sheet,
  brigade,
  onSave,
  onUpsertEmployee,
  onClose,
}: Props) {
  const { t, tf, locale, employeeName } = useI18n()
  const initial = useMemo(
    () => rosterIdsInMonthSheet(sheet, brigade),
    [sheet, brigade],
  )
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial))
  const [search, setSearch] = useState('')
  const [syncHr, setSyncHr] = useState(true)
  const [listFilter, setListFilter] = useState<ListFilter>('all')
  const employeeEditor = useEmployeeEditor(store.brigades, store.employees)
  const creating = employeeEditor.ctx !== null

  const q = search.trim().toLowerCase()
  const activeEmployees = useMemo(
    () =>
      store.employees
        .filter((e) => e.active && (e.hrStatus ?? 'active') !== 'fired')
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [store.employees],
  )

  const hrInBrigade = useMemo(
    () => employeesInBrigadeFromHr(store.employees, brigade),
    [store.employees, brigade],
  )

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

  const brigadeTitle = brigadeLabel(brigade, store.brigadeNamesKa, locale)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function fillFromHr() {
    setSelected(new Set(hrInBrigade.map((e) => e.id)))
    setListFilter('selected')
  }

  function clearAll() {
    setSelected(new Set())
  }

  function handleSave() {
    onSave([...selected], syncHr)
    onClose()
  }

  const tabs: { id: ListFilter; label: string; count?: number }[] = [
    { id: 'all', label: t('brigadeFill.tabAll'), count: activeEmployees.length },
    { id: 'brigade', label: t('brigadeFill.tabBrigade'), count: hrInBrigade.length },
    { id: 'selected', label: t('brigadeFill.tabSelected'), count: selected.size },
  ]

  return (
    <>
      <AppDialog
        open
        onClose={onClose}
        size="xl"
        zIndex={130}
        blockBackdropClose={creating}
        title={tf('brigadeFill.title', { brigade: brigadeTitle })}
        subtitle={t('brigadeFill.subtitle')}
        footer={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-stone-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-grid text-accent focus:ring-accent/30"
                checked={syncHr}
                onChange={(e) => setSyncHr(e.target.checked)}
              />
              {t('brigadeFill.syncHr')}
            </label>
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
              className="inline-flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
              onClick={() => employeeEditor.openNew({ brigade })}
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
                    onClick={() => employeeEditor.openNew({ brigade })}
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
              return (
                <li key={emp.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 transition ${
                      checked
                        ? 'border-accent/40 bg-accent/5 shadow-sm'
                        : 'border-transparent bg-stone-50/80 hover:border-grid hover:bg-white'
                    }`}
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
                        {inOtherBrigade && (
                          <span className="text-amber-700">
                            {tf('brigadeFill.otherBrigade', { brigade: emp.brigade })}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      </AppDialog>

      <EmployeeEditorHost
        ctx={employeeEditor.ctx}
        employees={store.employees}
        brigades={store.brigades}
        hrStructuralUnits={store.hrStructuralUnits}
        hrPositions={store.hrPositions}
        onSave={(emp) => {
          onUpsertEmployee(emp)
          setSelected((prev) => new Set([...prev, emp.id]))
          setListFilter('selected')
          employeeEditor.close()
        }}
        onClose={employeeEditor.close}
      />
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

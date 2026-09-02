import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import {
  activeStructuralUnits,
  BRIGADE_UNIT_FILTER_ALL,
  filterAndSortBrigadeList,
  NO_STRUCTURAL_UNIT_ID,
  resolveMonthViewDisplay,
  type MonthGroupMode,
  type MonthViewDisplay,
} from '@/lib/monthViewOptions'
import {
  DEFAULT_MONTH_ROW_SORT,
  type MonthRowSort,
  type MonthRowSortKey,
} from '@/lib/monthRowSort'
import type { HrStructuralUnit } from '@/lib/types'
import type { MonthViewDefaults, MonthViewLayout, MonthViewShell } from '@/lib/viewDefaults/types'

type Props = {
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  brigadeUnits?: Record<string, string>
  structuralUnits?: HrStructuralUnit[]
  workshopMasterMode?: boolean
  initial: MonthViewDefaults
  onSave: (defaults: MonthViewDefaults) => void
  onClose: () => void
}

const SHELLS: { id: MonthViewShell; labelKey: string; hintKey: string }[] = [
  { id: 'workspace', labelKey: 'month.shell.workspace', hintKey: 'month.shell.workspaceHint' },
  { id: 'classic', labelKey: 'month.shell.classic', hintKey: 'month.shell.classicHint' },
]

const LAYOUTS: { id: MonthViewLayout; labelKey: string }[] = [
  { id: 'dual', labelKey: 'month.overview' },
  { id: 'plan', labelKey: 'month.plan' },
  { id: 'fact', labelKey: 'month.fact' },
]

export function MonthViewDefaultsDialog({
  brigades,
  brigadeNamesKa,
  brigadeUnits,
  structuralUnits = [],
  workshopMasterMode = false,
  initial,
  onSave,
  onClose,
}: Props) {
  const { t, tf, locale } = useI18n()

  const [shell, setShell] = useState<MonthViewShell>(initial.shell ?? 'workspace')
  const [layout, setLayout] = useState<MonthViewLayout>(initial.layout ?? 'dual')
  const [groupMode, setGroupMode] = useState<MonthGroupMode>(initial.groupMode ?? 'brigade')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(
    () => new Set(initial.defaultBrigades ?? brigades),
  )
  const [brigadeSearch, setBrigadeSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState(BRIGADE_UNIT_FILTER_ALL)
  const [display, setDisplay] = useState<MonthViewDisplay>(() =>
    resolveMonthViewDisplay(initial.viewDisplay, { workshopMasterMode }),
  )
  const [rowSort, setRowSort] = useState<MonthRowSort>(
    () => initial.rowSort ?? DEFAULT_MONTH_ROW_SORT,
  )

  const units = useMemo(() => activeStructuralUnits(structuralUnits), [structuralUnits])
  const hasUnassigned = brigades.some((b) => !brigadeUnits?.[b]?.trim())
  const visibleBrigades = useMemo(
    () =>
      filterAndSortBrigadeList({
        brigades,
        namesKa: brigadeNamesKa,
        locale,
        search: brigadeSearch,
        brigadeUnits,
        unitFilter,
      }),
    [brigadeNamesKa, brigadeSearch, brigadeUnits, brigades, locale, unitFilter],
  )

  const allSelected = selectedBrigades.size >= brigades.length

  const displayToggles = useMemo(
    () =>
      [
        { key: 'showPlan' as const, label: t('month.plan') },
        { key: 'showFact' as const, label: t('month.fact') },
        { key: 'showTotals' as const, label: t('month.displayTotals') },
      ] as const,
    [t],
  )

  function toggleBrigade(name: string) {
    setSelectedBrigades((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function handleSave() {
    const lean = resolveMonthViewDisplay(display, { workshopMasterMode })
    onSave({
      shell,
      layout: shell === 'classic' ? layout : 'fact',
      groupMode: workshopMasterMode ? undefined : groupMode,
      defaultBrigades: [...selectedBrigades],
      viewDisplay: {
        showPlan: lean.showPlan,
        showFact: lean.showFact,
        showTab: false,
        showPosition: false,
        showUnit: false,
        showSchedule: false,
        showTotals: lean.showTotals,
      },
      rowSort,
    })
    onClose()
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      size="lg"
      title={t('month.defaults.title')}
      subtitle={t('month.defaults.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-paper-dark"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-95"
            onClick={handleSave}
          >
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="space-y-6 p-5">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('month.defaults.shell')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHELLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-sm border px-3 py-2 text-left transition ${
                  shell === item.id
                    ? 'border-teal-400 bg-teal-50 shadow-sm'
                    : 'border-grid bg-white hover:bg-paper-dark/40'
                }`}
                onClick={() => setShell(item.id)}
              >
                <span className="block text-sm font-semibold text-ink">{t(item.labelKey)}</span>
                <span className="mt-0.5 block text-xs text-stone-500">{t(item.hintKey)}</span>
              </button>
            ))}
          </div>
        </section>

        {shell === 'classic' ? (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('month.defaults.layout')}
          </p>
          <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
            {LAYOUTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rounded-sm px-3 py-1.5 text-sm font-semibold transition ${
                  layout === item.id
                    ? 'bg-white text-ink shadow-sm'
                    : 'text-stone-500 hover:text-ink'
                }`}
                onClick={() => setLayout(item.id)}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
        </section>
        ) : null}

        {!workshopMasterMode && shell === 'classic' ? (
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('month.defaults.groupMode')}
            </p>
            <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
              {(
                [
                  ['brigade', t('month.groupByBrigade')],
                  ['unit', t('month.groupByUnit')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-sm px-3 py-1.5 text-sm font-semibold transition ${
                    groupMode === id
                      ? 'bg-white text-ink shadow-sm'
                      : 'text-stone-500 hover:text-ink'
                  }`}
                  onClick={() => setGroupMode(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('month.defaults.brigades')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="text-xs font-semibold text-accent hover:underline"
                onClick={() => setSelectedBrigades(new Set(brigades))}
              >
                {t('month.defaults.selectAll')}
              </button>
              <button
                type="button"
                className="text-xs font-semibold text-stone-500 hover:underline"
                onClick={() => setSelectedBrigades(new Set())}
              >
                {t('month.defaults.clearAll')}
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-stone-500">{t('month.defaults.brigadesHint')}</p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              type="search"
              className="min-w-[8rem] flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
              placeholder={t('month.searchBrigade')}
              value={brigadeSearch}
              onChange={(e) => setBrigadeSearch(e.target.value)}
            />
            {units.length > 0 || hasUnassigned ? (
              <select
                className="min-w-[8rem] rounded-sm border border-grid bg-white px-2 py-1.5 text-sm text-stone-700"
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                title={t('month.brigadeUnitFilterHint')}
                aria-label={t('month.brigadeUnitFilter')}
              >
                <option value={BRIGADE_UNIT_FILTER_ALL}>{t('month.brigadeUnitFilterAll')}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
                {hasUnassigned ? (
                  <option value={NO_STRUCTURAL_UNIT_ID}>{t('month.brigadeUnitFilterNone')}</option>
                ) : null}
              </select>
            ) : null}
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-grid p-2">
            {visibleBrigades.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-stone-400">{t('month.noBrigadeMatch')}</li>
            ) : (
              visibleBrigades.map((b) => (
              <li key={b}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-grid text-accent"
                    checked={selectedBrigades.has(b)}
                    onChange={() => toggleBrigade(b)}
                  />
                  <span className="text-sm font-medium text-ink">
                    {brigadeLabel(b, brigadeNamesKa, locale)}
                  </span>
                </label>
              </li>
              ))
            )}
          </ul>
          {!allSelected && selectedBrigades.size > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              {tf('month.defaults.brigadesCount', { count: String(selectedBrigades.size) })}
            </p>
          )}
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('month.defaults.rowSort')}
          </p>
          <p className="mb-3 text-xs text-stone-500">{t('month.defaults.rowSortHint')}</p>
          <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
            {(
              [
                ['default', t('table.colRowNum')],
                ['name', t('table.colName')],
                ['tab', t('table.colTab')],
                ['position', t('table.colPosition')],
                ['schedule', t('table.colSchedule')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-sm px-3 py-1.5 text-sm font-semibold transition ${
                  rowSort.key === id
                    ? 'bg-white text-ink shadow-sm'
                    : 'text-stone-500 hover:text-ink'
                }`}
                onClick={() => setRowSort((prev) => ({ ...prev, key: id as MonthRowSortKey }))}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-grid text-accent"
              checked={rowSort.dir === 'desc'}
              onChange={(e) =>
                setRowSort((prev) => ({ ...prev, dir: e.target.checked ? 'desc' : 'asc' }))
              }
            />
            {t('month.defaults.rowSortDesc')}
          </label>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('month.defaults.columns')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {displayToggles.map(({ key, label }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-sm border border-grid px-3 py-2 hover:bg-stone-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-grid text-accent"
                  checked={display[key]}
                  onChange={(e) =>
                    setDisplay((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                />
                <span className="text-sm text-ink">{label}</span>
              </label>
            ))}
          </div>
        </section>
      </div>
    </AppDialog>
  )
}

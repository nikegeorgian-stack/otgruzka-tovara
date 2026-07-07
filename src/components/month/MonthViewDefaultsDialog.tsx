import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { DEFAULT_MONTH_VIEW_DISPLAY, type MonthGroupMode, type MonthViewDisplay } from '@/lib/monthViewOptions'
import {
  DEFAULT_MONTH_ROW_SORT,
  type MonthRowSort,
  type MonthRowSortKey,
} from '@/lib/monthRowSort'
import type { MonthViewDefaults, MonthViewLayout } from '@/lib/viewDefaults/types'

type Props = {
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  workshopMasterMode?: boolean
  initial: MonthViewDefaults
  onSave: (defaults: MonthViewDefaults) => void
  onClose: () => void
}

const LAYOUTS: { id: MonthViewLayout; labelKey: string }[] = [
  { id: 'dual', labelKey: 'month.overview' },
  { id: 'plan', labelKey: 'month.plan' },
  { id: 'fact', labelKey: 'month.fact' },
]

export function MonthViewDefaultsDialog({
  brigades,
  brigadeNamesKa,
  workshopMasterMode = false,
  initial,
  onSave,
  onClose,
}: Props) {
  const { t, tf, locale } = useI18n()

  const [layout, setLayout] = useState<MonthViewLayout>(initial.layout ?? 'dual')
  const [groupMode, setGroupMode] = useState<MonthGroupMode>(initial.groupMode ?? 'brigade')
  const [selectedBrigades, setSelectedBrigades] = useState<Set<string>>(
    () => new Set(initial.defaultBrigades ?? brigades),
  )
  const [display, setDisplay] = useState<MonthViewDisplay>(() => ({
    ...DEFAULT_MONTH_VIEW_DISPLAY,
    ...initial.viewDisplay,
    showUnit: workshopMasterMode ? false : (initial.viewDisplay?.showUnit ?? true),
  }))
  const [rowSort, setRowSort] = useState<MonthRowSort>(
    () => initial.rowSort ?? DEFAULT_MONTH_ROW_SORT,
  )

  const allSelected = selectedBrigades.size >= brigades.length

  const displayToggles = useMemo(
    () =>
      [
        { key: 'showPlan' as const, label: t('month.plan') },
        { key: 'showFact' as const, label: t('month.fact') },
        { key: 'showTab' as const, label: t('table.colTab') },
        { key: 'showPosition' as const, label: t('table.colPosition') },
        ...(workshopMasterMode
          ? []
          : [{ key: 'showUnit' as const, label: t('table.colUnit') }]),
        { key: 'showSchedule' as const, label: t('table.colSchedule') },
        { key: 'showTotals' as const, label: t('month.displayTotals') },
      ] as const,
    [t, workshopMasterMode],
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
    onSave({
      layout,
      groupMode: workshopMasterMode ? undefined : groupMode,
      defaultBrigades: [...selectedBrigades],
      viewDisplay: {
        showPlan: display.showPlan,
        showFact: display.showFact,
        showTab: display.showTab,
        showPosition: display.showPosition,
        showUnit: workshopMasterMode ? false : display.showUnit,
        showSchedule: display.showSchedule,
        showTotals: display.showTotals,
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

        {!workshopMasterMode && (
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
        )}

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
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-sm border border-grid p-2">
            {brigades.map((b) => (
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
            ))}
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

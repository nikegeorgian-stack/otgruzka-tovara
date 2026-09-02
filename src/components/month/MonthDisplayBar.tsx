import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import {
  activeStructuralUnits,
  allBrigadesSelected,
  allStructuralUnitsSelected,
  BRIGADE_UNIT_FILTER_ALL,
  filterAndSortBrigadeList,
  NO_STRUCTURAL_UNIT_ID,
  unitMatchesSearch,
  type MonthGroupMode,
  type MonthViewDisplay,
} from '@/lib/monthViewOptions'
import type { HrStructuralUnit } from '@/lib/types'

type Props = {
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  /** Привязка бригада → id подразделения (для фильтра списка). */
  brigadeUnits?: Record<string, string>
  brigadeSearch: string
  selectedBrigades: Set<string>
  /** Бригады мастера цеха — по умолчанию и для быстрого выбора. */
  primaryBrigades?: string[]
  /** Жёсткая область: нельзя выбрать бригады вне списка / «весь завод». */
  lockBrigadeScope?: boolean
  structuralUnits: HrStructuralUnit[]
  unitSearch: string
  selectedUnits: Set<string>
  showUnassignedUnit: boolean
  groupMode: MonthGroupMode
  showUnitFilters?: boolean
  showGroupModeToggle?: boolean
  display: MonthViewDisplay
  layout: 'dual' | 'plan' | 'fact'
  onBrigadeSearch: (v: string) => void
  onSelectedBrigades: (next: Set<string>) => void
  onUnitSearch: (v: string) => void
  onSelectedUnits: (next: Set<string>) => void
  onGroupMode: (mode: MonthGroupMode) => void
  onDisplay: (patch: Partial<MonthViewDisplay>) => void
}

function Check({
  checked,
  onChange,
  label,
  title,
  emphasis,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  title?: string
  emphasis?: boolean
}) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs hover:bg-paper-dark/60 ${
        emphasis ? 'font-semibold text-accent' : 'text-stone-700'
      }`}
      title={title}
    >
      <input
        type="checkbox"
        className="size-3.5 rounded border-stone-300 text-accent focus:ring-accent/30"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

export function MonthDisplayBar({
  brigades,
  brigadeNamesKa,
  brigadeUnits,
  brigadeSearch,
  selectedBrigades,
  primaryBrigades,
  lockBrigadeScope = false,
  structuralUnits,
  unitSearch,
  selectedUnits,
  showUnassignedUnit,
  groupMode,
  showUnitFilters = true,
  showGroupModeToggle = true,
  display,
  layout,
  onBrigadeSearch,
  onSelectedBrigades,
  onUnitSearch,
  onSelectedUnits,
  onGroupMode,
  onDisplay,
}: Props) {
  const { t, locale } = useI18n()
  const [brigadeUnitFilter, setBrigadeUnitFilter] = useState(BRIGADE_UNIT_FILTER_ALL)

  const brigadeUnitOptions = useMemo(() => {
    const units = activeStructuralUnits(structuralUnits)
    const hasUnassigned = brigades.some((b) => !brigadeUnits?.[b]?.trim())
    return { units, hasUnassigned }
  }, [brigadeUnits, brigades, structuralUnits])

  const visibleBrigadeList = useMemo(
    () =>
      filterAndSortBrigadeList({
        brigades,
        namesKa: brigadeNamesKa,
        locale,
        search: brigadeSearch,
        brigadeUnits,
        unitFilter: brigadeUnitFilter,
      }),
    [brigadeNamesKa, brigadeSearch, brigadeUnitFilter, brigadeUnits, brigades, locale],
  )

  const unitFilterItems = useMemo(() => {
    const items = activeStructuralUnits(structuralUnits).map((u) => ({
      id: u.id,
      name: u.name,
    }))
    if (showUnassignedUnit) {
      items.push({ id: NO_STRUCTURAL_UNIT_ID, name: t('month.unitUnassigned') })
    }
    return items.filter((u) => unitMatchesSearch(u.name, unitSearch))
  }, [showUnassignedUnit, structuralUnits, t, unitSearch])

  const allUnitKeys = useMemo(() => {
    const keys = activeStructuralUnits(structuralUnits).map((u) => u.id)
    if (showUnassignedUnit) keys.push(NO_STRUCTURAL_UNIT_ID)
    return keys
  }, [showUnassignedUnit, structuralUnits])

  const allBrigadesOn = allBrigadesSelected(selectedBrigades, brigades)
  const allUnitsOn = allStructuralUnitsSelected(selectedUnits, allUnitKeys)
  const primarySet = useMemo(
    () => new Set(primaryBrigades ?? []),
    [primaryBrigades],
  )
  const primaryOnlyOn =
    primaryBrigades != null &&
    primaryBrigades.length > 0 &&
    primaryBrigades.every((b) => selectedBrigades.has(b)) &&
    selectedBrigades.size === primaryBrigades.length

  function toggleBrigade(name: string) {
    onSelectedBrigades(
      (() => {
        const next = new Set(selectedBrigades)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })(),
    )
  }

  function toggleUnit(id: string) {
    onSelectedUnits(
      (() => {
        const next = new Set(selectedUnits)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })(),
    )
  }

  return (
    <div className="space-y-2 rounded-sm border border-grid bg-white/90 px-3 py-2.5 text-sm shadow-sm print:hidden">
      {showGroupModeToggle ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-grid/60 pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
            {t('month.groupBy')}:
          </span>
          {(
            [
              ['brigade', t('month.groupByBrigade')],
              ['unit', t('month.groupByUnit')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`rounded-sm border px-2.5 py-1 text-xs font-medium ${
                groupMode === id
                  ? 'border-accent bg-accent text-white'
                  : 'border-grid bg-white text-stone-700 hover:bg-paper-dark'
              }`}
              onClick={() => onGroupMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {primaryBrigades && primaryBrigades.length > 0 ? (
        <p className="text-xs text-stone-600">{t('month.masterBrigadesHint')}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm sm:max-w-xs"
          placeholder={t('month.searchBrigade')}
          value={brigadeSearch}
          onChange={(e) => onBrigadeSearch(e.target.value)}
        />
        {brigadeUnitOptions.units.length > 0 || brigadeUnitOptions.hasUnassigned ? (
          <select
            className="min-w-[9rem] rounded-sm border border-grid bg-white px-2 py-1.5 text-sm text-stone-700"
            value={brigadeUnitFilter}
            onChange={(e) => setBrigadeUnitFilter(e.target.value)}
            title={t('month.brigadeUnitFilterHint')}
            aria-label={t('month.brigadeUnitFilter')}
          >
            <option value={BRIGADE_UNIT_FILTER_ALL}>{t('month.brigadeUnitFilterAll')}</option>
            {brigadeUnitOptions.units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            {brigadeUnitOptions.hasUnassigned ? (
              <option value={NO_STRUCTURAL_UNIT_ID}>{t('month.brigadeUnitFilterNone')}</option>
            ) : null}
          </select>
        ) : null}
        <div className="flex items-center gap-1">
          {primaryBrigades && primaryBrigades.length > 0 ? (
            <>
              <button
                type="button"
                className="rounded-sm border border-accent/40 bg-accent/5 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40"
                onClick={() => onSelectedBrigades(new Set(primaryBrigades))}
                disabled={primaryOnlyOn}
              >
                {t('month.masterBrigadesOnly')}
              </button>
              {!lockBrigadeScope ? (
                <button
                  type="button"
                  className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
                  onClick={() => onSelectedBrigades(new Set(brigades))}
                  disabled={allBrigadesOn}
                >
                  {t('month.masterBrigadesAll')}
                </button>
              ) : null}
              <span className="mx-0.5 text-stone-300">|</span>
            </>
          ) : null}
          <button
            type="button"
            className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
            onClick={() => onSelectedBrigades(new Set(brigades))}
            disabled={allBrigadesOn}
            title={lockBrigadeScope ? t('month.scopeBrigadesOnly') : undefined}
          >
            {t('month.brigadesSelectAll')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
            onClick={() => onSelectedBrigades(new Set())}
            disabled={selectedBrigades.size === 0}
          >
            {t('month.brigadesSelectNone')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t('month.brigadesShow')}:
        </span>
        {visibleBrigadeList.length === 0 ? (
          <span className="text-xs text-stone-400">{t('month.noBrigadeMatch')}</span>
        ) : (
          visibleBrigadeList.map((b) => (
            <Check
              key={b}
              checked={selectedBrigades.has(b)}
              onChange={() => toggleBrigade(b)}
              label={brigadeLabel(b, brigadeNamesKa, locale)}
              emphasis={primarySet.has(b)}
              title={primarySet.has(b) ? t('month.masterBrigadeOwn') : undefined}
            />
          ))
        )}
      </div>

      {showUnitFilters && allUnitKeys.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-t border-grid/60 pt-2">
            <input
              type="search"
              className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm sm:max-w-xs"
              placeholder={t('month.searchUnit')}
              value={unitSearch}
              onChange={(e) => onUnitSearch(e.target.value)}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
                onClick={() => onSelectedUnits(new Set(allUnitKeys))}
                disabled={allUnitsOn}
              >
                {t('month.unitsSelectAll')}
              </button>
              <button
                type="button"
                className="rounded-sm border border-grid px-2 py-1 text-[11px] font-medium text-stone-600 hover:bg-paper-dark disabled:opacity-40"
                onClick={() => onSelectedUnits(new Set())}
                disabled={selectedUnits.size === 0}
              >
                {t('month.unitsSelectNone')}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
              {t('month.unitsShow')}:
            </span>
            {unitFilterItems.length === 0 ? (
              <span className="text-xs text-stone-400">{t('month.noUnitMatch')}</span>
            ) : (
              unitFilterItems.map((u) => (
                <Check
                  key={u.id}
                  checked={selectedUnits.has(u.id)}
                  onChange={() => toggleUnit(u.id)}
                  label={u.name}
                />
              ))
            )}
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-grid/60 pt-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          {t('month.displayShow')}:
        </span>
        {layout === 'dual' && (
          <>
            <Check
              checked={display.showPlan}
              onChange={(v) => onDisplay({ showPlan: v })}
              label={t('month.plan')}
            />
            <Check
              checked={display.showFact}
              onChange={(v) => onDisplay({ showFact: v })}
              label={t('month.fact')}
            />
            <span className="mx-1 text-stone-300">|</span>
          </>
        )}
        <Check
          checked={display.showTotals}
          onChange={(v) => onDisplay({ showTotals: v })}
          label={t('month.displayTotals')}
        />
      </div>
    </div>
  )
}

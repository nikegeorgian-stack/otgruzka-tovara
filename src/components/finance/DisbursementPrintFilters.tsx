import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { formatGel } from '@/lib/payroll'
import {
  defaultPrintFilter,
  filterRowsByOrg,
  resolvePrintRows,
  toggleInList,
  uniqueBrigadesFromRows,
  uniqueUnitsFromRows,
  type DisbursementPrintFilterState,
  type DisbursementPrintRow,
} from '@/lib/finance/disbursementPrintFilter'
import type { HrStructuralUnit } from '@/lib/hr/types'

type Props = {
  rows: DisbursementPrintRow[]
  units: HrStructuralUnit[]
  filter: DisbursementPrintFilterState
  onChange: (next: DisbursementPrintFilterState) => void
}

export function DisbursementPrintFilters({ rows, units, filter, onChange }: Props) {
  const { t } = useI18n()
  const unitOpts = useMemo(() => uniqueUnitsFromRows(rows, units), [rows, units])
  const brigadeOpts = useMemo(() => uniqueBrigadesFromRows(rows), [rows])
  const scoped = useMemo(() => filterRowsByOrg(rows, filter), [rows, filter])
  const selected = useMemo(() => resolvePrintRows(rows, filter), [rows, filter])
  const selectedSum = selected.reduce((s, r) => s + r.amount, 0)

  function setUnits(unitIds: string[]) {
    onChange({ ...filter, unitIds, selectedLineIds: null })
  }
  function setBrigades(brigades: string[]) {
    onChange({ ...filter, brigades, selectedLineIds: null })
  }

  function selectAllScoped() {
    onChange({ ...filter, selectedLineIds: scoped.map((r) => r.lineId) })
  }
  function clearSelection() {
    onChange({ ...filter, selectedLineIds: [] })
  }
  function resetFilters() {
    onChange(defaultPrintFilter())
  }

  function toggleLine(lineId: string) {
    const base =
      filter.selectedLineIds == null ? scoped.map((r) => r.lineId) : [...filter.selectedLineIds]
    onChange({ ...filter, selectedLineIds: toggleInList(base, lineId) })
  }

  const selectedSet = useMemo(() => {
    if (filter.selectedLineIds == null) return new Set(scoped.map((r) => r.lineId))
    return new Set(filter.selectedLineIds)
  }, [filter.selectedLineIds, scoped])

  return (
    <div className="no-print space-y-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-sm text-stone-100">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          {t('fin.printFilter.title')}
        </p>
        <p className="text-xs text-stone-300">
          {t('fin.printFilter.selected')}: {selected.length}/{rows.length} · {formatGel(selectedSum)}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-stone-400">{t('fin.printFilter.units')}</p>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            <button
              type="button"
              className={`rounded-sm px-2 py-1 text-xs ${
                filter.unitIds.length === 0
                  ? 'bg-white text-stone-900'
                  : 'border border-stone-500 text-stone-200 hover:bg-stone-800'
              }`}
              onClick={() => setUnits([])}
            >
              {t('fin.printFilter.all')}
            </button>
            {unitOpts.map((u) => {
              const on = filter.unitIds.includes(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  className={`rounded-sm px-2 py-1 text-xs ${
                    on
                      ? 'bg-sky-600 text-white'
                      : 'border border-stone-500 text-stone-200 hover:bg-stone-800'
                  }`}
                  onClick={() => setUnits(toggleInList(filter.unitIds, u.id))}
                >
                  {u.label}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-stone-400">{t('fin.printFilter.brigades')}</p>
          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            <button
              type="button"
              className={`rounded-sm px-2 py-1 text-xs ${
                filter.brigades.length === 0
                  ? 'bg-white text-stone-900'
                  : 'border border-stone-500 text-stone-200 hover:bg-stone-800'
              }`}
              onClick={() => setBrigades([])}
            >
              {t('fin.printFilter.all')}
            </button>
            {brigadeOpts.map((b) => {
              const on = filter.brigades.includes(b)
              return (
                <button
                  key={b}
                  type="button"
                  className={`rounded-sm px-2 py-1 text-xs ${
                    on
                      ? 'bg-teal-600 text-white'
                      : 'border border-stone-500 text-stone-200 hover:bg-stone-800'
                  }`}
                  onClick={() => setBrigades(toggleInList(filter.brigades, b))}
                >
                  {b}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-sm border border-stone-500 px-2 py-1 text-xs hover:bg-stone-800"
          onClick={selectAllScoped}
        >
          {t('fin.printFilter.selectAll')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-stone-500 px-2 py-1 text-xs hover:bg-stone-800"
          onClick={clearSelection}
        >
          {t('fin.printFilter.selectNone')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-stone-500 px-2 py-1 text-xs hover:bg-stone-800"
          onClick={resetFilters}
        >
          {t('fin.printFilter.reset')}
        </button>
      </div>

      <div className="max-h-36 overflow-y-auto rounded-sm border border-stone-700 bg-stone-950/50">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-stone-900 text-stone-400">
            <tr>
              <th className="w-8 px-2 py-1" />
              <th className="px-2 py-1 text-left">{t('fin.bankTransfer.colName')}</th>
              <th className="px-2 py-1 text-right">{t('fin.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {scoped.map((r) => (
              <tr key={r.lineId} className="border-t border-stone-800">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(r.lineId)}
                    onChange={() => toggleLine(r.lineId)}
                  />
                </td>
                <td className="px-2 py-1">{r.employeeName}</td>
                <td className="px-2 py-1 text-right font-mono">{formatGel(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

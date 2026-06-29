import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { filterRawMaterials } from '@/lib/packaging/filters'
import { RAW_MATERIAL_KINDS, rawMaterialKindLabel, type RawMaterialKind } from '@/lib/packaging/types'
import type { WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  kind?: RawMaterialKind
  itemId?: string
  metersPerRoll?: number
  warehouseItems: WarehouseItem[]
  categoryNames: Map<string, string>
  onKindChange: (kind: RawMaterialKind | undefined) => void
  onItemChange: (id: string | undefined) => void
  onMetersPerRollChange: (value: number | undefined) => void
  onOpenNomenclature?: () => void
}

export function RawMaterialPlanField({
  kind,
  itemId,
  metersPerRoll,
  warehouseItems,
  categoryNames,
  onKindChange,
  onItemChange,
  onMetersPerRollChange,
  onOpenNomenclature,
}: Props) {
  const { t, locale } = useI18n()
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')

  const options = useMemo(
    () => filterRawMaterials(warehouseItems, categoryNames, kind),
    [warehouseItems, categoryNames, kind],
  )

  const selected = itemId ? warehouseItems.find((i) => i.id === itemId) : undefined

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 12)
    return options.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 12)
  }, [options, query])

  function pick(id: string) {
    onItemChange(id)
    setPicking(false)
    setQuery('')
  }

  return (
    <div className="sm:col-span-2 rounded-sm border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
            {t('planner.rawPlanTitle')}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/80">
            {t('planner.rawPlanHint')}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-stone-600">
          {t('planner.rawKind')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={kind ?? ''}
            onChange={(e) =>
              onKindChange(
                e.target.value ? (e.target.value as RawMaterialKind) : undefined,
              )
            }
          >
            <option value="">{t('planner.rawKindPick')}</option>
            {RAW_MATERIAL_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {rawMaterialKindLabel(k.id, locale)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-stone-600">
          {t('planner.metersPerRoll')}
          <input
            type="number"
            min={0}
            step={0.1}
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={metersPerRoll ?? ''}
            onChange={(e) =>
              onMetersPerRollChange(e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </label>
      </div>

      <div className="mt-3">
        {selected && !picking ? (
          <div className="rounded-sm border border-emerald-300/80 bg-white px-3 py-3 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              {t('planner.rawPlanFrom')}
            </p>
            <p className="mt-1 text-sm font-medium leading-snug text-ink">{selected.name}</p>
            <p className="mt-1 font-mono text-xs text-stone-500">
              {selected.internalCode}
              {kind ? ` · ${rawMaterialKindLabel(kind, locale)}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-sm border border-grid px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                onClick={() => setPicking(true)}
              >
                {t('planner.rawPlanChange')}
              </button>
              {onOpenNomenclature && (
                <button
                  type="button"
                  className="rounded-sm border border-grid px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/5"
                  onClick={onOpenNomenclature}
                >
                  {t('planner.rawPlanOpenWh')}
                </button>
              )}
              <button
                type="button"
                className="rounded-sm px-2.5 py-1 text-xs text-stone-500 hover:text-red-600"
                onClick={() => onItemChange(undefined)}
              >
                {t('planner.rawPlanClear')}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-sm border border-grid bg-white p-3">
            <p className="text-xs font-medium text-stone-600">
              {selected ? t('planner.rawPlanChange') : t('planner.rawPlanPick')}
            </p>
            <input
              className="mt-2 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('planner.rawPlanSearch')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={picking}
            />
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-sm border border-grid/60">
              {filtered.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-stone-400">
                  {t('planner.rawPlanEmpty')}
                </li>
              )}
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 ${
                      item.id === itemId ? 'bg-emerald-50 font-medium' : ''
                    }`}
                    onClick={() => pick(item.id)}
                  >
                    <span className="line-clamp-2">{item.name}</span>
                    <span className="font-mono text-[10px] text-stone-400">
                      {item.internalCode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {picking && (
              <button
                type="button"
                className="mt-2 text-xs text-stone-500 hover:underline"
                onClick={() => setPicking(false)}
              >
                {t('planner.cancel')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { useI18n } from '@/context/I18nContext'
import {
  componentConsumeKg,
  isFormulationWaterComponent,
  maxBatchesFromStock,
  recipeDryBatchKg,
  recipeStockLines,
  recipeTotalBatchKg,
} from '@/lib/formulations/calc'
import { colorVariantToProductColor } from '@/lib/formulations/colorMap'
import { emptyFormulationComponent } from '@/lib/formulations/init'
import type {
  FormulationCategory,
  FormulationColorVariant,
  FormulationComponent,
  FormulationRecipe,
} from '@/lib/formulations/types'
import {
  FORMULATION_CATEGORIES,
  FORMULATION_COLOR_VARIANTS,
  formulationColorLabel,
} from '@/lib/formulations/types'
import {
  filterFormulationComponentItems,
  formulationRecipeDisplayName,
} from '@/lib/formulations/warehouseSync'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  recipe: FormulationRecipe
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  onChange: (recipe: FormulationRecipe) => void
  onClose: () => void
  onSave: () => void
  onDelete?: () => void
  onOpenNomenclature: () => void
}

export function FormulationRecipeEditor({
  recipe,
  warehouse,
  categoryNames,
  onChange,
  onClose,
  onSave,
  onDelete,
  onOpenNomenclature,
}: Props) {
  const { t, tf, locale } = useI18n()

  const componentItems = useMemo(
    () => filterFormulationComponentItems(warehouse.items, categoryNames),
    [warehouse.items, categoryNames],
  )

  const itemsById = useMemo(
    () => new Map(warehouse.items.map((i) => [i.id, i])),
    [warehouse.items],
  )

  const balances = useMemo(() => computeAllBalances(warehouse), [warehouse])

  const stockLines = useMemo(
    () => recipeStockLines(recipe, balances, itemsById),
    [recipe, balances, itemsById],
  )

  const stockByComponent = useMemo(
    () => new Map(stockLines.map((l) => [l.componentId, l])),
    [stockLines],
  )

  const batchesPossible = useMemo(
    () => maxBatchesFromStock(recipe, balances),
    [recipe, balances],
  )

  const linkedConsume = useMemo(
    () =>
      stockLines.filter((l) => {
        const component = recipe.components.find((c) => c.id === l.componentId)
        return (
          component &&
          !isFormulationWaterComponent(component) &&
          l.warehouseItemId &&
          l.consumeKg > 0
        )
      }),
    [stockLines, recipe.components],
  )

  const outputItem = recipe.outputWarehouseItemId
    ? warehouse.items.find((i) => i.id === recipe.outputWarehouseItemId)
    : undefined

  const previewName = formulationRecipeDisplayName(recipe)

  function patch(p: Partial<FormulationRecipe>) {
    onChange({ ...recipe, ...p })
  }

  function patchComponent(id: string, p: Partial<FormulationComponent>) {
    onChange({
      ...recipe,
      components: recipe.components.map((c) => (c.id === id ? { ...c, ...p } : c)),
    })
  }

  function addComponent() {
    onChange({
      ...recipe,
      components: [...recipe.components, emptyFormulationComponent()],
    })
  }

  function removeComponent(id: string) {
    onChange({
      ...recipe,
      components: recipe.components.filter((c) => c.id !== id),
    })
  }

  function selectWarehouseItem(componentId: string, warehouseItemId: string | undefined) {
    const component = recipe.components.find((c) => c.id === componentId)
    if (component && isFormulationWaterComponent(component)) return
    const item = warehouseItemId ? itemsById.get(warehouseItemId) : undefined
    patchComponent(componentId, {
      warehouseItemId,
      name: item?.name ?? component?.name ?? '',
    })
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={recipe.name.trim() || t('formulation.new')}
      subtitle={recipe.code}
      size="xl"
      blockBackdropClose
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {onDelete ? (
            <button type="button" className="text-sm text-red-600" onClick={onDelete}>
              {t('counterparty.delete')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm"
              onClick={onClose}
            >
              {t('planner.cancel')}
            </button>
            <button
              type="button"
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
              onClick={onSave}
            >
              {t('formulation.saveAndSync')}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-sm border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-stone-700">
          {t('formulation.editorHint')}
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs font-medium text-stone-500 sm:col-span-2 lg:col-span-3">
            {t('formulation.field.name')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('formulation.field.namePlaceholder')}
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('formulation.col.category')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.category}
              onChange={(e) => patch({ category: e.target.value as FormulationCategory })}
            >
              {FORMULATION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ka' ? c.labelKa : c.labelRu}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('formulation.field.variant')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.variantCode ?? ''}
              onChange={(e) => patch({ variantCode: e.target.value || undefined })}
              placeholder="145/2В"
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('formulation.field.grammage')}
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.grammageGsm ?? ''}
              onChange={(e) =>
                patch({ grammageGsm: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('formulation.col.color')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.colorVariant ?? ''}
              onChange={(e) =>
                patch({
                  colorVariant: (e.target.value || undefined) as FormulationColorVariant | undefined,
                })
              }
            >
              <option value="">—</option>
              {FORMULATION_COLOR_VARIANTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ka' ? c.labelKa : c.labelRu}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-500 sm:col-span-2">
            {t('formulation.field.labelText')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.labelText ?? ''}
              onChange={(e) => patch({ labelText: e.target.value || undefined })}
              placeholder={t('formulation.field.labelTextPlaceholder')}
            />
          </label>
        </section>

        {recipe.colorVariant && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-stone-500">{t('formulation.previewColor')}:</span>
            <ProductColorBadge
              productColor={colorVariantToProductColor(recipe.colorVariant)}
              colorLogo={formulationColorLabel(recipe.colorVariant, locale)}
              size="md"
            />
          </div>
        )}

        <section className="rounded-sm border border-sky-200 bg-sky-50/40 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-sky-900">
            {t('formulation.warehouseBlock')}
          </p>
          <p className="mt-1 text-[11px] text-sky-900/80">{t('formulation.warehouseHint')}</p>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold uppercase text-stone-500">
                {t('formulation.warehouseName')}
              </p>
              <p className="mt-1 font-medium leading-snug">{previewName}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-stone-500">
                {t('formulation.warehouseCodes')}
              </p>
              {outputItem ? (
                <p className="mt-1 font-mono text-xs">
                  {outputItem.internalCode}
                  {outputItem.barcode ? ` · EAN ${outputItem.barcode}` : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-stone-500">{t('formulation.warehouseNew')}</p>
              )}
            </div>
          </div>
        </section>

        {linkedConsume.length > 0 && (
          <section
            className={`rounded-sm border px-4 py-3 text-sm ${
              batchesPossible != null && batchesPossible > 0
                ? 'border-emerald-200 bg-emerald-50/50'
                : 'border-amber-200 bg-amber-50/50'
            }`}
          >
            <p className="text-xs font-bold uppercase tracking-wide text-stone-700">
              {t('formulation.stockSummary')}
            </p>
            {batchesPossible != null && batchesPossible > 0 ? (
              <p className="mt-1 text-sm font-medium text-emerald-900">
                {tf('formulation.stockBatchesOk', { n: batchesPossible })}
              </p>
            ) : batchesPossible === 0 ? (
              <p className="mt-1 text-sm font-medium text-amber-900">
                {t('formulation.stockBatchesShort')}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              {linkedConsume.map((l) => (
                <li key={l.componentId} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">{l.name || l.itemName}</span>
                  <span className="tabular-nums">
                    −{l.consumeKg} {l.unit}
                  </span>
                  <span className="text-stone-400">·</span>
                  <span className="tabular-nums">
                    {t('formulation.stockAvailable')}: {l.available} {l.unit}
                  </span>
                  {l.sufficient === false && (
                    <span className="font-medium text-amber-800">
                      ({t('formulation.stockShort')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-ink">{t('formulation.components')}</h4>
            <button
              type="button"
              className="rounded-sm border border-grid px-2.5 py-1 text-xs font-medium hover:bg-stone-50"
              onClick={addComponent}
            >
              + {t('formulation.addComponent')}
            </button>
          </div>
          <div className="mt-2 overflow-x-auto rounded-sm border border-grid">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-stone-50 text-left text-[10px] uppercase text-stone-500">
                <tr>
                  <th className="px-2 py-2">{t('formulation.comp.name')}</th>
                  <th className="px-2 py-2">{t('formulation.comp.whItem')}</th>
                  <th className="px-2 py-2 w-20">{t('formulation.comp.weight')}</th>
                  <th className="px-2 py-2 w-20">{t('formulation.comp.batch')}</th>
                  <th className="px-2 py-2 w-16">{t('formulation.comp.pct')}</th>
                  <th className="px-2 py-2 w-24">{t('formulation.comp.stock')}</th>
                  <th className="px-2 py-2 w-24">{t('formulation.comp.consume')}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {recipe.components.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-xs text-stone-400">
                      {t('formulation.componentsEmpty')}
                    </td>
                  </tr>
                )}
                {recipe.components.map((c) => {
                  const stock = stockByComponent.get(c.id)
                  const consume = componentConsumeKg(c)
                  const isWater = isFormulationWaterComponent(c)
                  return (
                    <tr
                      key={c.id}
                      className={`border-t border-grid/60 ${isWater ? 'bg-sky-50/40' : ''}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          className="w-full min-w-[120px] rounded border border-grid px-2 py-1 text-sm"
                          value={c.name}
                          onChange={(e) => {
                            const name = e.target.value
                            const nextIsWater = name.trim().toLowerCase() === 'вода'
                            patchComponent(c.id, {
                              name,
                              ...(nextIsWater
                                ? { isWater: true, warehouseItemId: undefined }
                                : {}),
                            })
                          }}
                          placeholder={t('formulation.comp.name')}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {isWater ? (
                          <span className="text-xs text-sky-700">{t('formulation.comp.waterHint')}</span>
                        ) : (
                          <select
                            className="w-full min-w-[120px] rounded border border-grid px-2 py-1 text-xs"
                            value={c.warehouseItemId ?? ''}
                            onChange={(e) => selectWarehouseItem(c.id, e.target.value || undefined)}
                          >
                            <option value="">—</option>
                            {componentItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.001}
                          className="w-full rounded border border-grid px-2 py-1 text-sm tabular-nums"
                          value={c.weightKg || ''}
                          onChange={(e) =>
                            patchComponent(c.id, { weightKg: Number(e.target.value) || 0 })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.001}
                          className="w-full rounded border border-grid px-2 py-1 text-sm tabular-nums"
                          value={c.batchKg ?? ''}
                          onChange={(e) =>
                            patchComponent(c.id, {
                              batchKg: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-full rounded border border-grid px-2 py-1 text-sm tabular-nums"
                          value={c.sharePct ?? ''}
                          onChange={(e) =>
                            patchComponent(c.id, {
                              sharePct: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-xs">
                        {isWater ? (
                          <span className="text-stone-400">—</span>
                        ) : stock?.available != null ? (
                          <span
                            className={
                              stock.sufficient === false ? 'font-medium text-amber-800' : ''
                            }
                          >
                            {stock.available} {stock.unit}
                          </span>
                        ) : (
                          <span className="text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-xs font-medium">
                        {isWater ? (
                          '—'
                        ) : consume > 0 ? (
                          <span>
                            −{consume} {stock?.unit ?? 'кг'}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-1 py-1.5">
                        <button
                          type="button"
                          className="text-stone-400 hover:text-red-600"
                          title={t('formulation.removeComponent')}
                          onClick={() => removeComponent(c.id)}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t border-grid bg-stone-50 text-sm font-medium">
                <tr>
                  <td className="px-2 py-2" colSpan={2}>
                    {t('formulation.total')}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{recipeDryBatchKg(recipe)}</td>
                  <td className="px-2 py-2 tabular-nums">{recipeTotalBatchKg(recipe)}</td>
                  <td className="px-2 py-2" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[10px] text-stone-400">{t('formulation.componentsWhHint')}</p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-500 sm:col-span-2">
            {t('formulation.field.note')}
            <textarea
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              rows={2}
              value={recipe.note ?? ''}
              onChange={(e) => patch({ note: e.target.value || undefined })}
              placeholder={t('formulation.field.notePlaceholder')}
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('formulation.field.totalBatch')}
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={recipe.totalBatchKg ?? ''}
              onChange={(e) =>
                patch({ totalBatchKg: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="text-xs font-medium text-accent hover:underline"
              onClick={onOpenNomenclature}
            >
              {t('formulation.openWarehouse')}
            </button>
          </div>
        </section>
      </div>
    </AppDialog>
  )
}

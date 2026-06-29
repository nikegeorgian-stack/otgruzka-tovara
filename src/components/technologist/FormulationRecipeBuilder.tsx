import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
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
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { CreateItemRequestInput } from '@/lib/warehouse/itemRequests'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  recipe: FormulationRecipe
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  operatorId?: string
  operatorName?: string
  onChange: (recipe: FormulationRecipe) => void
  onClose: () => void
  onSave: () => void
  onRequestItem: (input: CreateItemRequestInput) => void
}

export function FormulationRecipeBuilder({
  recipe,
  warehouse,
  categoryNames,
  operatorId,
  operatorName,
  onChange,
  onClose,
  onSave,
  onRequestItem,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [itemSearch, setItemSearch] = useState('')
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestName, setRequestName] = useState('')
  const [requestUnit, setRequestUnit] = useState('кг')
  const [requestNote, setRequestNote] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const componentItems = useMemo(
    () => filterFormulationComponentItems(warehouse.items, categoryNames),
    [warehouse.items, categoryNames],
  )

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase()
    if (!q) return componentItems
    return componentItems.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.internalCode.toLowerCase().includes(q),
    )
  }, [componentItems, itemSearch])

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

  const dryKg = recipeDryBatchKg(recipe)
  const totalKg = recipeTotalBatchKg(recipe)
  const waterKg = Math.max(0, totalKg - dryKg)
  const dryPct = totalKg > 0 ? Math.min(100, (dryKg / totalKg) * 100) : 0

  const unlinkedCount = recipe.components.filter(
    (c) =>
      !isFormulationWaterComponent(c) &&
      componentConsumeKg(c) > 0 &&
      !c.warehouseItemId,
  ).length

  const usedItemIds = useMemo(
    () => new Set(recipe.components.map((c) => c.warehouseItemId).filter(Boolean)),
    [recipe.components],
  )

  function patch(p: Partial<FormulationRecipe>) {
    onChange({ ...recipe, ...p })
  }

  function patchComponent(id: string, p: Partial<FormulationComponent>) {
    onChange({
      ...recipe,
      components: recipe.components.map((c) => (c.id === id ? { ...c, ...p } : c)),
    })
  }

  function addFromWarehouse(itemId: string) {
    const item = itemsById.get(itemId)
    if (!item || usedItemIds.has(itemId)) return
    onChange({
      ...recipe,
      components: [
        ...recipe.components,
        {
          ...emptyFormulationComponent(),
          warehouseItemId: itemId,
          name: item.name,
        },
      ],
    })
    setItemSearch('')
  }

  function addWater() {
    onChange({
      ...recipe,
      components: [
        ...recipe.components,
        { ...emptyFormulationComponent(), name: 'Вода', isWater: true },
      ],
    })
  }

  function removeComponent(id: string) {
    onChange({
      ...recipe,
      components: recipe.components.filter((c) => c.id !== id),
    })
  }

  function trySave() {
    if (!recipe.name.trim()) {
      setSaveError(t('formulation.errName'))
      return
    }
    if (recipe.components.length === 0) {
      setSaveError(t('technologist.recipeErrEmpty'))
      return
    }
    if (unlinkedCount > 0) {
      setSaveError(t('technologist.recipeErrUnlinked'))
      return
    }
    setSaveError(null)
    onSave()
  }

  function submitRequest() {
    if (!operatorId || !operatorName) return
    const name = requestName.trim()
    if (!name) return
    onRequestItem({
      name,
      unit: requestUnit,
      note: requestNote.trim() || undefined,
      recipeCode: recipe.code,
      requestedBy: operatorId,
      requestedByName: operatorName,
    })
    setRequestOpen(false)
    setRequestName('')
    setRequestNote('')
  }

  return (
    <>
      <AppDialog
        open
        onClose={onClose}
        title={recipe.name.trim() || t('formulation.new')}
        subtitle={`${recipe.code} · ${t('technologist.recipeBuilderSubtitle')}`}
        size="xl"
        blockBackdropClose
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-500">{t('technologist.recipeReadOnlyStock')}</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={trySave}>
                {t('formulation.saveAndSync')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {saveError && (
            <FormNotice type="error" message={saveError} onDismiss={() => setSaveError(null)} />
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title={t('technologist.recipeMeta')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={t('formulation.field.name')} className="sm:col-span-2">
                  <Input
                    value={recipe.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    placeholder={t('formulation.field.namePlaceholder')}
                  />
                </FormField>
                <FormField label={t('formulation.col.category')}>
                  <select
                    className="fc-input"
                    value={recipe.category}
                    onChange={(e) => patch({ category: e.target.value as FormulationCategory })}
                  >
                    {FORMULATION_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {locale === 'ka' ? c.labelKa : c.labelRu}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('formulation.field.variant')}>
                  <Input
                    value={recipe.variantCode ?? ''}
                    onChange={(e) => patch({ variantCode: e.target.value || undefined })}
                    placeholder="145/2В"
                  />
                </FormField>
                <FormField label={t('formulation.field.grammage')}>
                  <Input
                    type="number"
                    min={0}
                    value={recipe.grammageGsm ?? ''}
                    onChange={(e) =>
                      patch({ grammageGsm: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                </FormField>
                <FormField label={t('formulation.col.color')}>
                  <select
                    className="fc-input"
                    value={recipe.colorVariant ?? ''}
                    onChange={(e) =>
                      patch({
                        colorVariant: (e.target.value || undefined) as
                          | FormulationColorVariant
                          | undefined,
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
                </FormField>
                <FormField label={t('formulation.field.labelText')} className="sm:col-span-2">
                  <Input
                    value={recipe.labelText ?? ''}
                    onChange={(e) => patch({ labelText: e.target.value || undefined })}
                    placeholder={t('formulation.field.labelTextPlaceholder')}
                  />
                </FormField>
              </div>
              {recipe.colorVariant && (
                <div className="mt-3 flex items-center gap-2">
                  <ProductColorBadge
                    productColor={colorVariantToProductColor(recipe.colorVariant)}
                    colorLogo={formulationColorLabel(recipe.colorVariant, locale)}
                    size="md"
                  />
                </div>
              )}
            </Card>

            <Card title={t('technologist.recipeBatch')}>
              <p className="text-sm font-medium text-ink">{formulationRecipeDisplayName(recipe)}</p>
              <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs text-stone-600">
                  <span>{t('technologist.batchDry')}</span>
                  <span className="tabular-nums font-semibold">{formatQty(dryKg)} кг</span>
                </div>
                <div className="h-2 overflow-hidden rounded-sm bg-stone-200">
                  <div
                    className="h-full rounded-sm bg-amber-500 transition-all"
                    style={{ width: `${dryPct}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-stone-600">
                  <span>{t('technologist.batchWater')}</span>
                  <span className="tabular-nums">{formatQty(waterKg)} кг</span>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold text-teal-900">
                  <span>{t('technologist.batchTotal')}</span>
                  <span className="tabular-nums">{formatQty(totalKg)} л ≈ кг</span>
                </div>
              </div>
              {batchesPossible != null && (
                <p
                  className={`mt-3 text-xs font-medium ${batchesPossible > 0 ? 'text-teal-800' : 'text-amber-800'}`}
                >
                  {batchesPossible > 0
                    ? tf('formulation.stockBatchesOk', { n: batchesPossible })
                    : t('formulation.stockBatchesShort')}
                </p>
              )}
            </Card>
          </div>

          <Card title={t('technologist.recipePickTitle')} description={t('technologist.recipePickHint')}>
            <div className="mb-3 flex flex-wrap gap-2">
              <Input
                className="max-w-md flex-1"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder={t('technologist.recipeSearchStock')}
              />
              <Button variant="secondary" size="sm" onClick={addWater}>
                + {t('technologist.addWater')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setRequestOpen(true)}>
                {t('technologist.requestItem')}
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-sm border border-grid">
              {filteredItems.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-stone-500">
                  {t('technologist.recipeNoStock')}
                </p>
              ) : (
                <ul className="divide-y divide-grid/60">
                  {filteredItems.slice(0, 40).map((item) => {
                    const avail = balances.get(item.id)?.available ?? 0
                    const used = usedItemIds.has(item.id)
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-stone-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.name}</p>
                          <p className="text-xs text-stone-500">
                            {item.internalCode} · {formatQty(avail)} {item.unit}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={used}
                          onClick={() => addFromWarehouse(item.id)}
                        >
                          {used ? '✓' : '+'}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card title={t('formulation.components')}>
            {recipe.components.length === 0 ? (
              <p className="py-8 text-center text-sm text-stone-500">
                {t('technologist.recipeComponentsEmpty')}
              </p>
            ) : (
              <div className="space-y-2">
                {recipe.components.map((c) => {
                  const stock = stockByComponent.get(c.id)
                  const consume = componentConsumeKg(c)
                  const isWater = isFormulationWaterComponent(c)
                  const whItem = !isWater && c.warehouseItemId ? itemsById.get(c.warehouseItemId) : undefined
                  return (
                    <div
                      key={c.id}
                      className={`rounded-sm border px-3 py-3 ${
                        !isWater && !c.warehouseItemId && consume > 0
                          ? 'border-amber-300 bg-amber-50/50'
                          : isWater
                            ? 'border-sky-200 bg-sky-50/30'
                            : 'border-grid bg-white'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink">
                            {(whItem?.name || c.name) || t('formulation.comp.name')}
                          </p>
                          {isWater ? (
                            <p className="text-xs text-sky-700">{t('formulation.comp.waterHint')}</p>
                          ) : whItem ? (
                            <p className="text-xs text-stone-500">{whItem.internalCode}</p>
                          ) : (
                            <p className="text-xs font-medium text-amber-800">
                              {t('technologist.linkOrRequest')}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="text-stone-400 hover:text-red-600"
                          onClick={() => removeComponent(c.id)}
                          aria-label={t('formulation.removeComponent')}
                        >
                          ×
                        </button>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <FormField label={t('formulation.comp.weight')}>
                          <Input
                            type="number"
                            min={0}
                            step={0.001}
                            value={c.weightKg || ''}
                            onChange={(e) =>
                              patchComponent(c.id, { weightKg: Number(e.target.value) || 0 })
                            }
                          />
                        </FormField>
                        <FormField label={t('formulation.comp.batch')}>
                          <Input
                            type="number"
                            min={0}
                            step={0.001}
                            value={c.batchKg ?? ''}
                            onChange={(e) =>
                              patchComponent(c.id, {
                                batchKg: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                          />
                        </FormField>
                        <FormField label={t('formulation.comp.stock')}>
                          <p className="fc-input flex items-center bg-stone-50 text-sm tabular-nums">
                            {isWater
                              ? '—'
                              : stock?.available != null
                                ? `${formatQty(stock.available)} ${stock.unit}`
                                : '—'}
                          </p>
                        </FormField>
                        <FormField label={t('formulation.comp.consume')}>
                          <p className="fc-input flex items-center bg-stone-50 text-sm font-semibold tabular-nums text-teal-900">
                            {isWater ? '—' : consume > 0 ? `−${formatQty(consume)}` : '—'}
                          </p>
                        </FormField>
                      </div>
                      {!isWater && !c.warehouseItemId && (
                        <div className="mt-2">
                          <select
                            className="fc-input text-sm"
                            value=""
                            onChange={(e) => {
                              const id = e.target.value
                              if (!id) return
                              const item = itemsById.get(id)
                              patchComponent(c.id, {
                                warehouseItemId: id,
                                name: item?.name ?? c.name,
                              })
                            }}
                          >
                            <option value="">{t('technologist.pickFromStock')}</option>
                            {componentItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      </AppDialog>

      {requestOpen && (
        <AppDialog
          open
          onClose={() => setRequestOpen(false)}
          title={t('technologist.requestItemTitle')}
          subtitle={t('technologist.requestItemHint')}
          size="md"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRequestOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={submitRequest} disabled={!requestName.trim()}>
                {t('technologist.requestItemSend')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <FormField label={t('technologist.requestItemName')}>
              <Input
                value={requestName}
                onChange={(e) => setRequestName(e.target.value)}
                placeholder={t('technologist.requestItemNamePh')}
                autoFocus
              />
            </FormField>
            <FormField label={t('technologist.requestItemUnit')}>
              <Input value={requestUnit} onChange={(e) => setRequestUnit(e.target.value)} />
            </FormField>
            <FormField label={t('technologist.field.comment')}>
              <Input
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder={t('technologist.requestItemNotePh')}
              />
            </FormField>
          </div>
        </AppDialog>
      )}
    </>
  )
}

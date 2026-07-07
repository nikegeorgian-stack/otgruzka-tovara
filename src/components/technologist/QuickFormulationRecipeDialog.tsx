import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import {
  isFormulationWaterComponent,
  recipeTotalBatchKg,
} from '@/lib/formulations/calc'
import { emptyFormulationComponent } from '@/lib/formulations/init'
import {
  applyCustomGrammage,
  applyGrammageSelection,
  buildGrammageOptions,
  presetForRecipe,
} from '@/lib/formulations/grammages'
import type { FormulationComponent, FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import { formulationCategoryLabel } from '@/lib/formulations/types'
import { filterFormulationComponentItems } from '@/lib/formulations/warehouseSync'
import type { ProductionOrder } from '@/lib/planner/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  order: ProductionOrder
  recipe: FormulationRecipe
  formulationStore: FormulationStore
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  onChange: (recipe: FormulationRecipe) => void
  onClose: () => void
  onSave: () => void
}

export function QuickFormulationRecipeDialog({
  order,
  recipe,
  formulationStore,
  warehouse,
  categoryNames,
  onChange,
  onClose,
  onSave,
}: Props) {
  const { t, tf, locale } = useI18n()
  const [pickId, setPickId] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [customGsm, setCustomGsm] = useState('')
  const [showCustomGsm, setShowCustomGsm] = useState(false)

  const grammageOptions = useMemo(
    () => buildGrammageOptions(formulationStore, locale),
    [formulationStore, locale],
  )

  const selectedPresetId = useMemo(() => presetForRecipe(recipe), [recipe])

  const componentItems = useMemo(
    () => filterFormulationComponentItems(warehouse.items, categoryNames),
    [warehouse.items, categoryNames],
  )

  const itemsById = useMemo(
    () => new Map(warehouse.items.map((i) => [i.id, i])),
    [warehouse.items],
  )

  const usedItemIds = useMemo(
    () => new Set(recipe.components.map((c) => c.warehouseItemId).filter(Boolean)),
    [recipe.components],
  )

  const availableItems = useMemo(
    () => componentItems.filter((i) => !usedItemIds.has(i.id)),
    [componentItems, usedItemIds],
  )

  const totalKg = recipeTotalBatchKg(recipe)

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
    setPickId('')
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

  function applyCustomFromInput() {
    const n = Number(customGsm.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return
    onChange(applyCustomGrammage(recipe, n))
    setShowCustomGsm(false)
    setCustomGsm('')
  }

  function trySave() {
    if (!recipe.name.trim()) {
      setSaveError(t('formulation.errName'))
      return
    }
    if (!recipe.grammageGsm || recipe.grammageGsm <= 0) {
      setSaveError(t('technologist.recipeQuick.errGrammage'))
      return
    }
    if (recipe.components.length === 0) {
      setSaveError(t('technologist.recipeErrEmpty'))
      return
    }
    const bad = recipe.components.some(
      (c) =>
        !isFormulationWaterComponent(c) &&
        (c.weightKg ?? 0) <= 0 &&
        (c.batchKg ?? 0) <= 0,
    )
    if (bad) {
      setSaveError(t('technologist.recipeQuick.errWeight'))
      return
    }
    setSaveError(null)
    onSave()
  }

  return (
    <AppDialog
      open={true}
      onClose={onClose}
      title={t('technologist.recipeQuick.title')}
      subtitle={tf('technologist.recipeQuick.subtitle', {
        order: order.orderNumber || '—',
        product: order.productName,
      })}
      size="md"
      accent
      blockBackdropClose
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-sm tabular-nums text-stone-600">
            {t('technologist.recipeQuick.total')}:{' '}
            <strong className="text-stone-900">{totalKg.toLocaleString('ru-RU')} кг</strong>
            {recipe.grammageGsm ? (
              <span className="ml-2 text-teal-800">
                · {recipe.grammageGsm} {t('technologist.recipeQuick.gsmUnit')}
              </span>
            ) : null}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={trySave}>
              {t('technologist.recipeQuick.saveAssign')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        {saveError && (
          <FormNotice type="error" message={saveError} onDismiss={() => setSaveError(null)} />
        )}

        <div className="rounded-sm border border-stone-200/80 bg-stone-50/90 px-3 py-2 text-sm text-stone-700">
          <div className="font-medium">{order.customer}</div>
          <div className="mt-0.5 text-xs text-stone-500">{recipe.code}</div>
          {order.labelNote && (
            <div className="mt-1 text-xs text-stone-500">{order.labelNote}</div>
          )}
        </div>

        <FormField label={t('formulation.field.name')}>
          <Input
            value={recipe.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder={t('formulation.field.namePlaceholder')}
            autoFocus
          />
        </FormField>

        <FormField
          label={t('formulation.field.grammage')}
          hint={t('technologist.recipeQuick.grammageHint')}
        >
          <div className="flex flex-wrap gap-1.5">
            {grammageOptions.map((opt) => {
              const active =
                selectedPresetId === opt.id ||
                (!selectedPresetId &&
                  recipe.grammageGsm === opt.gsm &&
                  recipe.category === opt.category)
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    active
                      ? 'border-teal-400 bg-teal-50 text-teal-900 shadow-sm'
                      : opt.custom
                        ? 'border-dashed border-stone-300 bg-white text-stone-600 hover:border-teal-300'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-teal-200 hover:bg-teal-50/50'
                  }`}
                  onClick={() => {
                    setShowCustomGsm(false)
                    onChange(applyGrammageSelection(recipe, opt))
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
            <button
              type="button"
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                showCustomGsm
                  ? 'border-teal-400 bg-teal-50 text-teal-900'
                  : 'border-stone-300 bg-white text-stone-600 hover:border-teal-300'
              }`}
              onClick={() => setShowCustomGsm((v) => !v)}
            >
              + {t('technologist.recipeQuick.addGrammage')}
            </button>
          </div>
          {showCustomGsm && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                className="w-28 tabular-nums"
                value={customGsm}
                onChange={(e) => setCustomGsm(e.target.value)}
                placeholder="145"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyCustomFromInput()
                }}
              />
              <span className="text-xs text-stone-500">{t('technologist.recipeQuick.gsmUnit')}</span>
              <Button variant="secondary" size="sm" onClick={applyCustomFromInput}>
                {t('technologist.recipeQuick.applyGrammage')}
              </Button>
            </div>
          )}
          {recipe.grammageGsm ? (
            <p className="mt-1.5 text-xs text-stone-500">
              {formulationCategoryLabel(recipe.category, locale)}
            </p>
          ) : null}
        </FormField>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            {t('technologist.recipeQuick.composition')}
          </p>

          {recipe.components.length === 0 ? (
            <p className="rounded-sm border border-dashed border-stone-200 py-4 text-center text-sm text-stone-500">
              {t('technologist.recipeQuick.empty')}
            </p>
          ) : (
            <div className="overflow-hidden rounded-sm border border-grid">
              <table className="fc-table w-full text-sm">
                <thead>
                  <tr>
                    <th>{t('technologist.recipeQuick.colComponent')}</th>
                    <th className="w-28 text-right">{t('technologist.recipeQuick.colKg')}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {recipe.components.map((c) => {
                    const isWater = isFormulationWaterComponent(c)
                    const whItem =
                      !isWater && c.warehouseItemId
                        ? itemsById.get(c.warehouseItemId)
                        : undefined
                    return (
                      <tr key={c.id}>
                        <td className="py-2">
                          <span className="font-medium">
                            {isWater ? t('technologist.addWater') : whItem?.name ?? c.name}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            min={0}
                            step={0.001}
                            className="ml-auto w-24 text-right tabular-nums"
                            value={c.weightKg || ''}
                            onChange={(e) =>
                              patchComponent(c.id, {
                                weightKg: Number(e.target.value) || 0,
                              })
                            }
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            className="px-1 text-stone-400 hover:text-red-600"
                            onClick={() => removeComponent(c.id)}
                            aria-label={t('formulation.removeComponent')}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="fc-input min-w-[200px] flex-1 text-sm"
              value={pickId}
              onChange={(e) => setPickId(e.target.value)}
            >
              <option value="">{t('technologist.recipeQuick.pickComponent')}</option>
              {availableItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              disabled={!pickId}
              onClick={() => addFromWarehouse(pickId)}
            >
              {t('technologist.recipeQuick.add')}
            </Button>
            <Button variant="secondary" size="sm" onClick={addWater}>
              + {t('technologist.addWater')}
            </Button>
          </div>
        </div>
      </div>
    </AppDialog>
  )
}

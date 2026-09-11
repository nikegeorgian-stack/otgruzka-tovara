import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { labelRuKa } from '@/i18n/localeFormat'
import { MaterialStockHint } from '@/components/planner/MaterialStockHint'
import { RawMaterialPlanField } from '@/components/planner/RawMaterialPlanField'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { ProductColorPicker } from '@/components/ui/ProductColorPicker'
import { useI18n } from '@/context/I18nContext'
import { formatStackDescription } from '@/lib/packaging/calc'
import {
  extractSolidsPct,
  recipeDryBatchKg,
  recipeTotalCost,
} from '@/lib/formulations/calc'
import type { FormulationRecipe } from '@/lib/formulations/types'
import { formulationCategoryLabel } from '@/lib/formulations/types'
import type { BoxRecipe, PackagingPlan, PackagingRecipe } from '@/lib/packaging/types'
import type { DirectorySection } from '@/lib/directories/types'
import type { DirectoryBranchOpts } from '@/hooks/useDirectoryBranch'
import type { Counterparty } from '@/lib/counterparties/types'
import {
  normalizeMeshCell,
  STANDARD_MESH_CELLS,
} from '@/lib/finishedProducts/catalog'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import {
  finishedProductTypeLabel,
} from '@/lib/finishedProducts/types'
import {
  counterpartyOptionsForLoading,
  counterpartyOptionLabel,
} from '@/lib/warehouse/documentValidation'
import { estimatedOrderedRolls, qtyMpFromRolls } from '@/lib/planner/rolls'
import {
  isAreaWarehouseUnit,
  validateProductionOrderWip,
} from '@/lib/planner/activateGate'
import {
  type PlannerPlanMode,
  type PlannerRecalcMode,
  type ProductionOrder,
} from '@/lib/planner/types'
import { PRODUCTION_LINES } from '@/lib/production/types'
import type { WarehouseItem, StockMovement } from '@/lib/warehouse/types'
import { warehouseItemDisplayName } from '@/lib/warehouse/technicalName'
import type { ReactNode } from 'react'

const fieldClass =
  'mt-0.5 w-full rounded-md border border-stone-200 bg-white px-2.5 py-2 text-sm text-ink shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25'
const labelClass = 'block text-[11px] font-semibold uppercase tracking-wide text-stone-500'

type Props = {
  form: ProductionOrder
  setForm: Dispatch<SetStateAction<ProductionOrder>>
  isEdit: boolean
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  formulationRecipes: FormulationRecipe[]
  packagingRecipes: PackagingRecipe[]
  boxRecipes: BoxRecipe[]
  warehouseItems: WarehouseItem[]
  warehouseMovements: StockMovement[]
  warehouseAccounting?: import('@/lib/warehouse/types').WarehouseAccountingState[]
  categoryNames: Map<string, string>
  formPackagingPreview: PackagingPlan | null | undefined
  formForStock: ProductionOrder
  salesBanner?: ReactNode
  onSelectCounterparty: (id: string) => void
  onSelectFinishedProduct: (id: string) => void
  onOpenDirectory: (kind: DirectorySection, opts?: DirectoryBranchOpts) => void
  onSave: () => void
  onCancel: () => void
}

export function PlannerOrderForm({
  form,
  setForm,
  isEdit,
  counterparties,
  finishedProducts,
  formulationRecipes,
  packagingRecipes,
  boxRecipes,
  warehouseItems,
  warehouseMovements,
  warehouseAccounting,
  categoryNames,
  formPackagingPreview,
  formForStock,
  salesBanner,
  onSelectCounterparty,
  onSelectFinishedProduct,
  onOpenDirectory,
  onSave,
  onCancel,
}: Props) {
  const { t, locale } = useI18n()

  const hasExtras = !!(
    form.rawMaterialKind ||
    form.rawMaterialItemId ||
    form.formulationRecipeId ||
    form.packagingRecipeId ||
    form.semiFinishedItemId ||
    form.metersPerRoll
  )
  const [extrasOpen, setExtrasOpen] = useState(hasExtras || !isEdit)

  const customers = useMemo(
    () => counterpartyOptionsForLoading(counterparties),
    [counterparties],
  )

  const counterpartyOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: c.id,
        label: counterpartyOptionLabel(c, t),
      })),
    [customers, t],
  )

  const productOptions = useMemo(
    () =>
      finishedProducts
        .filter((p) => p.active)
        .map((p) => {
          const typ = finishedProductTypeLabel(p.productType, locale)
          const gsm = p.grammageGsm ? `${p.grammageGsm} г/м²` : ''
          const cell = p.meshCellSize ? p.meshCellSize.replace('x', '×') : ''
          const bits = [p.code, p.name, typ !== '—' ? typ : '', gsm, cell].filter(Boolean)
          return { value: p.id, label: bits.join(' · ') }
        }),
    [finishedProducts, locale],
  )

  const selectedProduct = finishedProducts.find((p) => p.id === form.finishedProductId)
  const finishedGoodsItemId = form.warehouseItemId || selectedProduct?.warehouseItemId
  const wipItemOptions = warehouseItems
    .filter(
      (item) =>
        item.active &&
        isAreaWarehouseUnit(item.unit) &&
        (!finishedGoodsItemId || item.id !== finishedGoodsItemId),
    )
    .map((item) => ({
      value: item.id,
      label: `${warehouseItemDisplayName(item)} · ${item.unit}`,
    }))
  const wipGate = validateProductionOrderWip(form, {
    warehouseItems,
    finishedGoodsItemId,
  })
  const selectedCustomer = customers.find((c) => c.id === form.counterpartyId)
  const selectedPackRecipe = packagingRecipes.find((r) => r.id === form.packagingRecipeId)
  const selectedBoxRecipe = boxRecipes.find((r) => r.id === form.boxRecipeId)
  const meshCellOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_MESH_CELLS)
    for (const p of finishedProducts) {
      const n = normalizeMeshCell(p.meshCellSize)
      if (n) set.add(n)
    }
    const current = normalizeMeshCell(form.meshCellSize)
    if (current) set.add(current)
    return [...set]
  }, [finishedProducts, form.meshCellSize])
  const derivedRolls = estimatedOrderedRolls(form.totalQtyMp, form.metersPerRoll)
  const rollsValue = form.orderedRolls ?? derivedRolls ?? ''
  const rollsPerBoxValue =
    form.rollsPerBox ?? selectedBoxRecipe?.rollsPerBox ?? selectedPackRecipe?.rollsPerBox ?? ''

  function patchQtyMp(totalQtyMp: number) {
    setForm((f) => ({
      ...f,
      totalQtyMp,
      orderedRolls: estimatedOrderedRolls(totalQtyMp, f.metersPerRoll) ?? f.orderedRolls,
    }))
  }

  function patchOrderedRolls(raw: string) {
    const n = Number(raw.replace(',', '.'))
    if (raw.trim() === '') {
      setForm((f) => ({ ...f, orderedRolls: undefined }))
      return
    }
    if (!Number.isFinite(n) || n < 0) return
    setForm((f) => {
      const qty = qtyMpFromRolls(n, f.metersPerRoll)
      return {
        ...f,
        orderedRolls: n,
        totalQtyMp: qty ?? f.totalQtyMp,
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200/90 bg-gradient-to-b from-white to-stone-50/80 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="mt-0.5 h-10 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: form.productColor || '#0d9488' }}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-teal-700">
              {isEdit ? t('planner.editOrder') : t('planner.newOrder')}
            </p>
            <h3 className="truncate text-base font-bold text-ink">
              {form.productName?.trim() || form.orderNumber || t('planner.form.untitled')}
            </h3>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {[
                selectedCustomer?.name || form.customer,
                form.meshCellSize ? form.meshCellSize.replace('x', '×') : null,
                form.targetGsm ? `${form.targetGsm} г/м²` : null,
                form.orderedRolls
                  ? `${form.orderedRolls} ${t('planner.rollsUnit')}`
                  : form.totalQtyMp > 0
                    ? `${form.totalQtyMp} ${t('planner.unitMp')}`
                    : null,
              ]
                .filter(Boolean)
                .join(' · ') || t('planner.form.subtitleHint')}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="rounded-md border border-stone-200 bg-white px-3.5 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-50"
            onClick={onCancel}
          >
            {t('planner.cancel')}
          </button>
          <button
            type="button"
            className="rounded-md bg-teal-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-800"
            onClick={onSave}
          >
            {t('planner.save')}
          </button>
        </div>
      </header>

      <div className="space-y-3 p-4">
        {salesBanner}

        <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-stone-600">
              1 · {t('planner.form.section.who')}
            </h4>
            {customers.length === 0 && (
              <button
                type="button"
                className="text-[11px] font-semibold text-amber-800 underline"
                onClick={() => onOpenDirectory('counterparties')}
              >
                {t('planner.form.noCustomers')}
              </button>
            )}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <DirectoryFieldPicker
              label={t('planner.customer')}
              hint={t('planner.customerHintClients')}
              value={form.counterpartyId ?? ''}
              placeholder={t('planner.pickCounterparty')}
              options={counterpartyOptions}
              onChange={onSelectCounterparty}
              onAdd={() => onOpenDirectory('counterparties', { create: true })}
              onOpenJournal={() => onOpenDirectory('counterparties')}
              journalLabel={t('planner.form.journal.customers')}
            />
            <div data-coach="planner:cardProduct">
              <DirectoryFieldPicker
                label={t('planner.product')}
                hint={t('planner.productHint')}
                value={form.finishedProductId ?? ''}
                placeholder={t('planner.pickProduct')}
                options={productOptions}
                onChange={onSelectFinishedProduct}
                onAdd={() => onOpenDirectory('finishedProducts', { create: true })}
                onOpenJournal={() => onOpenDirectory('finishedProducts')}
                journalLabel={t('planner.form.journal.products')}
              />
            </div>
          </div>
          {selectedProduct && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {selectedProduct.productType && (
                <MetaChip
                  label={t('planner.form.productType')}
                  value={finishedProductTypeLabel(selectedProduct.productType, locale)}
                />
              )}
              {selectedProduct.grammageGsm != null && (
                <MetaChip
                  label={t('planner.density')}
                  value={`${selectedProduct.grammageGsm} г/м²`}
                />
              )}
              {selectedProduct.meshCellSize && (
                <MetaChip
                  label={t('planner.meshCell')}
                  value={selectedProduct.meshCellSize.replace('x', '×')}
                />
              )}
              {selectedProduct.metersPerRoll != null && (
                <MetaChip
                  label={t('planner.metersPerRoll')}
                  value={String(selectedProduct.metersPerRoll)}
                />
              )}
            </div>
          )}
          <div className="mt-3 border-t border-stone-100 pt-3">
            <ProductColorPicker
              compact
              productColor={form.productColor}
              colorLogo={form.colorLogo}
              onColorChange={(productColor) => setForm((f) => ({ ...f, productColor }))}
              onLogoChange={(colorLogo) => setForm((f) => ({ ...f, colorLogo }))}
            />
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-stone-600">
            2 · {t('planner.form.section.roll')}
          </h4>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            <label className={labelClass} data-coach="planner:cardQty">
              {t('planner.totalQty')}
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={form.totalQtyMp || ''}
                onChange={(e) => patchQtyMp(Number(e.target.value) || 0)}
              />
            </label>
            <label className={labelClass} data-coach="planner:cardRolls">
              {t('planner.orderedRolls')}
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={rollsValue}
                onChange={(e) => patchOrderedRolls(e.target.value)}
              />
            </label>
            <label className={labelClass}>
              {t('planner.metersPerRoll')}
              <input
                type="number"
                min={0}
                step={0.1}
                className={fieldClass}
                value={form.metersPerRoll ?? ''}
                onChange={(e) => {
                  const metersPerRoll = e.target.value ? Number(e.target.value) : undefined
                  setForm((f) => ({
                    ...f,
                    metersPerRoll,
                    orderedRolls:
                      estimatedOrderedRolls(f.totalQtyMp, metersPerRoll) ?? f.orderedRolls,
                  }))
                }}
              />
            </label>
            <label className={labelClass}>
              {t('planner.density')}
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={form.targetGsm ?? ''}
                placeholder="г/м²"
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    targetGsm: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </label>
            <label className={labelClass} data-coach="planner:cardBox">
              {t('planner.rollsPerBox')}
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={rollsPerBoxValue}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    rollsPerBox: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-3" data-coach="planner:cardMesh">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                {t('planner.meshCell')}
              </p>
              <p className="mb-1.5 text-[10px] text-stone-400">{t('planner.meshCellHint')}</p>
              <div className="flex flex-wrap gap-1">
                {meshCellOptions.map((cell) => {
                  const active = normalizeMeshCell(form.meshCellSize) === cell
                  return (
                    <button
                      key={cell}
                      type="button"
                      className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold tabular-nums ${
                        active
                          ? 'border-teal-700 bg-teal-700 text-white'
                          : 'border-stone-200 bg-white text-stone-700 hover:border-teal-500 hover:bg-teal-50'
                      }`}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          meshCellSize: active ? undefined : cell,
                        }))
                      }
                    >
                      {cell.replace('x', '×')}
                    </button>
                  )
                })}
              </div>
            </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-sm">
          <h4 className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-stone-600">
            3 · {t('planner.form.section.schedule')}
          </h4>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
            <label className={labelClass}>
              {t('planner.startDate')}
              <input
                type="date"
                className={fieldClass}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </label>
            <label className={labelClass}>
              {t('planner.endDate')}
              <input
                type="date"
                className={fieldClass}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </label>
            <label className={labelClass}>
              {t('planner.line')}
              <select
                className={fieldClass}
                value={form.lineId}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    lineId: e.target.value as ProductionOrder['lineId'],
                  }))
                }
              >
                {PRODUCTION_LINES.filter((l) => l.id !== 'pack').map((l) => (
                  <option key={l.id} value={l.id}>
                    {labelRuKa(locale, l.labelRu, l.labelKa)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t('planner.priority')}
              <select
                className={fieldClass}
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    priority: e.target.value as ProductionOrder['priority'],
                  }))
                }
              >
                <option value="normal">{t('planner.priorityNormal')}</option>
                <option value="urgent">{t('planner.priorityUrgent')}</option>
              </select>
            </label>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className={labelClass}>
              {t('planner.planMode')}
              <select
                className={fieldClass}
                value={form.planMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    planMode: e.target.value as PlannerPlanMode,
                  }))
                }
              >
                <option value="even">{t('planner.planModeEven')}</option>
                <option value="manual">{t('planner.planModeManual')}</option>
              </select>
            </label>
            <label className={labelClass}>
              {t('planner.recalcMode')}
              <select
                className={fieldClass}
                value={form.recalcMode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    recalcMode: e.target.value as PlannerRecalcMode,
                  }))
                }
              >
                <option value="auto">{t('planner.recalcAuto')}</option>
                <option value="manual">{t('planner.recalcManual')}</option>
              </select>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 bg-stone-50/90 px-3 py-2.5 text-left hover:bg-stone-100"
            onClick={() => setExtrasOpen((v) => !v)}
            aria-expanded={extrasOpen}
          >
            <span className="text-[11px] font-bold uppercase tracking-wide text-stone-600">
              4 · {t('planner.form.section.extras')}
            </span>
            <span className="text-xs text-stone-400">{extrasOpen ? '▴' : '▾'}</span>
          </button>
          {extrasOpen && (
            <div className="space-y-3 border-t border-stone-100 p-3">
              <RawMaterialPlanField
                compact
                kind={form.rawMaterialKind}
                itemId={form.rawMaterialItemId}
                metersPerRoll={form.metersPerRoll}
                warehouseItems={warehouseItems}
                categoryNames={categoryNames}
                onKindChange={(rawMaterialKind) => setForm((f) => ({ ...f, rawMaterialKind }))}
                onItemChange={(rawMaterialItemId) => setForm((f) => ({ ...f, rawMaterialItemId }))}
                onMetersPerRollChange={(metersPerRoll) => setForm((f) => ({ ...f, metersPerRoll }))}
                onOpenNomenclature={() => onOpenDirectory('nomenclature')}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-[10px] font-semibold uppercase tracking-wide text-teal-700 underline-offset-2 hover:underline"
                  onClick={() => onOpenDirectory('nomenclature')}
                >
                  {t('planner.form.journal.nomenclature')}
                </button>
              </div>

              <div
                className="rounded-md border border-sky-200/80 bg-sky-50/40 p-3"
                data-testid="planner-wip-item"
              >
                <DirectoryFieldPicker
                  label={t('planner.wipItem')}
                  hint={t('planner.wipItemHint')}
                  value={form.semiFinishedItemId ?? ''}
                  placeholder={t('planner.wipItemPick')}
                  options={wipItemOptions}
                  onChange={(id) =>
                    setForm((current) => ({
                      ...current,
                      semiFinishedItemId: id || undefined,
                    }))
                  }
                  onAdd={() => onOpenDirectory('nomenclature', { create: true })}
                  onOpenJournal={() => onOpenDirectory('nomenclature')}
                  journalLabel={t('planner.form.journal.nomenclature')}
                >
                  {!wipGate.ok && (
                    <span className="mt-1 block text-[10px] font-medium text-red-700">
                      {t(wipGate.messageKey)}
                    </span>
                  )}
                </DirectoryFieldPicker>
              </div>

              <div className="rounded-md border border-violet-200/80 bg-violet-50/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-violet-900">
                    {t('planner.formulationBlock')}
                  </p>
                </div>
                <DirectoryFieldPicker
                  label={t('planner.formulationRecipe')}
                  value={form.formulationRecipeId ?? ''}
                  placeholder={t('planner.formulationRecipePick')}
                  options={formulationRecipes
                    .filter((r) => r.active)
                    .map((r) => ({
                      value: r.id,
                      label: [
                        r.code,
                        r.variantCode ?? r.name.slice(0, 36),
                        formulationCategoryLabel(r.category, locale),
                      ].join(' · '),
                    }))}
                  onChange={(id) =>
                    setForm((f) => ({
                      ...f,
                      formulationRecipeId: id || undefined,
                    }))
                  }
                  onAdd={() => onOpenDirectory('formulations', { create: true })}
                  onOpenJournal={() => onOpenDirectory('formulations')}
                  journalLabel={t('planner.form.journal.formulations')}
                />
                {form.formulationRecipeId &&
                  (() => {
                    const fr = formulationRecipes.find((r) => r.id === form.formulationRecipeId)
                    if (!fr) return null
                    return (
                      <p className="mt-2 text-[11px] text-stone-600">
                        {formulationCategoryLabel(fr.category, locale)} · {recipeDryBatchKg(fr)}{' '}
                        {t('formulation.kgDry')} · {recipeTotalCost(fr).toFixed(2)} {fr.currency}
                        {extractSolidsPct(fr.note)
                          ? ` · ${t('formulation.col.solids')} ${extractSolidsPct(fr.note)}`
                          : ''}
                      </p>
                    )
                  })()}
              </div>

              <div className="rounded-md border border-amber-200/80 bg-amber-50/40 p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  {t('planner.packBlock')}
                </p>
                <DirectoryFieldPicker
                  label={t('planner.boxRecipe')}
                  value={form.boxRecipeId ?? ''}
                  placeholder={t('planner.boxRecipePick')}
                  options={boxRecipes
                    .filter((r) => r.active)
                    .map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name} · ${r.rollsPerBox}`,
                    }))}
                  onChange={(id) => {
                    const box = boxRecipes.find((r) => r.id === id)
                    setForm((f) => ({
                      ...f,
                      boxRecipeId: id || undefined,
                      rollsPerBox: box?.rollsPerBox ?? f.rollsPerBox,
                      boxItemId: box?.boxItemId ?? f.boxItemId,
                      meshCellSize: box?.meshCellSize ?? f.meshCellSize,
                    }))
                  }}
                  onAdd={() => onOpenDirectory('packagingRecipes', { create: true })}
                  onOpenJournal={() => onOpenDirectory('packagingRecipes')}
                  journalLabel={t('planner.form.journal.packaging')}
                />
                <DirectoryFieldPicker
                  label={t('planner.packRecipe')}
                  value={form.packagingRecipeId ?? ''}
                  placeholder={t('planner.packRecipePick')}
                  options={packagingRecipes
                    .filter((r) => r.active)
                    .map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name}`,
                    }))}
                  onChange={(id) => {
                    const recipe = packagingRecipes.find((r) => r.id === id)
                    setForm((f) => ({
                      ...f,
                      packagingRecipeId: id || undefined,
                      rollsPerBox: f.boxRecipeId
                        ? f.rollsPerBox
                        : recipe?.rollsPerBox || f.rollsPerBox,
                    }))
                  }}
                  onAdd={() => onOpenDirectory('packagingRecipes', { create: true })}
                  onOpenJournal={() => onOpenDirectory('packagingRecipes')}
                  journalLabel={t('planner.form.journal.packaging')}
                />
                {form.packagingRecipeId &&
                  (() => {
                    const recipe = packagingRecipes.find((r) => r.id === form.packagingRecipeId)
                    return recipe ? (
                      <p className="mt-2 text-[11px] text-stone-600">
                        {formatStackDescription(recipe, locale)}
                      </p>
                    ) : null
                  })()}
                {formPackagingPreview && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5 text-[11px]">
                    {(
                      [
                        ['planner.packRolls', formPackagingPreview.rawRollsEstimated],
                        ['planner.packPallets', formPackagingPreview.palletsNeeded],
                        ['planner.packBoxes', formPackagingPreview.boxesNeeded],
                        ['planner.packPerPallet', formPackagingPreview.rollsPerPallet],
                      ] as const
                    ).map(([key, val]) => (
                      <div
                        key={key}
                        className="rounded-md border border-stone-200 bg-white px-1.5 py-1"
                      >
                        <span className="text-stone-400">{t(key)}</span>
                        <p className="font-semibold tabular-nums text-ink">{val}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 border-t border-amber-200/50 pt-2">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                    {t('planner.material.blockTitle')}
                  </p>
                  <MaterialStockHint
                    order={formForStock}
                    warehouseItems={warehouseItems}
                    warehouseMovements={warehouseMovements}
                    warehouseAccounting={warehouseAccounting}
                  />
                </div>
              </div>
            </div>
          )}
        </section>

        <label className={labelClass}>
          {t('planner.note')}
          <textarea
            className={fieldClass}
            rows={2}
            value={form.note ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
        </label>
      </div>

      <footer className="flex gap-2 border-t border-stone-200 bg-white px-4 py-3">
        <button
          type="button"
          className="flex-1 rounded-md bg-teal-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-teal-800"
          onClick={onSave}
        >
          {t('planner.save')}
        </button>
        <button
          type="button"
          className="rounded-md border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50"
          onClick={onCancel}
        >
          {t('planner.cancel')}
        </button>
      </footer>
    </div>
  )
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-700">
      <span className="text-stone-400">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  )
}

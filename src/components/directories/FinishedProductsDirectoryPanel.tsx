import { useMemo, useState } from 'react'
import { useWorkspaceDraftRestore } from '@/hooks/useWorkspaceDraftRestore'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { ProductColorPicker } from '@/components/ui/ProductColorPicker'
import { WarehouseItemSelect } from '@/components/ui/WarehouseItemSelect'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import type { Counterparty } from '@/lib/counterparties/types'
import {
  emptyFinishedProduct,
  nextFinishedProductCode,
} from '@/lib/finishedProducts/init'
import { buildFinishedProductStockRows } from '@/lib/finishedProducts/stock'
import type { FinishedProduct, FinishedProductStore } from '@/lib/finishedProducts/types'
import {
  FINISHED_PRODUCT_TYPES,
  finishedProductTypeLabel,
  productTypeToRawKind,
} from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { PackagingRecipe } from '@/lib/packaging/types'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  plannerCategoryLabel,
  PLANNER_ORDER_CATEGORIES,
} from '@/lib/planner/types'
import type { PlannerOrderCategory } from '@/lib/planner/types'
import type { DirectorySection } from '@/lib/directories/types'
import type { ProductionRequest } from '@/lib/production/types'
import { formatNum } from '@/lib/production/stats'
import { computeAllBalances } from '@/lib/warehouse/stock'
import { compressItemPhoto } from '@/lib/warehouse/itemPhoto'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { RollWidthQuickPick } from '@/components/ui/RollWidthQuickPick'

type Props = {
  store: FinishedProductStore
  counterparties: Counterparty[]
  packagingRecipes: PackagingRecipe[]
  formulationRecipes: FormulationRecipe[]
  warehouse: WarehouseStore
  plannerOrders: ProductionOrder[]
  productionRequests: ProductionRequest[]
  onUpsert: (p: FinishedProduct) => void
  onRemove: (id: string) => void
  onOpenDirectory?: (section: DirectorySection) => void
  onBranchDirectory?: (
    section: DirectorySection,
    from: { title: string; draftKey: string; draft: unknown },
  ) => void
  onClearWorkspaceDraft?: (draftKey: string) => void
  workspaceRestoreSeq?: number
  workspaceDrafts?: Record<string, unknown>
}

export function FinishedProductsDirectoryPanel({
  store,
  counterparties,
  packagingRecipes,
  formulationRecipes,
  warehouse,
  plannerOrders,
  productionRequests,
  onUpsert,
  onRemove,
  onOpenDirectory,
  onBranchDirectory,
  onClearWorkspaceDraft,
  workspaceRestoreSeq = 0,
  workspaceDrafts = {},
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const DRAFT_KEY = 'finishedProduct-edit'
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<FinishedProduct | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  useWorkspaceDraftRestore<FinishedProduct>(
    DRAFT_KEY,
    (draft) => setEditing({ ...draft }),
    workspaceRestoreSeq,
    workspaceDrafts,
  )

  function goDirectory(section: DirectorySection) {
    if (editing && onBranchDirectory) {
      onBranchDirectory(section, {
        title: editing.name || t('finishedProduct.new'),
        draftKey: DRAFT_KEY,
        draft: editing,
      })
      return
    }
    onOpenDirectory?.(section)
  }

  function closeEditing() {
    setEditing(null)
    onClearWorkspaceDraft?.(DRAFT_KEY)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return store.items.filter((p) => p.active)
    return store.items.filter(
      (p) =>
        p.active &&
        (p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          finishedProductTypeLabel(p.productType, locale).toLowerCase().includes(q)),
    )
  }, [store.items, search, locale])

  const stockRows = useMemo(() => {
    const balances = computeAllBalances(warehouse)
    return buildFinishedProductStockRows(
      store.items,
      plannerOrders,
      productionRequests,
      balances,
    )
  }, [store.items, plannerOrders, productionRequests, warehouse])

  const warehouseItemOptions = useMemo(
    () => warehouse.items.filter((i) => i.active),
    [warehouse.items],
  )

  function openNew() {
    setEditing(emptyFinishedProduct(store))
  }

  function patch(partial: Partial<FinishedProduct>) {
    setEditing((e) => (e ? { ...e, ...partial } : e))
  }

  function onProductTypeChange(productType: FinishedProduct['productType']) {
    setEditing((e) =>
      e
        ? {
            ...e,
            productType,
            rawMaterialKind: productType ? productTypeToRawKind(productType) : undefined,
          }
        : e,
    )
  }

  async function onLabelPhoto(file: File | undefined) {
    if (!file || !editing) return
    setPhotoBusy(true)
    try {
      const labelPhotoDataUrl = await compressItemPhoto(file)
      patch({ labelPhotoDataUrl, labelPhotoName: file.name })
    } catch {
      setNotice(t('finishedProduct.labelPhotoError'))
    } finally {
      setPhotoBusy(false)
    }
  }

  function save() {
    if (!editing) return
    if (!editing.name.trim()) {
      setNotice(t('finishedProduct.errName'))
      return
    }
    if (!editing.productType) {
      setNotice(t('finishedProduct.errType'))
      return
    }
    onUpsert({
      ...editing,
      code: editing.code || nextFinishedProductCode(store),
      rawMaterialKind: editing.productType
        ? productTypeToRawKind(editing.productType)
        : editing.rawMaterialKind,
      updatedAt: new Date().toISOString(),
    })
    closeEditing()
    setNotice(t('finishedProduct.saved'))
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="min-w-[200px] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('finishedProduct.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-add" onClick={openNew}>
          {t('finishedProduct.add')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('finishedProduct.col.code')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.name')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.type')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.grammage')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.rollWidth')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.category')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.color')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.label')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-stone-500">
                  {t('finishedProduct.empty')}
                </td>
              </tr>
            )}
            {filtered.map((p) => (
              <tr key={p.id} className="border-t border-grid/60 hover:bg-stone-50/50">
                <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">{finishedProductTypeLabel(p.productType, locale)}</td>
                <td className="px-4 py-3 tabular-nums">
                  {p.grammageGsm ? `${p.grammageGsm} ${t('finishedProduct.gsmUnit')}` : '—'}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {p.rollWidthM ? `${p.rollWidthM} м` : '—'}
                </td>
                <td className="px-4 py-3">{plannerCategoryLabel(p.category, locale)}</td>
                <td className="px-4 py-3">
                  <ProductColorBadge
                    productColor={p.productColor}
                    colorLogo={p.colorLogo}
                    size="md"
                  />
                </td>
                <td className="px-4 py-3">
                  {p.labelPhotoDataUrl ? (
                    <img
                      src={p.labelPhotoDataUrl}
                      alt=""
                      className="h-8 w-12 rounded border border-grid object-cover"
                    />
                  ) : (
                    <span className="text-stone-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="text-sm font-medium text-accent hover:underline"
                    onClick={() => setEditing({ ...p })}
                  >
                    {t('counterparty.open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-sm border border-grid bg-white shadow-sm">
        <div className="border-b border-grid px-4 py-3">
          <h3 className="text-sm font-bold text-ink">{t('finishedProduct.sectionStock')}</h3>
          <p className="mt-0.5 text-xs text-stone-500">{t('finishedProduct.stockHint')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-4 py-3">{t('finishedProduct.col.color')}</th>
                <th className="px-4 py-3">{t('finishedProduct.col.name')}</th>
                <th className="px-4 py-3">{t('finishedProduct.stockOnWarehouse')}</th>
                <th className="px-4 py-3">{t('finishedProduct.stockProduced')}</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-stone-500">
                    {t('finishedProduct.empty')}
                  </td>
                </tr>
              )}
              {stockRows.map((row) => {
                const whItem = row.product.warehouseItemId
                  ? warehouse.items.find((i) => i.id === row.product.warehouseItemId)
                  : undefined
                return (
                  <tr
                    key={row.product.id}
                    className="border-t border-grid/60 hover:bg-stone-50/50"
                  >
                    <td className="px-4 py-3">
                      <ProductColorBadge
                        productColor={row.product.productColor}
                        colorLogo={row.product.colorLogo}
                        size="md"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.product.name}</p>
                      <p className="font-mono text-xs text-stone-400">{row.product.code}</p>
                      {whItem && (
                        <p className="mt-0.5 text-xs text-stone-500">{whItem.name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.product.warehouseItemId ? (
                        <>
                          {formatNum(row.warehouseBalance ?? 0)} {t('planner.unitMp')}
                          {row.warehouseAvailable !== undefined &&
                            row.warehouseAvailable !== row.warehouseBalance && (
                              <span className="ml-1 text-xs text-stone-400">
                                ({t('finishedProduct.stockAvailable')}{' '}
                                {formatNum(row.warehouseAvailable)})
                              </span>
                            )}
                        </>
                      ) : (
                        <span className="text-xs text-stone-400">
                          {t('finishedProduct.stockNoLink')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {formatNum(row.producedMp)} {t('planner.unitMp')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <ModalBackdrop
          open
          onClose={closeEditing}
          className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
          panelClassName="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-sm border border-grid bg-white p-5 shadow-sm"
        >
            <h3 className="text-lg font-bold text-ink">
              {editing.name || t('finishedProduct.new')}
            </h3>
            <p className="mb-4 font-mono text-xs text-stone-500">{editing.code}</p>

            <div className="space-y-5">
              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                  {t('finishedProduct.sectionMain')}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('finishedProduct.name')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('finishedProduct.productType')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.productType ?? ''}
                      onChange={(e) =>
                        onProductTypeChange(
                          (e.target.value || undefined) as FinishedProduct['productType'],
                        )
                      }
                    >
                      <option value="">{t('finishedProduct.productTypePick')}</option>
                      {FINISHED_PRODUCT_TYPES.map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {locale === 'ka' ? pt.labelKa : pt.labelRu}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('finishedProduct.grammage')}
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder="120"
                      value={editing.grammageGsm ?? ''}
                      onChange={(e) =>
                        patch({
                          grammageGsm: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </label>
                </div>
              </section>

              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                  {t('finishedProduct.sectionProduction')}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-stone-500">
                    {t('finishedProduct.category')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.category}
                      onChange={(e) =>
                        patch({ category: e.target.value as PlannerOrderCategory })
                      }
                    >
                      {PLANNER_ORDER_CATEGORIES.map((c) => (
                        <option key={c.key} value={c.key}>
                          {plannerCategoryLabel(c.key, locale)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('finishedProduct.metersPerRoll')}
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={editing.metersPerRoll ?? ''}
                      onChange={(e) =>
                        patch({
                          metersPerRoll: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-500">
                    {t('finishedProduct.rollWidthM')}
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder={t('finishedProduct.rollWidthMPh')}
                      value={editing.rollWidthM ?? ''}
                      onChange={(e) =>
                        patch({
                          rollWidthM: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                    <span className="mt-1 block text-[10px] text-stone-400">
                      {t('finishedProduct.rollWidthMHint')}
                    </span>
                    <RollWidthQuickPick
                      value={editing.rollWidthM}
                      onPick={(rollWidthM) => patch({ rollWidthM })}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <ProductColorPicker
                      productColor={editing.productColor}
                      colorLogo={editing.colorLogo}
                      onColorChange={(productColor) => patch({ productColor })}
                      onLogoChange={(colorLogo) => patch({ colorLogo })}
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-sm border border-amber-200/80 bg-amber-50/40 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                  {t('finishedProduct.sectionLabel')}
                </p>
                <p className="mt-1 text-xs text-stone-500">{t('finishedProduct.labelHint')}</p>
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  {editing.labelPhotoDataUrl ? (
                    <img
                      src={editing.labelPhotoDataUrl}
                      alt=""
                      className="h-24 w-36 rounded-sm border border-grid object-contain bg-white"
                    />
                  ) : (
                    <div className="flex h-24 w-36 items-center justify-center rounded-sm border border-dashed border-grid bg-white text-xs text-stone-400">
                      {t('finishedProduct.labelEmpty')}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="btn-add-outline cursor-pointer px-4 py-2 text-sm">
                      {photoBusy ? '…' : t('finishedProduct.labelUpload')}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={photoBusy}
                        onChange={(e) => void onLabelPhoto(e.target.files?.[0])}
                      />
                    </label>
                    {editing.labelPhotoDataUrl && (
                      <button
                        type="button"
                        className="text-xs text-red-600 hover:underline"
                        onClick={() =>
                          patch({ labelPhotoDataUrl: undefined, labelPhotoName: undefined })
                        }
                      >
                        {t('finishedProduct.labelRemove')}
                      </button>
                    )}
                    {editing.labelPhotoName && (
                      <p className="max-w-[12rem] truncate text-xs text-stone-500">
                        {editing.labelPhotoName}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
                  {t('finishedProduct.sectionLinks')}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <DirectoryFieldPicker
                    label={t('finishedProduct.defaultCustomer')}
                    value={editing.defaultCounterpartyId ?? ''}
                    placeholder="—"
                    options={counterparties
                      .filter((c) => c.active)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.code} · ${c.name}`,
                      }))}
                    onChange={(id) =>
                      patch({ defaultCounterpartyId: id || undefined })
                    }
                    onAdd={() => goDirectory('counterparties')}
                  />
                  <DirectoryFieldPicker
                    label={t('finishedProduct.defaultPackaging')}
                    value={editing.defaultPackagingRecipeId ?? ''}
                    placeholder="—"
                    options={packagingRecipes
                      .filter((r) => r.active)
                      .map((r) => ({
                        value: r.id,
                        label: `${r.code} · ${r.name}`,
                      }))}
                    onChange={(id) =>
                      patch({ defaultPackagingRecipeId: id || undefined })
                    }
                    onAdd={() => goDirectory('packagingRecipes')}
                  />
                  <div className="sm:col-span-2">
                    <DirectoryFieldPicker
                      label={t('finishedProduct.defaultFormulation')}
                      value={editing.defaultFormulationRecipeId ?? ''}
                      placeholder="—"
                      options={formulationRecipes
                        .filter((r) => r.active)
                        .map((r) => ({
                          value: r.id,
                          label: `${r.code} · ${r.variantCode ?? r.name.slice(0, 50)}`,
                        }))}
                      onChange={(id) =>
                        patch({ defaultFormulationRecipeId: id || undefined })
                      }
                      onAdd={() => goDirectory('formulations')}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <WarehouseItemSelect
                      label={t('finishedProduct.warehouseSku')}
                      hint={t('finishedProduct.warehouseSkuHint')}
                      value={editing.warehouseItemId ?? ''}
                      options={warehouseItemOptions}
                      placeholder={t('finishedProduct.warehouseSkuPick')}
                      onChange={(warehouseItemId) =>
                        patch({ warehouseItemId: warehouseItemId || undefined })
                      }
                      onAdd={() => goDirectory('nomenclature')}
                    />
                  </div>
                  <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                    {t('finishedProduct.note')}
                    <textarea
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      rows={2}
                      value={editing.note ?? ''}
                      onChange={(e) => patch({ note: e.target.value })}
                    />
                  </label>
                </div>
              </section>
            </div>

            <div className="mt-5 flex justify-between gap-2 border-t border-grid pt-4">
              <button
                type="button"
                className="text-sm text-red-600"
                onClick={async () => {
                  if (editing.id && (await confirm({ message: t('finishedProduct.deleteConfirm'), danger: true }))) {
                    onRemove(editing.id)
                    closeEditing()
                  }
                }}
              >
                {t('counterparty.delete')}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-sm border border-grid px-4 py-2 text-sm"
                  onClick={closeEditing}
                >
                  {t('planner.cancel')}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
                  onClick={save}
                >
                  {t('planner.save')}
                </button>
              </div>
            </div>
        </ModalBackdrop>
      )}
    </div>
  )
}

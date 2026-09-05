import { useEffect, useMemo, useRef, useState } from 'react'
import { consumeDirectoryOpenIntent } from '@/lib/directories/openIntent'
import { suggestLocalizedNames } from '@/lib/i18n/localizedNames'
import { useWorkspaceDraftRestore } from '@/hooks/useWorkspaceDraftRestore'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { ExtensibleCatalogField } from '@/components/ui/ExtensibleCatalogField'
import { FormNotice } from '@/components/ui/FormNotice'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { ProductColorPicker } from '@/components/ui/ProductColorPicker'
import { WarehouseItemSelect } from '@/components/ui/WarehouseItemSelect'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import type { Counterparty } from '@/lib/counterparties/types'
import {
  buildGrammageOptionsGsm,
  buildMeshCellOptions,
  buildProductTypeOptions,
  buildRollWidthOptionsM,
  normalizeMeshCell,
  plannerCategoryForGsm,
  slugProductTypeId,
} from '@/lib/finishedProducts/catalog'
import {
  emptyFinishedProduct,
  nextFinishedProductCode,
} from '@/lib/finishedProducts/init'
import { buildFinishedProductStockRows } from '@/lib/finishedProducts/stock'
import type {
  FinishedProduct,
  FinishedProductStore,
  FinishedProductTypeDef,
} from '@/lib/finishedProducts/types'
import {
  finishedProductTypeLabel,
  productTypeToRawKind,
} from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type { BoxRecipe, PackagingRecipe } from '@/lib/packaging/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { DirectorySection } from '@/lib/directories/types'
import type { ProductionRequest } from '@/lib/production/types'
import { formatNum } from '@/lib/production/stats'
import { computeAllBalances } from '@/lib/warehouse/stock'
import { compressItemPhoto } from '@/lib/warehouse/itemPhoto'
import type { WarehouseStore } from '@/lib/warehouse/types'

type DraftCatalog = {
  types: FinishedProductTypeDef[]
  gsm: number[]
  widths: number[]
  cells: string[]
}

const EMPTY_DRAFT_CATALOG: DraftCatalog = { types: [], gsm: [], widths: [], cells: [] }

type Props = {
  store: FinishedProductStore
  counterparties: Counterparty[]
  packagingRecipes: PackagingRecipe[]
  boxRecipes: BoxRecipe[]
  formulationRecipes: FormulationRecipe[]
  warehouse: WarehouseStore
  plannerOrders: ProductionOrder[]
  productionRequests: ProductionRequest[]
  onUpsert: (p: FinishedProduct) => void
  onPatchCatalog?: (
    patch: Partial<
      Pick<
        FinishedProductStore,
        'productTypeRegistry' | 'grammageRegistry' | 'rollWidthRegistry' | 'meshCellRegistry'
      >
    >,
  ) => void
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
  boxRecipes,
  formulationRecipes,
  warehouse,
  plannerOrders,
  productionRequests,
  onUpsert,
  onPatchCatalog,
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
  const [customerFilter, setCustomerFilter] = useState<string>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<FinishedProduct | null>(null)
  const nameKaManualRef = useRef(false)
  const nameEnManualRef = useRef(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [draftCatalog, setDraftCatalog] = useState<DraftCatalog>(EMPTY_DRAFT_CATALOG)

  const catalogStore = useMemo(
    (): FinishedProductStore => ({
      ...store,
      productTypeRegistry: [
        ...(store.productTypeRegistry ?? []),
        ...draftCatalog.types,
      ],
      grammageRegistry: [...(store.grammageRegistry ?? []), ...draftCatalog.gsm],
      rollWidthRegistry: [...(store.rollWidthRegistry ?? []), ...draftCatalog.widths],
      meshCellRegistry: [...(store.meshCellRegistry ?? []), ...draftCatalog.cells],
    }),
    [store, draftCatalog],
  )

  const typeOptions = useMemo(
    () => buildProductTypeOptions(catalogStore, locale),
    [catalogStore, locale],
  )
  const gsmOptions = useMemo(
    () => buildGrammageOptionsGsm(catalogStore),
    [catalogStore],
  )
  const widthOptions = useMemo(
    () => buildRollWidthOptionsM(catalogStore),
    [catalogStore],
  )
  const meshCellOptions = useMemo(
    () =>
      buildMeshCellOptions(catalogStore).map((id) => ({
        id,
        label: id.replace('x', '×'),
      })),
    [catalogStore],
  )

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
    setDraftCatalog(EMPTY_DRAFT_CATALOG)
    onClearWorkspaceDraft?.(DRAFT_KEY)
  }

  const customerById = useMemo(() => {
    const m = new Map<string, Counterparty>()
    for (const c of counterparties) m.set(c.id, c)
    return m
  }, [counterparties])

  const customerOptions = useMemo(
    () =>
      counterparties
        .filter((c) => c.active)
        .map((c) => ({
          value: c.id,
          label: `${c.code} · ${c.name}`,
        })),
    [counterparties],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const active = store.items.filter((p) => p.active)
    const byCustomer =
      customerFilter === 'all'
        ? active
        : active.filter((p) => p.defaultCounterpartyId === customerFilter)
    const list = !q
      ? byCustomer
      : byCustomer.filter((p) => {
          const customerName = p.defaultCounterpartyId
            ? (customerById.get(p.defaultCounterpartyId)?.name ?? '')
            : ''
          return (
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            customerName.toLowerCase().includes(q) ||
            finishedProductTypeLabel(p.productType, locale, store)
              .toLowerCase()
              .includes(q)
          )
        })
    return [...list].sort((a, b) => {
      const ca = a.defaultCounterpartyId
        ? (customerById.get(a.defaultCounterpartyId)?.name ?? '')
        : ''
      const cb = b.defaultCounterpartyId
        ? (customerById.get(b.defaultCounterpartyId)?.name ?? '')
        : ''
      return ca.localeCompare(cb, 'ru') || a.name.localeCompare(b.name, 'ru')
    })
  }, [store, search, locale, customerFilter, customerById])

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
    nameKaManualRef.current = false
    nameEnManualRef.current = false
    setDraftCatalog(EMPTY_DRAFT_CATALOG)
    setEditing(emptyFinishedProduct(store))
  }

  useEffect(() => {
    const intent = consumeDirectoryOpenIntent('finishedProducts')
    if (intent?.create) openNew()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function patch(partial: Partial<FinishedProduct>) {
    setEditing((e) => (e ? { ...e, ...partial } : e))
  }

  function onNameChange(name: string) {
    const { ka, en } = suggestLocalizedNames(name, 'product')
    const next: Partial<FinishedProduct> = { name }
    if (!nameKaManualRef.current) next.nameKa = ka
    if (!nameEnManualRef.current) next.nameEn = en
    patch(next)
  }

  function onProductTypeChange(productType: FinishedProduct['productType']) {
    setEditing((e) =>
      e
        ? {
            ...e,
            productType,
            rawMaterialKind: productTypeToRawKind(productType) ?? e.rawMaterialKind,
          }
        : e,
    )
  }

  function registerTypeLabel(label: string) {
    const id = slugProductTypeId(label)
    const def: FinishedProductTypeDef = { id, labelRu: label.trim() }
    setDraftCatalog((d) => {
      if (d.types.some((x) => x.id === id) || typeOptions.some((x) => x.id === id)) {
        return d
      }
      return { ...d, types: [...d.types, def] }
    })
    onPatchCatalog?.({ productTypeRegistry: [def] })
    onProductTypeChange(id)
  }

  function onGrammagePick(gsm: number | undefined) {
    const next: Partial<FinishedProduct> = { grammageGsm: gsm }
    if (gsm && gsm > 0) {
      const cat = plannerCategoryForGsm(gsm)
      if (cat) next.category = cat
    }
    patch(next)
  }

  function registerGsm(gsm: number) {
    setDraftCatalog((d) =>
      d.gsm.includes(gsm) ? d : { ...d, gsm: [...d.gsm, gsm].sort((a, b) => a - b) },
    )
    onPatchCatalog?.({ grammageRegistry: [gsm] })
    onGrammagePick(gsm)
  }

  function registerWidth(w: number) {
    setDraftCatalog((d) =>
      d.widths.some((x) => Math.abs(x - w) < 0.001)
        ? d
        : { ...d, widths: [...d.widths, w].sort((a, b) => a - b) },
    )
    onPatchCatalog?.({ rollWidthRegistry: [w] })
    patch({ rollWidthM: w })
  }

  function onMeshCellPick(value: string | undefined) {
    patch({ meshCellSize: normalizeMeshCell(value) })
  }

  function registerMeshCell(label: string) {
    const cell = normalizeMeshCell(label)
    if (!cell) return
    setDraftCatalog((d) => (d.cells.includes(cell) ? d : { ...d, cells: [...d.cells, cell] }))
    onPatchCatalog?.({ meshCellRegistry: [cell] })
    onMeshCellPick(cell)
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
    if (!editing.defaultCounterpartyId) {
      setNotice(t('finishedProduct.errCustomer'))
      return
    }
    // Категория выработки — служебная (связь план↔факт), не ввод пользователя:
    // подставляем от граммовки при сохранении.
    const categoryFromGsm =
      editing.grammageGsm && editing.grammageGsm > 0
        ? plannerCategoryForGsm(editing.grammageGsm)
        : undefined
    onUpsert({
      ...editing,
      category: categoryFromGsm ?? editing.category ?? 'ratl1',
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
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          aria-label={t('finishedProduct.col.customer')}
        >
          <option value="all">{t('finishedProduct.filterAllCustomers')}</option>
          {customerOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn-add" onClick={openNew} data-coach="directories:finishedProductAdd">
          {t('finishedProduct.add')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('finishedProduct.col.customer')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.name')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.type')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.grammage')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.color')}</th>
              <th className="px-4 py-3">{t('finishedProduct.col.label')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-stone-500">
                  {t('finishedProduct.empty')}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const customer = p.defaultCounterpartyId
                ? customerById.get(p.defaultCounterpartyId)
                : undefined
              return (
              <tr key={p.id} className="border-t border-grid/60 hover:bg-stone-50/50">
                <td className="px-4 py-3">
                  {customer ? (
                    <span className="font-medium text-stone-800">{customer.name}</span>
                  ) : (
                    <span className="text-xs text-amber-700">{t('finishedProduct.noCustomer')}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-xs text-stone-400">{p.code}</div>
                </td>
                <td className="px-4 py-3">{finishedProductTypeLabel(p.productType, locale, store)}</td>
                <td className="px-4 py-3 tabular-nums">
                  {p.grammageGsm ? `${p.grammageGsm} ${t('finishedProduct.gsmUnit')}` : '—'}
                </td>
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
                    onClick={() => {
                      nameKaManualRef.current = !!p.nameKa?.trim()
                      nameEnManualRef.current = !!p.nameEn?.trim()
                      setDraftCatalog(EMPTY_DRAFT_CATALOG)
                      setEditing({ ...p })
                    }}
                  >
                    {t('counterparty.open')}
                  </button>
                </td>
              </tr>
              )
            })}
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
          panelClassName="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-stone-200 bg-stone-50 p-0 shadow-xl"
        >
          <div className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 px-5 py-3 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-teal-800">
                  {t('finishedProduct.badge')}
                </p>
                <h3 className="truncate text-lg font-bold text-ink">
                  {editing.name.trim() || t('finishedProduct.new')}
                </h3>
                <p className="truncate text-xs text-stone-600">
                  {editing.defaultCounterpartyId
                    ? customerById.get(editing.defaultCounterpartyId)?.name ?? '—'
                    : t('finishedProduct.noCustomer')}
                  <span className="ml-2 font-mono text-stone-400">{editing.code}</span>
                </p>
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-lg leading-none text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                onClick={closeEditing}
                aria-label={t('planner.cancel')}
              >
                ×
              </button>
            </div>
          </div>

          <div className="space-y-4 p-5">
            <section className="rounded-lg border border-teal-200 bg-teal-50/40 p-4 shadow-sm" data-coach="directories:finishedProductCustomer">
              <p className="text-[11px] font-bold uppercase tracking-wide text-teal-900">
                {t('finishedProduct.sectionCustomer')}
              </p>
              <p className="mt-1 text-xs text-stone-600">{t('finishedProduct.customerHint')}</p>
              <div className="mt-3 space-y-3">
                <DirectoryFieldPicker
                  label={t('finishedProduct.defaultCustomer')}
                  value={editing.defaultCounterpartyId ?? ''}
                  placeholder={t('finishedProduct.customerPick')}
                  options={customerOptions}
                  onChange={(id) => patch({ defaultCounterpartyId: id || undefined })}
                  onAdd={() => goDirectory('counterparties')}
                />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    {t('finishedProduct.sectionLabel')}
                  </p>
                  <p className="mt-0.5 text-[10px] text-stone-400">{t('finishedProduct.labelHint')}</p>
                  <div className="mt-2 flex flex-wrap items-start gap-4">
                    {editing.labelPhotoDataUrl ? (
                      <img
                        src={editing.labelPhotoDataUrl}
                        alt=""
                        className="h-24 w-36 rounded-md border border-stone-200 object-contain bg-white"
                      />
                    ) : (
                      <div className="flex h-24 w-36 items-center justify-center rounded-md border border-dashed border-stone-300 bg-white text-xs text-stone-400">
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
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                {t('finishedProduct.sectionMain')}
              </p>
              <div className="mt-3 space-y-3">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  {t('finishedProduct.name')}
                  <input
                    className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
                    placeholder={t('finishedProduct.namePh')}
                    value={editing.name}
                    onChange={(e) => onNameChange(e.target.value)}
                  />
                  <span className="mt-1 block text-[10px] text-stone-400">
                    {t('finishedProduct.nameAutoHint')}
                  </span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    <span className="inline-flex items-center gap-1.5">
                      {t('finishedProduct.nameKa')}
                      {!nameKaManualRef.current && editing.nameKa ? (
                        <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-teal-800">
                          {t('finishedProduct.autoBadge')}
                        </span>
                      ) : null}
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
                      value={editing.nameKa ?? ''}
                      onChange={(e) => {
                        nameKaManualRef.current = true
                        patch({ nameKa: e.target.value })
                      }}
                    />
                  </label>
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                    <span className="inline-flex items-center gap-1.5">
                      {t('finishedProduct.nameEn')}
                      {!nameEnManualRef.current && editing.nameEn ? (
                        <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-teal-800">
                          {t('finishedProduct.autoBadge')}
                        </span>
                      ) : null}
                    </span>
                    <input
                      className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
                      value={editing.nameEn ?? ''}
                      onChange={(e) => {
                        nameEnManualRef.current = true
                        patch({ nameEn: e.target.value })
                      }}
                    />
                  </label>
                </div>

                <ExtensibleCatalogField
                  kind="text"
                  label={t('finishedProduct.productType')}
                  hint={t('finishedProduct.catalogHint')}
                  value={editing.productType}
                  options={typeOptions}
                  placeholder={t('finishedProduct.productTypePick')}
                  onChange={(id) => onProductTypeChange(id)}
                  onRegister={registerTypeLabel}
                />

                <ExtensibleCatalogField
                  kind="number"
                  label={t('finishedProduct.grammage')}
                  hint={t('finishedProduct.catalogHint')}
                  unit={t('finishedProduct.gsmUnit')}
                  value={editing.grammageGsm}
                  options={gsmOptions}
                  placeholder="120"
                  onChange={onGrammagePick}
                  onRegister={registerGsm}
                />

                {(editing.productType === 'mesh' || editing.meshCellSize) && (
                  <ExtensibleCatalogField
                    kind="text"
                    label={t('finishedProduct.meshCell')}
                    hint={t('finishedProduct.meshCellHint')}
                    value={editing.meshCellSize}
                    options={meshCellOptions}
                    placeholder="4×5"
                    onChange={onMeshCellPick}
                    onRegister={registerMeshCell}
                  />
                )}

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

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                {t('finishedProduct.sectionProduction')}
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  {t('finishedProduct.metersPerRoll')}
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
                    value={editing.metersPerRoll ?? ''}
                    onChange={(e) =>
                      patch({
                        metersPerRoll: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                  />
                </label>

                <div>
                  <ExtensibleCatalogField
                    kind="number"
                    label={t('finishedProduct.rollWidthM')}
                    hint={t('finishedProduct.rollWidthMHint')}
                    unit="м"
                    value={editing.rollWidthM}
                    options={widthOptions}
                    placeholder={t('finishedProduct.rollWidthMPh')}
                    onChange={(rollWidthM) => patch({ rollWidthM })}
                    onRegister={registerWidth}
                    formatOption={(n) =>
                      n.toLocaleString('ru-RU', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                {t('finishedProduct.sectionLinks')}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <DirectoryFieldPicker
                  label={t('finishedProduct.defaultBox')}
                  value={editing.defaultBoxRecipeId ?? ''}
                  placeholder="—"
                  options={boxRecipes
                    .filter((r) => r.active)
                    .map((r) => ({
                      value: r.id,
                      label: `${r.code} · ${r.name} · ${r.rollsPerBox}`,
                    }))}
                  onChange={(id) => patch({ defaultBoxRecipeId: id || undefined })}
                  onAdd={() => goDirectory('packagingRecipes')}
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
                  onChange={(id) => patch({ defaultPackagingRecipeId: id || undefined })}
                  onAdd={() => goDirectory('packagingRecipes')}
                />
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
                <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-500 sm:col-span-2">
                  {t('finishedProduct.note')}
                  <textarea
                    className="mt-1 w-full rounded-md border border-stone-200 px-3 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25"
                    rows={2}
                    value={editing.note ?? ''}
                    onChange={(e) => patch({ note: e.target.value })}
                  />
                </label>
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 flex justify-between gap-2 border-t border-stone-200 bg-white px-5 py-3">
            <button
              type="button"
              className="text-sm text-red-600"
              onClick={async () => {
                if (
                  editing.id &&
                  (await confirm({ message: t('finishedProduct.deleteConfirm'), danger: true }))
                ) {
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
                className="rounded-md border border-stone-200 px-4 py-2 text-sm"
                onClick={closeEditing}
              >
                {t('planner.cancel')}
              </button>
              <button
                type="button"
                className="rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
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

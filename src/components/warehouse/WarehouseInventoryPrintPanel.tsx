import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { KpiCard } from '@/components/ui/KpiCard'
import { WarehouseInventoryPrintSheet } from '@/components/warehouse/WarehouseInventoryPrintSheet'
import { useI18n } from '@/context/I18nContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import {
  buildInventoryPrintPayload,
  categoryItemCounts,
  countItemsForSelection,
  defaultInventoryPrintSelection,
} from '@/lib/warehouse/inventoryPrint'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  date: string
  comment: string
  site?: string
  responsible?: string
  asOfIso?: string | null
}

export function WarehouseInventoryPrintPanel({
  warehouse,
  date,
  comment,
  site,
  responsible,
  asOfIso,
}: Props) {
  const { t, tf } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)

  const defaults = useMemo(() => defaultInventoryPrintSelection(warehouse), [warehouse])
  const [warehouseIds, setWarehouseIds] = useState<Set<string>>(() => new Set(defaults.warehouseIds))
  const [categoryIds, setCategoryIds] = useState<Set<string>>(() => new Set(defaults.categoryIds))
  const [categorySearch, setCategorySearch] = useState('')
  const [onlyWithBalance, setOnlyWithBalance] = useState(false)
  const [groupByCategory, setGroupByCategory] = useState(true)
  const [showBookBalance, setShowBookBalance] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories = useMemo(
    () => [...warehouse.categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [warehouse.categories],
  )
  const locations = useMemo(
    () => [...warehouse.locations].sort((a, b) => a.sortOrder - b.sortOrder),
    [warehouse.locations],
  )

  const catCounts = useMemo(
    () => categoryItemCounts(warehouse, warehouseIds, onlyWithBalance, asOfIso ?? undefined),
    [warehouse, warehouseIds, onlyWithBalance, asOfIso],
  )

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase()
    if (!q) return categories
    return categories.filter((c) => c.name.toLowerCase().includes(q))
  }, [categories, categorySearch])

  const selectedCount = useMemo(
    () =>
      countItemsForSelection(
        warehouse,
        warehouseIds,
        categoryIds,
        onlyWithBalance,
        asOfIso ?? undefined,
      ),
    [warehouse, warehouseIds, categoryIds, onlyWithBalance, asOfIso],
  )

  const payload = useMemo(
    () =>
      buildInventoryPrintPayload(warehouse, {
        warehouseIds,
        categoryIds,
        onlyWithBalance,
        groupByCategory,
        showBookBalance,
        asOfIso: asOfIso ?? undefined,
      }),
    [warehouse, warehouseIds, categoryIds, onlyWithBalance, groupByCategory, showBookBalance, asOfIso],
  )

  useEffect(() => {
    if (!previewOpen) return
    document.body.classList.add('print-preview-open', 'print-inventory')
    return () => {
      document.body.classList.remove('print-preview-open', 'print-inventory')
    }
  }, [previewOpen])

  function toggleWarehouse(id: string) {
    setWarehouseIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCategory(id: string) {
    setCategoryIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllWarehouses() {
    setWarehouseIds(new Set(locations.map((l) => l.id)))
  }

  function clearAllWarehouses() {
    setWarehouseIds(new Set())
  }

  function selectAllCategories() {
    setCategoryIds(new Set(categories.map((c) => c.id)))
  }

  function clearAllCategories() {
    setCategoryIds(new Set())
  }

  function selectVisibleCategories() {
    setCategoryIds((prev) => {
      const next = new Set(prev)
      for (const c of filteredCategories) next.add(c.id)
      return next
    })
  }

  function openPreview() {
    if (selectedCount === 0) {
      setError(t('warehouse.inventory.printEmpty'))
      return
    }
    if (warehouseIds.size === 0) {
      setError(t('warehouse.inventory.printNoWarehouse'))
      return
    }
    if (categoryIds.size === 0) {
      setError(t('warehouse.inventory.printNoCategory'))
      return
    }
    setError(null)
    setPreviewOpen(true)
  }

  function handlePrint() {
    window.print()
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      await exportPrintAreaToPdf(printRef.current, `inventory-${date}.pdf`)
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}

      <div className="rounded-sm border border-teal-200/80 bg-teal-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-ink">{t('warehouse.inventory.printTitle')}</h3>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              {t('warehouse.inventory.printHint')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <KpiCard label={t('warehouse.inventory.printKpiItems')} value={selectedCount} />
            <KpiCard
              label={t('warehouse.inventory.printKpiWarehouses')}
              value={warehouseIds.size}
            />
            <KpiCard
              label={t('warehouse.inventory.printKpiCategories')}
              value={categoryIds.size}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* Склады */}
          <section className="rounded-sm border border-grid bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-ink">
                {t('warehouse.inventory.printWarehouses')}
              </h4>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 hover:bg-teal-50"
                  onClick={selectAllWarehouses}
                >
                  {t('warehouse.inventory.printSelectAll')}
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 hover:bg-stone-100"
                  onClick={clearAllWarehouses}
                >
                  {t('warehouse.inventory.printClearAll')}
                </button>
              </div>
            </div>
            <ul className="mt-3 max-h-52 space-y-1 overflow-y-auto">
              {locations.map((loc) => {
                const count = warehouse.items.filter(
                  (i) =>
                    i.active &&
                    i.warehouseId === loc.id &&
                    (categoryIds.size === 0 || categoryIds.has(i.categoryId)),
                ).length
                return (
                  <li key={loc.id}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 hover:bg-stone-50">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-stone-300 text-teal-700"
                        checked={warehouseIds.has(loc.id)}
                        onChange={() => toggleWarehouse(loc.id)}
                      />
                      <span className="flex-1 text-sm text-ink">{loc.name}</span>
                      <span className="font-mono text-xs text-stone-400">{count}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {locations.length === 0 && (
              <p className="mt-2 text-sm text-stone-400">{t('warehouse.inventory.printNoLocations')}</p>
            )}
          </section>

          {/* Отделы / категории */}
          <section className="rounded-sm border border-grid bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-ink">
                {t('warehouse.inventory.printCategories')}
              </h4>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700 hover:bg-teal-50"
                  onClick={selectAllCategories}
                >
                  {t('warehouse.inventory.printSelectAll')}
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500 hover:bg-stone-100"
                  onClick={clearAllCategories}
                >
                  {t('warehouse.inventory.printClearAll')}
                </button>
              </div>
            </div>
            <input
              type="search"
              className="mt-3 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('warehouse.inventory.printCategorySearch')}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
            />
            <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
              {filteredCategories.map((cat) => {
                const count = catCounts.get(cat.id) ?? 0
                const disabled = count === 0 && onlyWithBalance
                return (
                  <li key={cat.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 ${
                        disabled ? 'opacity-40' : 'hover:bg-stone-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-stone-300 text-teal-700"
                        checked={categoryIds.has(cat.id)}
                        disabled={disabled}
                        onChange={() => toggleCategory(cat.id)}
                      />
                      <span className="flex-1 text-sm text-ink">{cat.name}</span>
                      <span className="font-mono text-xs text-stone-400">{count}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {filteredCategories.length > 0 && categorySearch && (
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-teal-700 hover:underline"
                onClick={selectVisibleCategories}
              >
                {t('warehouse.inventory.printSelectVisible')}
              </button>
            )}
          </section>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-sm border border-grid/80 bg-stone-50/80 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              className="size-4 rounded border-stone-300 text-teal-700"
              checked={onlyWithBalance}
              onChange={(e) => setOnlyWithBalance(e.target.checked)}
            />
            {t('warehouse.inventory.printOnlyBalance')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              className="size-4 rounded border-stone-300 text-teal-700"
              checked={groupByCategory}
              onChange={(e) => setGroupByCategory(e.target.checked)}
            />
            {t('warehouse.inventory.printGroupByCategory')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              className="size-4 rounded border-stone-300 text-teal-700"
              checked={showBookBalance}
              onChange={(e) => setShowBookBalance(e.target.checked)}
            />
            {t('warehouse.inventory.printShowBook')}
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="md" onClick={openPreview} disabled={selectedCount === 0}>
            {t('warehouse.inventory.printPreview')}
          </Button>
          <p className="text-sm text-stone-500">
            {tf('warehouse.inventory.printSummary', {
              items: selectedCount,
              warehouses: warehouseIds.size,
              categories: categoryIds.size,
            })}
          </p>
        </div>
      </div>

      {previewOpen &&
        createPortal(
          <div className="print-modal-root fixed inset-0 z-[120] flex flex-col bg-stone-900/70">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 print:hidden">
              <p className="text-sm font-semibold text-white">
                {t('warehouse.inventory.printPreviewTitle')} — {selectedCount}{' '}
                {t('warehouse.inventory.printKpiItems').toLowerCase()}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(false)}>
                  {t('common.back')}
                </Button>
                <Button variant="secondary" size="sm" onClick={handlePdf} disabled={pdfBusy}>
                  {pdfBusy ? '…' : 'PDF'}
                </Button>
                <Button variant="primary" size="sm" onClick={handlePrint}>
                  {t('warehouse.inventory.printAction')}
                </Button>
              </div>
            </div>
            <div className="print-modal-body flex-1 overflow-auto">
              <div ref={printRef} className="print-area">
                <WarehouseInventoryPrintSheet
                  payload={payload}
                  title={t('warehouse.inventory.printDocTitle')}
                  date={date}
                  site={site}
                  responsible={responsible}
                  comment={comment}
                  showBookBalance={showBookBalance}
                  groupByCategory={groupByCategory}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from '@/components/ui/icons'
import { useModalScope } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { searchNomenclature } from '@/lib/warehouse/nomenclatureSearch'
import {
  formatIssueShortages,
  formatQty,
  itemStockValue,
  toBaseQty,
  validateIssueLines,
} from '@/lib/warehouse/stock'
import type { ItemBalance, WarehouseCategory, WarehouseItem } from '@/lib/warehouse/types'

export type PickApplyRow = { itemId: string; quantity: number }

type PickRow = {
  key: string
  itemId: string
  quantity: string
}

type Props = {
  open: boolean
  items: WarehouseItem[]
  categories: WarehouseCategory[]
  categoryNames: Map<string, string>
  balances: Map<string, ItemBalance>
  warehouseId?: string
  docType?: 'receipt' | 'issue'
  initialSearch?: string
  allowNegativeStock?: boolean
  onClose: () => void
  onApply: (rows: PickApplyRow[]) => void
}

export function WarehousePickModal({
  open,
  items,
  categories,
  categoryNames,
  balances,
  warehouseId,
  docType = 'receipt',
  initialSearch = '',
  allowNegativeStock = false,
  onClose,
  onApply,
}: Props) {
  const { t } = useI18n()
  const { confirm, alert } = useConfirm()
  const searchRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const { zIndex } = useModalScope({
    open,
    onClose,
    containerRef: panelRef,
    disableEnterSubmit: true,
    initialFocus: 'none',
  })

  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [picked, setPicked] = useState<PickRow[]>([])

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  const catalog = useMemo(() => {
    let list = searchNomenclature(items, search, {
      categoryNames,
      warehouseId,
      limit: 200,
    })
    if (catFilter) list = list.filter((i) => i.categoryId === catFilter)
    return list
  }, [items, search, categoryNames, warehouseId, catFilter])

  useEffect(() => {
    if (open) {
      setSearch(initialSearch)
      setCatFilter('')
      setHighlight(0)
      setPicked([])
      requestAnimationFrame(() => searchRef.current?.focus())
    }
  }, [open, initialSearch])

  useEffect(() => {
    setHighlight(0)
  }, [search, catFilter])

  if (!open) return null

  function addItem(item: WarehouseItem, qty = '1') {
    setPicked((prev) => {
      const existing = prev.find((p) => p.itemId === item.id)
      if (existing) {
        return prev.map((p) =>
          p.itemId === item.id
            ? { ...p, quantity: String(Number(p.quantity.replace(',', '.')) + Number(qty.replace(',', '.'))) }
            : p,
        )
      }
      return [...prev, { key: crypto.randomUUID(), itemId: item.id, quantity: qty }]
    })
  }

  function updatePickedQty(key: string, quantity: string) {
    setPicked((prev) => prev.map((p) => (p.key === key ? { ...p, quantity } : p)))
  }

  function removePicked(key: string) {
    setPicked((prev) => prev.filter((p) => p.key !== key))
  }

  async function apply() {
    const rows = picked
      .map((p) => ({
        itemId: p.itemId,
        quantity: Number(p.quantity.replace(',', '.')),
      }))
      .filter((r) => r.quantity > 0)
    if (!rows.length) {
      onClose()
      return
    }

    if (docType === 'issue') {
      const itemMap = new Map(items.map((i) => [i.id, i]))
      const baseLines = rows.map((r) => {
        const item = itemMap.get(r.itemId)
        return {
          itemId: r.itemId,
          quantity: item ? toBaseQty(item, r.quantity) : r.quantity,
        }
      })
      const validation = validateIssueLines(items, balances, baseLines)
      if (!validation.ok) {
        const detail = formatIssueShortages(validation.shortages)
        if (!allowNegativeStock) {
          await alert({ message: `${t('warehouse.issue.overdraftBlocked')}\n\n${detail}` })
          return
        }
        if (!(await confirm({ message: `${t('warehouse.issue.overdraftConfirm')}\n\n${detail}`, danger: true }))) return
      }
    }

    onApply(rows)
    onClose()
  }

  let pickTotal = 0
  for (const p of picked) {
    const item = items.find((i) => i.id === p.itemId)
    const q = Number(p.quantity.replace(',', '.'))
    if (item && q > 0) pickTotal += itemStockValue(item, q)
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      style={{ zIndex }}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-sm bg-white shadow-sm"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-grid px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-ink">{t('warehouse.pick.title')}</h3>
            <p className="text-xs text-stone-500">{t('warehouse.pick.subtitle')}</p>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            className="rounded-sm px-3 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            onClick={onClose}
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-2">
          {/* Справочник */}
          <div className="flex min-h-0 flex-col border-b border-grid lg:border-b-0 lg:border-r">
            <div className="space-y-2 border-b border-grid px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                {t('warehouse.pick.catalog')}
              </p>
              <input
                ref={searchRef}
                type="search"
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                placeholder={t('warehouse.picker.placeholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setHighlight((h) => Math.min(h + 1, catalog.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setHighlight((h) => Math.max(h - 1, 0))
                  } else if (e.key === 'Enter' && catalog[highlight]) {
                    e.preventDefault()
                    addItem(catalog[highlight])
                  }
                }}
              />
              <select
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={catFilter}
                onChange={(e) => setCatFilter(e.target.value)}
              >
                <option value="">{t('warehouse.allCategories')}</option>
                {sortedCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-stone-50 text-[11px] uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('warehouse.col.name')}</th>
                    <th className="w-16 px-2 py-2">{t('warehouse.col.unit')}</th>
                    <th className="w-20 px-2 py-2 text-right">{t('warehouse.col.available')}</th>
                    <th className="w-10 px-1 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {catalog.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-stone-400">
                        {t('warehouse.picker.empty')}
                      </td>
                    </tr>
                  ) : (
                    catalog.map((item, idx) => {
                      const bal = balances.get(item.id)
                      const low =
                        docType === 'issue' &&
                        item.minStock != null &&
                        (bal?.available ?? 0) <= item.minStock
                      return (
                        <tr
                          key={item.id}
                          className={`cursor-pointer border-t border-grid/50 ${
                            idx === highlight ? 'bg-teal-50' : 'hover:bg-stone-50'
                          }`}
                          onMouseEnter={() => setHighlight(idx)}
                          onDoubleClick={() => addItem(item)}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium leading-snug">{item.name}</div>
                            <div className="text-[11px] text-stone-400">
                              {categoryNames.get(item.categoryId)}
                              {item.sku ? ` · ${item.sku}` : ''}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-stone-500">{item.unit}</td>
                          <td
                            className={`px-2 py-2 text-right tabular-nums ${
                              low ? 'font-semibold text-amber-700' : 'text-stone-600'
                            }`}
                          >
                            {formatQty(bal?.available ?? 0)}
                          </td>
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              title={t('warehouse.pick.add')}
                              className="btn-add-xs rounded px-1.5 py-0.5 text-sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                addItem(item)
                              }}
                            >
                              →
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Подобрано */}
          <div className="flex min-h-0 flex-col">
            <div className="border-b border-grid px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                {t('warehouse.pick.selected')} ({picked.length})
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {picked.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-stone-400">{t('warehouse.pick.empty')}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-stone-50 text-[11px] uppercase text-stone-500">
                    <tr>
                      <th className="px-3 py-2 text-left">{t('warehouse.col.name')}</th>
                      <th className="w-16 px-2 py-2">{t('warehouse.col.unit')}</th>
                      <th className="w-24 px-2 py-2 text-right">{t('warehouse.quantity')}</th>
                      <th className="w-8 px-1 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {picked.map((row) => {
                      const item = items.find((i) => i.id === row.itemId)
                      if (!item) return null
                      const bal = balances.get(item.id)
                      const qty = Number(row.quantity.replace(',', '.'))
                      const overIssue =
                        docType === 'issue' && qty > 0 && qty > (bal?.available ?? 0)

                      return (
                        <tr key={row.key} className="border-t border-grid/50">
                          <td className="px-3 py-2">
                            <div className="font-medium leading-snug">{item.name}</div>
                            {overIssue && (
                              <div className="text-[11px] text-red-600">{t('warehouse.pick.overIssue')}</div>
                            )}
                          </td>
                          <td className="px-2 py-2 text-stone-500">{item.unit}</td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoFocus={picked[picked.length - 1]?.key === row.key}
                              className={`w-full rounded border px-2 py-1.5 text-right text-sm tabular-nums ${
                                overIssue ? 'border-red-400 bg-red-50' : 'border-grid'
                              }`}
                              value={row.quantity}
                              onChange={(e) => updatePickedQty(row.key, e.target.value)}
                            />
                          </td>
                          <td className="px-1 py-2 text-center">
                            <button
                              type="button"
                              className="text-stone-400 hover:text-red-600"
                              onClick={() => removePicked(row.key)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-grid px-5 py-4">
          <span className="text-sm text-stone-500">
            {picked.length > 0 && pickTotal > 0 && (
              <>
                {t('warehouse.doc.total')}: <strong className="tabular-nums">{formatQty(pickTotal)} ₾</strong>
              </>
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={picked.length === 0}
              className="rounded-sm bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40"
              onClick={apply}
            >
              {t('warehouse.pick.apply')}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}

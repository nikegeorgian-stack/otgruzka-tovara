import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { WarehouseItemThumb } from '@/components/warehouse/WarehouseItemThumb'
import { useI18n } from '@/context/I18nContext'
import { formatQty } from '@/lib/warehouse/stock'
import { searchNomenclature } from '@/lib/warehouse/nomenclatureSearch'
import type { ItemBalance, WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  items: WarehouseItem[]
  categoryNames: Map<string, string>
  balances: Map<string, ItemBalance>
  warehouseId?: string
  value: string | null
  placeholder?: string
  autoFocus?: boolean
  onChange: (itemId: string | null) => void
  onConfirmQty?: () => void
}

export function NomenclaturePicker({
  items,
  categoryNames,
  balances,
  warehouseId,
  value,
  placeholder,
  autoFocus,
  onChange,
  onConfirmQty,
}: Props) {
  const { t } = useI18n()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const selected = value ? items.find((i) => i.id === value) : undefined

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)

  const results = searchNomenclature(items, query || (selected?.name ?? ''), {
    categoryNames,
    warehouseId,
    limit: 20,
  })

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const pick = useCallback(
    (item: WarehouseItem) => {
      onChange(item.id)
      setQuery('')
      setOpen(false)
      requestAnimationFrame(() => onConfirmQty?.())
    },
    [onChange, onConfirmQty],
  )

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && results[highlight]) pick(results[highlight])
      else if (selected) onConfirmQty?.()
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'F4') {
      e.preventDefault()
      setOpen(true)
      inputRef.current?.select()
    }
  }

  const displayValue = open ? query : selected?.name ?? query

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        type="text"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder ?? t('warehouse.picker.placeholder')}
        className="w-full rounded border border-grid bg-white px-2 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-1 focus:ring-teal-600/30"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (!e.target.value.trim()) onChange(null)
        }}
        onFocus={() => {
          setOpen(true)
          if (selected) setQuery('')
        }}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-64 overflow-auto rounded-sm border border-grid bg-white py-1 shadow-sm"
        >
          {results.map((item, idx) => {
            const bal = balances.get(item.id)
            const cat = categoryNames.get(item.categoryId) ?? ''
            return (
              <li
                key={item.id}
                role="option"
                aria-selected={idx === highlight}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  idx === highlight ? 'bg-teal-50 text-teal-900' : 'hover:bg-stone-50'
                }`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(item)
                }}
              >
                <div className="flex items-start gap-2">
                  <WarehouseItemThumb photoDataUrl={item.photoDataUrl} name={item.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 font-medium leading-snug">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-xs text-stone-500">
                        {formatQty(bal?.available ?? 0)} {item.unit}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-stone-400">
                      {cat && <span>{cat}</span>}
                      {item.sku && <span>SKU: {item.sku}</span>}
                      {item.barcode && <span>{item.barcode}</span>}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && query && results.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 rounded-sm border border-grid bg-white px-3 py-2 text-sm text-stone-400 shadow-sm">
          {t('warehouse.picker.empty')}
        </div>
      )}
    </div>
  )
}

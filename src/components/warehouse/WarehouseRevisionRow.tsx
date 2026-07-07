import { memo, useEffect, useState } from 'react'
import { formatQty } from '@/lib/warehouse/stock'
import type { WarehouseItem } from '@/lib/warehouse/types'

export type RevisionRowCommit = {
  itemId: string
  counted: string
  touched: boolean
  doubtful: boolean
}

type Props = {
  item: WarehouseItem
  book: number
  rowNum: number
  editable: boolean
  initialCounted: string
  initialTouched: boolean
  initialDoubtful: boolean
  onCommit: (line: RevisionRowCommit) => void
  onEditItem?: (item: WarehouseItem) => void
  editItemLabel: string
  doubtfulHint: string
}

export const WarehouseRevisionRow = memo(function WarehouseRevisionRow({
  item,
  book,
  rowNum,
  editable,
  initialCounted,
  initialTouched,
  initialDoubtful,
  onCommit,
  onEditItem,
  editItemLabel,
  doubtfulHint,
}: Props) {
  const [counted, setCounted] = useState(initialCounted)
  const [touched, setTouched] = useState(initialTouched)
  const [doubtful, setDoubtful] = useState(initialDoubtful)

  useEffect(() => {
    setCounted(initialCounted)
    setTouched(initialTouched)
    setDoubtful(initialDoubtful)
  }, [item.id, initialCounted, initialTouched, initialDoubtful])

  const fact = touched && counted !== '' ? Number(counted.replace(',', '.')) : undefined
  const diff = fact !== undefined && !Number.isNaN(fact) ? fact - book : undefined
  const hasDiff = diff !== undefined && Math.abs(diff) > 1e-9

  function flush() {
    onCommit({ itemId: item.id, counted, touched, doubtful })
  }

  return (
    <tr
      className={
        doubtful
          ? 'bg-violet-50/80'
          : hasDiff
            ? 'bg-amber-50/60'
            : touched
              ? 'bg-sky-50/40'
              : undefined
      }
    >
      <td className="border border-grid px-2 py-1 text-center font-mono text-xs">{rowNum}</td>
      <td className="border border-grid px-2 py-1 font-mono text-xs">{item.internalCode}</td>
      <td className="border border-grid px-2 py-1">
        {onEditItem ? (
          <button
            type="button"
            className="text-left hover:text-teal-800 hover:underline"
            title={editItemLabel}
            onClick={() => onEditItem(item)}
          >
            {item.name}
          </button>
        ) : (
          item.name
        )}
      </td>
      <td className="border border-grid px-2 py-1 text-center text-xs">{item.unit}</td>
      <td className="border border-grid px-2 py-1 text-right font-mono">{formatQty(book)}</td>
      <td className="border border-grid p-0">
        <input
          type="text"
          inputMode="decimal"
          disabled={!editable}
          className="w-full border-0 bg-transparent px-2 py-1.5 text-right font-mono disabled:text-stone-500"
          value={touched ? counted : ''}
          placeholder={editable ? '—' : ''}
          onChange={(e) => {
            setCounted(e.target.value)
            setTouched(true)
          }}
          onBlur={flush}
        />
      </td>
      <td
        className={`border border-grid px-2 py-1 text-right font-mono ${
          hasDiff ? (diff! > 0 ? 'text-emerald-700' : 'text-red-700') : 'text-stone-400'
        }`}
      >
        {diff !== undefined && !Number.isNaN(diff)
          ? (diff > 0 ? '+' : '') + formatQty(diff)
          : '—'}
      </td>
      <td className="border border-grid px-2 py-1 text-center">
        <input
          type="checkbox"
          disabled={!editable || !touched}
          checked={doubtful}
          title={doubtfulHint}
          onChange={(e) => {
            const next = e.target.checked
            setDoubtful(next)
            onCommit({ itemId: item.id, counted, touched: true, doubtful: next })
          }}
        />
      </td>
    </tr>
  )
})

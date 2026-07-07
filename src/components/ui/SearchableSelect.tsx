import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'

export type SearchableOption = { value: string; label: string }

type Props = {
  options: SearchableOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Включить поиск, если опций не меньше этого числа */
  minSearchOptions?: number
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  minSearchOptions = 10,
}: Props) {
  const { t } = useI18n()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)
  const useSearch = options.length >= minSearchOptions

  const [open, setOpen] = useState(false)
  const popoverZ = usePopoverZIndex(open)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 280 })

  const q = query.trim().toLowerCase()
  const results = q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options

  const pick = useCallback(
    (v: string) => {
      onChange(v)
      setQuery('')
      setOpen(false)
    },
    [onChange],
  )

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const r = rootRef.current.getBoundingClientRect()
    setPanelPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) })
  }, [open, query])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  if (!useSearch) {
    return (
      <select
        className={`rounded-sm border border-grid px-2 py-1.5 text-sm disabled:bg-stone-50 ${className}`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder ?? '—'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }

  const panel = open ? (
    <div
      ref={panelRef}
      id={listId}
      role="listbox"
      className="fixed max-h-56 overflow-y-auto rounded-sm border border-grid bg-white py-1 shadow-lg"
      style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width, zIndex: popoverZ }}
    >
      {results.length === 0 ? (
        <p className="px-3 py-2 text-xs text-stone-400">{t('common.noResults')}</p>
      ) : (
        results.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={o.value === value}
            className={`block w-full px-3 py-1.5 text-left text-sm ${
              i === highlight ? 'bg-accent/10 text-ink' : 'text-stone-700 hover:bg-paper-dark'
            }`}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => pick(o.value)}
          >
            {o.label}
          </button>
        ))
      )}
    </div>
  ) : null

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <input
        ref={inputRef}
        type="search"
        disabled={disabled}
        className="w-full rounded-sm border border-grid px-2 py-1.5 text-sm disabled:bg-stone-50"
        placeholder={selected?.label ?? placeholder ?? t('common.search')}
        value={open ? query : selected?.label ?? ''}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            setQuery('')
            return
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, results.length - 1))
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
            return
          }
          if (e.key === 'Enter' && results[highlight]) {
            e.preventDefault()
            pick(results[highlight]!.value)
          }
        }}
      />
      {typeof document !== 'undefined' ? createPortal(panel, getModalPortalRoot()) : null}
    </div>
  )
}

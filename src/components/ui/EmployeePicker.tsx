import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EmployeeAvatar } from '@/components/ui/EmployeeAvatar'
import { usePopoverZIndex } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { useI18n } from '@/context/I18nContext'
import { searchEmployees } from '@/lib/employeeSearch'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  value: string | null
  brigade?: string
  excludeId?: string
  /** employeeId → rowId (устаревший компактный вид) или полное назначение */
  assignedInMonth?: Map<string, string | { rowId: string; brigade: string }>
  currentRowId?: string
  compact?: boolean
  placeholder?: string
  /** Срез на дату архива / as-of */
  asOfDate?: string
  /** Месяц табеля YYYY-MM */
  month?: string
  onChange: (employeeId: string | null) => void
  /** Выбор человека, уже стоящего в другой бригаде месяца. */
  onConflictPick?: (info: {
    employeeId: string
    fromBrigade: string
    toBrigade: string
  }) => void
  onAddNew?: () => void
}

function assignmentOf(
  assignedInMonth: Props['assignedInMonth'],
  employeeId: string,
): { rowId: string; brigade?: string } | undefined {
  const raw = assignedInMonth?.get(employeeId)
  if (!raw) return undefined
  if (typeof raw === 'string') return { rowId: raw }
  return raw
}

export function EmployeePicker({
  employees,
  value,
  brigade,
  excludeId,
  assignedInMonth,
  currentRowId,
  compact = false,
  placeholder,
  asOfDate,
  month,
  onChange,
  onConflictPick,
  onAddNew,
}: Props) {
  const { t, tf, employeeName } = useI18n()
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const selected = value ? employees.find((e) => e.id === value) : undefined

  const [open, setOpen] = useState(false)
  const popoverZ = usePopoverZIndex(open)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 280 })

  const results = searchEmployees(employees, query, {
    brigade,
    excludeId,
    limit: 30,
    asOfDate,
    month,
  })

  const showClearSlot = open && !query.trim()
  const addNewSlot = onAddNew ? 1 : 0
  const optionCount = (showClearSlot ? 1 : 0) + results.length + addNewSlot

  const pick = useCallback(
    (emp: Employee | null) => {
      if (emp && brigade) {
        const taken = assignmentOf(assignedInMonth, emp.id)
        if (taken && taken.rowId !== currentRowId) {
          const fromBrigade = taken.brigade || t('employee.picker.otherSlot')
          onConflictPick?.({
            employeeId: emp.id,
            fromBrigade,
            toBrigade: brigade,
          })
        } else if (emp.brigade && emp.brigade !== brigade) {
          onConflictPick?.({
            employeeId: emp.id,
            fromBrigade: emp.brigade,
            toBrigade: brigade,
          })
        }
      }
      onChange(emp?.id ?? null)
      setQuery('')
      setOpen(false)
    },
    [assignedInMonth, brigade, currentRowId, onChange, onConflictPick, t],
  )

  function pickHighlighted() {
    let idx = highlight
    if (showClearSlot) {
      if (idx === 0) {
        pick(null)
        return
      }
      idx -= 1
    }
    if (idx < results.length) {
      pick(results[idx]!)
      return
    }
    if (onAddNew && idx === results.length) {
      setOpen(false)
      setQuery('')
      onAddNew()
    }
  }

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const rect = rootRef.current.getBoundingClientRect()
    const width = Math.max(rect.width, compact ? 300 : 320)
    let left = rect.left
    let top = rect.bottom + 6
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12)
    }
    const panelH = panelRef.current?.offsetHeight ?? 320
    if (top + panelH > window.innerHeight - 12) {
      top = Math.max(12, rect.top - panelH - 6)
    }
    setPanelPos({ top, left, width })
  }, [open, query, results.length, compact])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      else setHighlight((h) => Math.min(h + 1, Math.max(0, optionCount - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (!open) setOpen(true)
      else pickHighlighted()
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
    }
  }

  const displayValue = open ? query : selected ? employeeName(selected) : ''

  const panel = open && (
    <div
      ref={panelRef}
      id={listId}
      role="listbox"
      className="fixed overflow-hidden rounded-sm border border-grid bg-white shadow-sm "
      style={{
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        zIndex: popoverZ,
      }}
    >
      <div className="max-h-80 overflow-y-auto py-1">
        {showClearSlot && (
          <button
            type="button"
            role="option"
            aria-selected={highlight === 0}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm ${
              highlight === 0 ? 'bg-stone-100 text-stone-700' : 'text-stone-500 hover:bg-stone-50'
            }`}
            onMouseEnter={() => setHighlight(0)}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(null)
            }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-stone-100 text-stone-400">
              —
            </span>
            {t('table.freeSlot')}
          </button>
        )}
        {results.map((emp, idx) => {
          const itemIdx = (showClearSlot ? 1 : 0) + idx
          const taken = assignmentOf(assignedInMonth, emp.id)
          const elsewhere =
            taken && taken.rowId !== currentRowId
              ? taken.brigade || t('employee.picker.otherSlot')
              : emp.brigade && brigade && emp.brigade !== brigade
                ? emp.brigade
                : null
          return (
            <button
              key={emp.id}
              type="button"
              role="option"
              aria-selected={itemIdx === highlight}
              className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                itemIdx === highlight ? 'bg-accent/8' : 'hover:bg-stone-50'
              }`}
              onMouseEnter={() => setHighlight(itemIdx)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(emp)
              }}
            >
              <EmployeeAvatar employee={emp} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">
                  {employeeName(emp)}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-stone-500">
                  <span className="font-mono">№ {emp.tabNumber}</span>
                  <span className="truncate">{emp.brigade}</span>
                  {elsewhere ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800 ring-1 ring-amber-200/80">
                      {tf('employee.picker.plannedElsewhere', { brigade: elsewhere })}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
        {results.length === 0 && query.trim() && (
          <p className="px-4 py-6 text-center text-sm text-stone-400">
            {t('employee.picker.empty')}
          </p>
        )}
      </div>
      {onAddNew && (
        <div className="border-t border-grid bg-paper/80 p-2">
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:opacity-95"
            onMouseDown={(e) => {
              e.preventDefault()
              setOpen(false)
              setQuery('')
              onAddNew()
            }}
          >
            <span className="text-lg leading-none">+</span>
            {t('employee.picker.addNew')}
          </button>
        </div>
      )}
    </div>
  )

  if (compact) {
    return (
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          className={`flex w-full max-w-[14rem] items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-sm transition ${
            open
              ? 'border-accent bg-white ring-2 ring-accent/20'
              : selected
                ? 'border-grid bg-white hover:border-accent/50'
                : 'border-dashed border-stone-300 bg-stone-50/50 text-stone-500 hover:border-accent/40 hover:bg-white'
          }`}
          onClick={() => {
            setOpen(true)
            if (selected) setQuery('')
            window.setTimeout(() => inputRef.current?.focus(), 0)
          }}
        >
          {selected ? (
            <>
              <EmployeeAvatar employee={selected} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">
                {employeeName(selected)}
              </span>
            </>
          ) : (
            <>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-stone-100 text-stone-400">
                +
              </span>
              <span className="truncate">{placeholder ?? t('table.freeSlot')}</span>
            </>
          )}
        </button>
        {open && (
          <div className="absolute left-0 top-full z-10 mt-1 w-full min-w-[14rem]">
            <input
              ref={inputRef}
              type="text"
              className="w-full rounded-sm border border-accent bg-white px-3 py-2 text-sm shadow-sm outline-none ring-2 ring-accent/20"
              placeholder={t('employee.picker.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
        )}
        {panel && createPortal(panel, getModalPortalRoot())}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder ?? t('employee.picker.placeholder')}
        className="w-full rounded-sm border border-grid bg-white px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
          if (selected) setQuery('')
        }}
        onKeyDown={onKeyDown}
      />
      {panel && createPortal(panel, getModalPortalRoot())}
    </div>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'

export type MonthAccordionSection = 'filters' | 'operations' | 'analytics' | 'legend'

const DEFAULT_STORAGE_KEY = 'fst-month-accordion-open'
const VALID: MonthAccordionSection[] = ['filters', 'operations', 'analytics', 'legend']

function readOpen(storageKey: string): Set<MonthAccordionSection> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as MonthAccordionSection[]
    return new Set(arr.filter((id) => VALID.includes(id)))
  } catch {
    return new Set()
  }
}

function writeOpen(storageKey: string, open: Set<MonthAccordionSection>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(storageKey, JSON.stringify([...open]))
  } catch {
    /* ignore */
  }
}

export function useMonthAccordionSections(storageKey = DEFAULT_STORAGE_KEY) {
  const [open, setOpen] = useState<Set<MonthAccordionSection>>(() => readOpen(storageKey))

  useEffect(() => {
    writeOpen(storageKey, open)
  }, [storageKey, open])

  const toggle = useCallback((id: MonthAccordionSection) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const isOpen = useCallback((id: MonthAccordionSection) => open.has(id), [open])

  return { open, toggle, isOpen }
}

export type MonthAccordionItem = {
  id: MonthAccordionSection
  label: string
  summary: string
  warn?: boolean
  children: ReactNode
}

type Props = {
  items: MonthAccordionItem[]
  open: Set<MonthAccordionSection>
  onToggle: (id: MonthAccordionSection) => void
  className?: string
}

export function MonthWorkspaceAccordion({ items, open, onToggle, className = '' }: Props) {
  return (
    <div className={`month-accordion print:hidden ${className}`.trim()}>
      {items.map((item) => {
        const expanded = open.has(item.id)
        return (
          <div
            key={item.id}
            className={`month-acc ${expanded ? 'month-acc--open' : ''} ${item.warn && !expanded ? 'month-acc--warn' : ''}`}
          >
            <button
              type="button"
              className="month-acc__head"
              aria-expanded={expanded}
              onClick={() => onToggle(item.id)}
            >
              <span className="month-acc__chev" aria-hidden>
                {expanded ? '▾' : '▸'}
              </span>
              <span className="month-acc__label">{item.label}</span>
              {!expanded && <span className="month-acc__sum">{item.summary}</span>}
            </button>
            {expanded && <div className="month-acc__body">{item.children}</div>}
          </div>
        )
      })}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { BoxIcon } from '@/components/ui/icons'
import { FormNotice } from '@/components/ui/FormNotice'
import { WarehouseDailyIssuePrintSheet } from '@/components/warehouse/WarehouseDailyIssuePrintSheet'
import { WarehouseItemThumb } from '@/components/warehouse/WarehouseItemThumb'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { sessionLineCount, sessionTotalQty } from '@/lib/warehouse/dailyIssue'
import { searchNomenclature } from '@/lib/warehouse/nomenclatureSearch'
import { filterConsumableItems } from '@/lib/warehouse/locationKindFilter'
import { computeAllBalances, formatIssueShortages, formatQty, validateIssueLines } from '@/lib/warehouse/stock'
import { unitLabel } from '@/lib/warehouse/units'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { WarehousePrintMeta } from '@/lib/warehouse/printDocument'

type Props = {
  warehouse: WarehouseStore
  sessionId: string
  warehouseId: string
  categoryNames: Map<string, string>
  printMeta?: WarehousePrintMeta
  allowNegativeStock?: boolean
  onAdjustLine: (sessionId: string, itemId: string, delta: number) => void
  onSetComment: (sessionId: string, comment: string) => void
  onPost: (
    sessionId: string,
    options?: { allowNegativeStock?: boolean },
  ) => {
    ok: boolean
    reason?: string
    detail?: string
    documentNumber?: string
  }
  onClose: () => void
}

const QUICK_CATEGORIES = ['СИЗ', 'Упаковка', 'Скотч', 'Кухня', 'Канцтовары', 'Этикетки']

export function WarehouseDailyIssueModal({
  warehouse,
  sessionId,
  warehouseId,
  categoryNames,
  printMeta,
  allowNegativeStock = false,
  onAdjustLine,
  onSetComment,
  onPost,
  onClose,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const printRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const session = warehouse.dailyIssueSessions?.find((s) => s.id === sessionId)
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<string | null>(null)
  const [comment, setComment] = useState(session?.comment ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [savedPulse, setSavedPulse] = useState(false)

  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const balances = useMemo(() => computeAllBalances(warehouse, whId), [warehouse, whId])
  const activeItems = useMemo(
    () => filterConsumableItems(warehouse.items, warehouse.categories, whId, warehouse.locations),
    [warehouse.items, warehouse.categories, warehouse.locations, whId],
  )

  const searchResults = useMemo(() => {
    const q = catFilter ? `${catFilter} ${query}`.trim() : query
    return searchNomenclature(activeItems, q, {
      categoryNames,
      warehouseId: whId,
      limit: 12,
    })
  }, [activeItems, query, catFilter, categoryNames, whId])

  const issuedRows = useMemo(() => {
    if (!session) return []
    const itemMap = new Map(activeItems.map((i) => [i.id, i]))
    return session.lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ line: l, item: itemMap.get(l.itemId) }))
      .filter((r): r is { line: (typeof session.lines)[0]; item: NonNullable<typeof r.item> } => !!r.item)
      .sort((a, b) => b.line.updatedAt.localeCompare(a.line.updatedAt))
  }, [session, activeItems])

  useEffect(() => {
    if (!session) return
    setComment(session.comment ?? '')
  }, [session?.comment, session?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewOpen) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, previewOpen])

  useEffect(() => {
    if (!previewOpen) return
    document.body.classList.add('print-preview-open', 'print-daily-issue')
    return () => {
      document.body.classList.remove('print-preview-open', 'print-daily-issue')
    }
  }, [previewOpen])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  function flashSaved() {
    setSavedPulse(true)
    const tmr = setTimeout(() => setSavedPulse(false), 1200)
    return () => clearTimeout(tmr)
  }

  function adjust(itemId: string, delta: number) {
    if (!session || session.status !== 'open') return
    onAdjustLine(sessionId, itemId, delta)
    flashSaved()
  }

  function setQuantity(itemId: string, currentQty: number, raw: string) {
    if (!session || session.status !== 'open') return
    const normalized = raw.trim().replace(',', '.')
    if (!normalized) {
      if (currentQty > 0) adjust(itemId, -currentQty)
      return
    }
    const parsed = Number(normalized)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const nextQty = Math.round(parsed * 1000) / 1000
    const delta = nextQty - currentQty
    if (delta !== 0) adjust(itemId, delta)
  }

  function addFromSearch(itemId: string) {
    adjust(itemId, 1)
    setQuery('')
    searchRef.current?.focus()
  }

  function handleCommentBlur() {
    if (!session || session.status !== 'open') return
    if (comment !== (session.comment ?? '')) {
      onSetComment(sessionId, comment)
      flashSaved()
    }
  }

  async function handlePost() {
    if (!session) return
    if (sessionLineCount(session) === 0) {
      setError(t('warehouse.dailyIssue.empty'))
      return
    }
    if (
      !(await confirm({
        message: tf('warehouse.dailyIssue.postConfirm', {
          number: session.number,
          count: sessionLineCount(session),
        }),
      }))
    ) {
      return
    }
    const activeItems = warehouse.items.filter((i) => i.active)
    const balances = computeAllBalances(warehouse, session.warehouseId)
    const docLines = session.lines
      .filter((l) => l.quantity > 0)
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity }))
    const validation = validateIssueLines(activeItems, balances, docLines)
    if (!validation.ok) {
      const detail = formatIssueShortages(validation.shortages)
      if (!allowNegativeStock) {
        setError(`${t('warehouse.issue.overdraftBlocked')}\n\n${detail}`)
        return
      }
      if (!(await confirm({ message: `${t('warehouse.issue.overdraftConfirm')}\n\n${detail}`, danger: true }))) return
    }
    const result = onPost(sessionId, { allowNegativeStock })
    if (!result.ok) {
      if (result.reason === 'stock') {
        setError(tf('warehouse.dailyIssue.stockError', { items: result.detail ?? '' }))
      } else if (result.reason === 'already_posted') {
        setNotice(t('warehouse.dailyIssue.alreadyPosted'))
      } else {
        setError(t('warehouse.dailyIssue.postFailed'))
      }
      return
    }
    setError(null)
    setNotice(
      tf('warehouse.dailyIssue.posted', { doc: result.documentNumber ?? '—' }),
    )
  }

  function handlePrint() {
    if (!session || sessionLineCount(session) === 0) {
      setError(t('warehouse.dailyIssue.empty'))
      return
    }
    setPreviewOpen(true)
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      await exportPrintAreaToPdf(
        printRef.current,
        `daily-issue-${session?.number ?? 'sheet'}.pdf`,
      )
    } finally {
      setPdfBusy(false)
    }
  }

  if (!session) return null

  const isOpen = session.status === 'open'
  const lineCount = sessionLineCount(session)
  const totalQty = sessionTotalQty(session)

  const modal = (
    <div className="fixed inset-0 z-[130] flex flex-col bg-stone-100">
      {/* Header */}
      <header className="shrink-0 border-b border-stone-200 bg-white px-4 py-3 shadow-sm sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-700">
              {t('warehouse.dailyIssue.badge')}
            </p>
            <h2 className="text-lg font-bold text-ink">{session.number}</h2>
            <p className="text-sm text-stone-500">
              {session.keeperName} ·{' '}
              {new Date(session.date + 'T12:00:00').toLocaleDateString('ru-RU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOpen && (
              <span
                className={`rounded-sm px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                  savedPulse
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-stone-100 text-stone-500'
                }`}
              >
                {savedPulse
                  ? t('warehouse.dailyIssue.saved')
                  : t('warehouse.dailyIssue.autosave')}
              </span>
            )}
            {!isOpen && (
              <span className="rounded-sm bg-stone-200 px-2.5 py-1 text-[10px] font-semibold uppercase text-stone-600">
                {t('warehouse.dailyIssue.closed')}
              </span>
            )}
            <span className="rounded-sm bg-teal-50 px-3 py-1.5 font-mono text-sm font-bold text-teal-900">
              {lineCount} {t('warehouse.dailyIssue.pos')} · {formatQty(totalQty)}
            </span>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </header>

      {notice && (
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />
        </div>
      )}
      {error && (
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 sm:flex-row sm:p-6">
        {/* Left: add items */}
        <aside className="flex w-full shrink-0 flex-col rounded-sm border border-grid bg-white shadow-sm sm:w-80 lg:w-96">
          <div className="border-b border-grid p-4">
            <h3 className="text-sm font-bold text-ink">{t('warehouse.dailyIssue.addTitle')}</h3>
            <input
              ref={searchRef}
              type="search"
              className="mt-2 w-full rounded-sm border border-grid px-3 py-2.5 text-sm"
              placeholder={t('warehouse.dailyIssue.searchPh')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!isOpen}
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {QUICK_CATEGORIES.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={!isOpen}
                  className={`rounded-sm px-2.5 py-0.5 text-[11px] font-semibold ${
                    catFilter === chip
                      ? 'bg-teal-700 text-white'
                      : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                  }`}
                  onClick={() => setCatFilter(catFilter === chip ? null : chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-64 flex-1 overflow-y-auto sm:max-h-none">
            {searchResults.map((item) => {
              const bal = balances.get(item.id)?.available ?? 0
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!isOpen}
                    className="flex w-full items-center gap-3 border-b border-grid/60 px-3 py-2.5 text-left hover:bg-teal-50/80 disabled:opacity-50"
                    onClick={() => addFromSearch(item.id)}
                  >
                    <WarehouseItemThumb
                      photoDataUrl={item.photoDataUrl}
                      name={item.name}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {item.name}
                      </span>
                      <span className="text-[11px] text-stone-400">
                        {categoryNames.get(item.categoryId)} · ост. {formatQty(bal)}{' '}
                        {unitLabel(item.unit, locale)}
                      </span>
                    </span>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-teal-700 text-lg font-bold text-white">
                      +
                    </span>
                  </button>
                </li>
              )
            })}
            {searchResults.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-stone-400">
                {t('warehouse.dailyIssue.searchEmpty')}
              </li>
            )}
          </ul>
        </aside>

        {/* Right: issued list */}
        <main className="flex min-h-0 flex-1 flex-col rounded-sm border border-grid bg-white shadow-sm">
          <div className="border-b border-grid px-4 py-3">
            <h3 className="text-sm font-bold text-ink">{t('warehouse.dailyIssue.listTitle')}</h3>
            <p className="text-xs text-stone-500">{t('warehouse.dailyIssue.listHint')}</p>
          </div>

          {issuedRows.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <BoxIcon size={40} className="text-stone-300" strokeWidth={1.5} />
              <p className="text-sm text-stone-500">{t('warehouse.dailyIssue.emptyList')}</p>
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto divide-y divide-grid/60">
              {issuedRows.map(({ line, item }) => {
                const available = balances.get(item.id)?.available ?? 0
                return (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50/50"
                  >
                    <WarehouseItemThumb
                      photoDataUrl={item.photoDataUrl}
                      name={item.name}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{item.name}</p>
                      <p className="text-xs text-stone-400">
                        {item.internalCode} · {categoryNames.get(item.categoryId)} ·{' '}
                        {t('warehouse.dailyIssue.available')}: {formatQty(available)} {unitLabel(item.unit, locale)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={!isOpen}
                        className="flex size-11 items-center justify-center rounded-sm border-2 border-stone-200 bg-white text-xl font-bold text-stone-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                        onClick={() => adjust(item.id, -1)}
                        aria-label="-1"
                      >
                        −
                      </button>
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!isOpen}
                        className="w-16 rounded-sm border-2 border-grid bg-white px-1 py-2 text-center font-mono text-xl font-bold tabular-nums text-ink disabled:bg-stone-50 disabled:opacity-60"
                        defaultValue={formatQty(line.quantity)}
                        key={`${item.id}-${line.quantity}-${line.updatedAt}`}
                        aria-label={t('warehouse.dailyIssue.qtyInput')}
                        onFocus={(e) => e.target.select()}
                        onBlur={(e) => setQuantity(item.id, line.quantity, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.currentTarget.blur()
                          }
                        }}
                      />
                      <button
                        type="button"
                        disabled={!isOpen}
                        className="flex size-11 items-center justify-center rounded-sm border-2 border-teal-600 bg-teal-700 text-xl font-bold text-white hover:bg-teal-800 disabled:opacity-40"
                        onClick={() => adjust(item.id, 1)}
                        aria-label="+1"
                      >
                        +
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-grid p-4">
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.comment')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                placeholder={t('warehouse.dailyIssue.commentPh')}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={handleCommentBlur}
                disabled={!isOpen}
              />
            </label>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t border-stone-200 bg-white px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-stone-500">{t('warehouse.dailyIssue.footerHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handlePrint}
              disabled={lineCount === 0}
            >
              {t('warehouse.dailyIssue.print')}
            </Button>
            {isOpen && (
              <Button variant="primary" size="md" onClick={handlePost} disabled={lineCount === 0}>
                {t('warehouse.dailyIssue.post')}
              </Button>
            )}
          </div>
        </div>
      </footer>

      {previewOpen && session && (
        <div className="print-modal-root fixed inset-0 z-[140] flex flex-col bg-stone-900/70">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 print:hidden">
            <p className="text-sm font-semibold text-white">
              {session.number} — {t('warehouse.dailyIssue.printPreview')}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(false)}>
                {t('common.back')}
              </Button>
              <Button variant="secondary" size="sm" onClick={handlePdf} disabled={pdfBusy}>
                {pdfBusy ? '…' : 'PDF'}
              </Button>
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                {t('warehouse.dailyIssue.print')}
              </Button>
            </div>
          </div>
          <div className="print-modal-body flex-1 overflow-auto">
            <div ref={printRef} className="print-area">
              <WarehouseDailyIssuePrintSheet
                store={warehouse}
                session={session}
                site={printMeta?.site}
                responsible={printMeta?.responsible}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )

  return createPortal(modal, document.body)
}

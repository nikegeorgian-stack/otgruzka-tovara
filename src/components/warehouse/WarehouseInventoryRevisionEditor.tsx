import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { WarehouseRevisionRow, type RevisionRowCommit } from '@/components/warehouse/WarehouseRevisionRow'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import type { SaveDraftInput, PostDocumentResult } from '@/lib/warehouse/documents'
import { computeAllBalances } from '@/lib/warehouse/stock'
import type { WarehouseDocument, WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type LineDraft = {
  itemId: string
  counted: string
  touched: boolean
  doubtful: boolean
}

type Baseline = {
  date: string
  number: string
  comment: string
  lines: Record<string, LineDraft>
}

export type InventoryRevisionEditorHandle = {
  isDirty: () => boolean
  saveDraft: () => PostDocumentResult | { ok: false; error: string }
}

type Props = {
  warehouse: WarehouseStore
  warehouseId: string
  categoryNames: Map<string, string>
  document?: WarehouseDocument
  keeperId?: string
  keeperName?: string
  readOnly?: boolean
  onSaveDraft: (doc: SaveDraftInput) => PostDocumentResult
  onPostExistingDocument?: (documentId: string) => PostDocumentResult
  onUnpostDocument?: (documentId: string) => { ok: boolean; error?: string }
  onAcquireLock?: (
    documentId: string,
  ) => { ok: boolean; error?: string; lockedByName?: string }
  onReleaseLock?: (documentId: string) => void
  onQuickEditItem?: (item: WarehouseItem) => void
  onCancel: () => void
  onSaved?: (documentId: string) => void
  /** Скрыть кнопку «Закрыть» — когда закрытие в шапке модалки */
  hideCloseButton?: boolean
}

export const WarehouseInventoryRevisionEditor = forwardRef<
  InventoryRevisionEditorHandle,
  Props
>(function WarehouseInventoryRevisionEditor(
{
  warehouse,
  warehouseId,
  categoryNames,
  document,
  keeperId,
  keeperName,
  readOnly = false,
  onSaveDraft,
  onPostExistingDocument,
  onUnpostDocument,
  onAcquireLock,
  onReleaseLock,
  onQuickEditItem,
  onCancel,
  onSaved,
  hideCloseButton = false,
}: Props,
ref,
) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const whId = warehouseId || warehouse.locations[0]?.id || ''

  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse.items, warehouse.movements, whId],
  )

  const [docId, setDocId] = useState(document?.id)
  const [date, setDate] = useState(document?.date ?? new Date().toISOString().slice(0, 10))
  const [number, setNumber] = useState(
    document?.number ?? nextDocumentNumber(warehouse.documents, 'inventory', date),
  )
  const [comment, setComment] = useState(document?.comment ?? '')
  const [search, setSearch] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)
  const [onlyTouched, setOnlyTouched] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lockHolder, setLockHolder] = useState<string | null>(null)
  /** Перерисовка фильтров / итогов после blur строки */
  const [draftRevision, setDraftRevision] = useState(0)

  const linesRef = useRef<Record<string, LineDraft>>(initLinesFromDocument(document))
  const baselineRef = useRef<Baseline>({
    date: document?.date ?? new Date().toISOString().slice(0, 10),
    number:
      document?.number ?? nextDocumentNumber(warehouse.documents, 'inventory', date),
    comment: document?.comment ?? '',
    lines: cloneLines(initLinesFromDocument(document)),
  })

  const isPosted = (document?.status ?? 'draft') === 'posted'
  const isCancelled = document?.status === 'cancelled'
  const editable = !readOnly && !isPosted && !isCancelled && !lockHolder

  const isDirty = useCallback(() => {
    if (!editable) return false
    const base = baselineRef.current
    if (date !== base.date || number !== base.number || comment !== base.comment) return true
    const lines = linesRef.current
    const keys = new Set([...Object.keys(lines), ...Object.keys(base.lines)])
    for (const key of keys) {
      const a = lines[key]
      const b = base.lines[key]
      if (!a && !b) continue
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) return true
    }
    return false
  }, [comment, date, number, editable])

  const markClean = useCallback(() => {
    baselineRef.current = {
      date,
      number,
      comment,
      lines: cloneLines(linesRef.current),
    }
  }, [comment, date, number])

  const activeItems = useMemo(
    () =>
      warehouse.items
        .filter((i) => i.active && (!whId || i.warehouseId === whId))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
    [warehouse.items, whId],
  )

  const tableModel = useMemo(() => {
    void draftRevision
    const q = search.trim().toLowerCase()
    const lines = linesRef.current

    const filtered = activeItems.filter((item) => {
      if (!q) return true
      const cat = categoryNames.get(item.categoryId) ?? ''
      return (
        item.name.toLowerCase().includes(q) ||
        item.internalCode?.toLowerCase().includes(q) ||
        item.sku?.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      )
    })

    const byCat = new Map<string, typeof filtered>()
    for (const item of filtered) {
      const catId = item.categoryId || '__none'
      if (!byCat.has(catId)) byCat.set(catId, [])
      byCat.get(catId)!.push(item)
    }

    const cats = [...warehouse.categories].sort((a, b) => a.sortOrder - b.sortOrder)
    const groups: {
      catId: string
      catName: string
      rows: {
        item: (typeof filtered)[0]
        book: number
        draft: LineDraft | undefined
      }[]
    }[] = []

    for (const cat of cats) {
      const items = byCat.get(cat.id)
      if (!items?.length) continue
      const rows = items
        .map((item) => {
          const draft = lines[item.id]
          const book = balances.get(item.id)?.balance ?? 0
          const fact =
            draft?.touched && draft.counted !== ''
              ? Number(draft.counted.replace(',', '.'))
              : undefined
          const diff = fact !== undefined && !Number.isNaN(fact) ? fact - book : undefined
          return { item, book, draft, diff }
        })
        .filter((row) => {
          if (onlyTouched && !row.draft?.touched) return false
          if (onlyDiff && (row.diff === undefined || Math.abs(row.diff) < 1e-9)) return false
          return true
        })
      if (rows.length) groups.push({ catId: cat.id, catName: cat.name, rows })
    }

    const none = byCat.get('__none')
    if (none?.length) {
      const rows = none
        .map((item) => {
          const draft = lines[item.id]
          const book = balances.get(item.id)?.balance ?? 0
          const fact =
            draft?.touched && draft.counted !== ''
              ? Number(draft.counted.replace(',', '.'))
              : undefined
          const diff = fact !== undefined && !Number.isNaN(fact) ? fact - book : undefined
          return { item, book, draft, diff }
        })
        .filter((row) => {
          if (onlyTouched && !row.draft?.touched) return false
          if (onlyDiff && (row.diff === undefined || Math.abs(row.diff) < 1e-9)) return false
          return true
        })
      if (rows.length) {
        groups.push({ catId: '__none', catName: t('warehouse.inventory.noCategory'), rows })
      }
    }

    return groups
  }, [
    activeItems,
    balances,
    categoryNames,
    draftRevision,
    onlyDiff,
    onlyTouched,
    search,
    t,
    warehouse.categories,
  ])

  const visibleCount = useMemo(
    () => tableModel.reduce((n, g) => n + g.rows.length, 0),
    [tableModel],
  )

  useEffect(() => {
    if (!docId || !onAcquireLock || isPosted) return
    const res = onAcquireLock(docId)
    if (!res.ok) {
      setLockHolder(res.lockedByName ?? t('warehouse.inventory.lockUnknown'))
      setError(tf('warehouse.inventory.lockFailed', { name: res.lockedByName ?? '—' }))
      return
    }
    return () => onReleaseLock?.(docId)
  }, [docId, onAcquireLock, onReleaseLock, isPosted, t, tf])

  const commitLine = useCallback((line: RevisionRowCommit) => {
    linesRef.current = {
      ...linesRef.current,
      [line.itemId]: {
        itemId: line.itemId,
        counted: line.counted,
        touched: line.touched,
        doubtful: line.doubtful,
      },
    }
    setDraftRevision((n) => n + 1)
  }, [])

  function buildDocumentLines() {
    const out: SaveDraftInput['lines'] = []
    for (const item of activeItems) {
      const draft = linesRef.current[item.id]
      if (!draft?.touched) continue
      const raw = draft.counted
      if (raw === undefined || raw === '') continue
      const counted = Number(raw.replace(',', '.'))
      if (Number.isNaN(counted) || counted < 0) continue
      out.push({
        itemId: item.id,
        quantity: counted,
        bookQty: balances.get(item.id)?.balance ?? 0,
        doubtful: draft.doubtful,
      })
    }
    return out
  }

  const saveDraft = useCallback(() => {
    const docLines = buildDocumentLines()
    if (docLines.length === 0) {
      setError(t('warehouse.inventory.revisionEmpty'))
      return { ok: false as const, error: 'empty' }
    }
    const result = onSaveDraft({
      id: docId,
      type: 'inventory',
      number: number.trim(),
      date,
      warehouseId: whId,
      purpose: 'other',
      comment: comment.trim() || undefined,
      lines: docLines,
      keeperId,
      keeperName,
    })
    if (result.ok) {
      setDocId(result.documentId)
      setError(null)
      setNotice(t('warehouse.doc.draftSaved'))
      markClean()
      onSaved?.(result.documentId)
    } else {
      setError(t(result.error))
    }
    return result
  }, [
    activeItems,
    balances,
    comment,
    date,
    docId,
    keeperId,
    keeperName,
    number,
    onSaveDraft,
    onSaved,
    t,
    whId,
    markClean,
  ])

  useImperativeHandle(
    ref,
    () => ({
      isDirty,
      saveDraft,
    }),
    [isDirty, saveDraft],
  )

  async function handlePost() {
    let id = docId
    const saved = saveDraft()
    if (!saved.ok) return
    id = saved.documentId
    if (!id || !onPostExistingDocument) return
    const lineCount = buildDocumentLines().length
    if (
      !(await confirm({
        message: tf('warehouse.inventory.revisionConfirm', { count: String(lineCount) }),
      }))
    ) {
      return
    }
    const result = onPostExistingDocument(id)
    if (result.ok) {
      setNotice(t('warehouse.doc.postSuccess'))
      onCancel()
    } else {
      setError(t(result.error))
    }
  }

  function fillBookAsFact() {
    const next = { ...linesRef.current }
    const q = search.trim().toLowerCase()
    for (const item of activeItems) {
      if (q) {
        const cat = categoryNames.get(item.categoryId) ?? ''
        const match =
          item.name.toLowerCase().includes(q) ||
          item.internalCode?.toLowerCase().includes(q) ||
          cat.toLowerCase().includes(q)
        if (!match) continue
      }
      const book = balances.get(item.id)?.balance ?? 0
      next[item.id] = {
        itemId: item.id,
        counted: String(book),
        touched: true,
        doubtful: next[item.id]?.doubtful ?? false,
      }
    }
    linesRef.current = next
    setDraftRevision((n) => n + 1)
  }

  let rowNum = 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}
      {lockHolder && (
        <FormNotice type="info" message={tf('warehouse.inventory.lockFailed', { name: lockHolder })} />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-stone-500">
          {t('warehouse.date')}
          <input
            type="date"
            disabled={!editable}
            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm disabled:bg-stone-50"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-xs font-semibold text-stone-500">
          {t('warehouse.doc.number')}
          <input
            disabled={!editable}
            className="mt-1 block w-40 rounded-sm border border-grid px-3 py-2 font-mono text-sm disabled:bg-stone-50"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-semibold text-stone-500">
          {t('warehouse.comment')}
          <input
            disabled={!editable}
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm disabled:bg-stone-50"
            placeholder={t('warehouse.inventory.revisionCommentPh')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        <label className="min-w-[10rem] flex-1 text-xs font-semibold text-stone-500">
          {t('warehouse.search')}
          <input
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          {t('warehouse.inventory.onlyDiff')}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          <input
            type="checkbox"
            checked={onlyTouched}
            onChange={(e) => setOnlyTouched(e.target.checked)}
          />
          {t('warehouse.inventory.onlyTouched')}
        </label>
        {editable && (
          <>
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-paper-dark"
              onClick={fillBookAsFact}
            >
              {t('warehouse.inventory.fillBook')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-paper-dark"
              onClick={saveDraft}
            >
              {t('warehouse.inventory.saveDraft')}
            </button>
            {onPostExistingDocument && (
              <button
                type="button"
                className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                onClick={handlePost}
              >
                {t('warehouse.inventory.post')}
              </button>
            )}
          </>
        )}
        {isPosted && onUnpostDocument && (
          <button
            type="button"
            className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
            onClick={() => {
              if (!docId) return
              const res = onUnpostDocument(docId)
              setNotice(res.ok ? t('warehouse.doc.unpostSuccess') : t(res.error ?? 'unknown'))
            }}
          >
            {t('warehouse.doc.unpost')}
          </button>
        )}
        {!hideCloseButton && (
          <button
            type="button"
            className="ml-auto rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-paper-dark"
            onClick={onCancel}
          >
            {t('common.close')}
          </button>
        )}
      </div>

      <p className="text-xs text-stone-500">{t('warehouse.inventory.revisionHint')}</p>
      {onQuickEditItem && (
        <p className="text-xs text-teal-800">{t('warehouse.inventory.quickEditHint')}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-grid bg-white">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="border border-grid px-2 py-2 text-left">№</th>
              <th className="border border-grid px-2 py-2 text-left">
                {t('warehouse.col.internalCode')}
              </th>
              <th className="border border-grid px-2 py-2 text-left">{t('warehouse.col.name')}</th>
              <th className="border border-grid px-2 py-2">{t('warehouse.col.unit')}</th>
              <th className="border border-grid px-2 py-2 text-right">
                {t('warehouse.inventory.current')}
              </th>
              <th className="border border-grid px-2 py-2 text-right">
                {t('warehouse.inventory.counted')}
              </th>
              <th className="border border-grid px-2 py-2 text-right">
                {t('warehouse.inventory.diff')}
              </th>
              <th className="border border-grid px-2 py-2 text-center">
                {t('warehouse.inventory.doubtful')}
              </th>
            </tr>
          </thead>
          <tbody>
            {tableModel.map((group) => (
              <Fragment key={group.catId}>
                <tr className="bg-teal-50/80">
                  <td
                    colSpan={8}
                    className="border border-grid px-3 py-2 text-xs font-bold uppercase tracking-wide text-teal-900"
                  >
                    {group.catName} · {group.rows.length}
                  </td>
                </tr>
                {group.rows.map(({ item, book, draft }) => {
                  rowNum += 1
                  return (
                    <WarehouseRevisionRow
                      key={item.id}
                      item={item}
                      book={book}
                      rowNum={rowNum}
                      editable={editable}
                      initialCounted={draft?.counted ?? ''}
                      initialTouched={draft?.touched ?? false}
                      initialDoubtful={draft?.doubtful ?? false}
                      onCommit={commitLine}
                      onEditItem={onQuickEditItem}
                      editItemLabel={t('warehouse.inventory.editItem')}
                      doubtfulHint={t('warehouse.inventory.doubtfulHint')}
                    />
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {visibleCount === 0 && (
          <p className="px-4 py-8 text-center text-sm text-stone-400">
            {t('warehouse.inventory.noItems')}
          </p>
        )}
      </div>
    </div>
  )
})

function cloneLines(lines: Record<string, LineDraft>): Record<string, LineDraft> {
  return JSON.parse(JSON.stringify(lines)) as Record<string, LineDraft>
}

function initLinesFromDocument(document?: WarehouseDocument): Record<string, LineDraft> {
  const out: Record<string, LineDraft> = {}
  if (!document) return out
  for (const line of document.lines) {
    out[line.itemId] = {
      itemId: line.itemId,
      counted: String(line.quantity),
      touched: true,
      doubtful: line.doubtful === true,
    }
  }
  return out
}

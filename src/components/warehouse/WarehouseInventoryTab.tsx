import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { TabBar } from '@/components/ui/TabBar'
import { WarehouseInventoryPrintPanel } from '@/components/warehouse/WarehouseInventoryPrintPanel'
import { WarehouseInventoryRevisionModal } from '@/components/warehouse/WarehouseInventoryRevisionModal'
import { useI18n } from '@/context/I18nContext'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import { isDocumentLockedByOther } from '@/lib/warehouse/documentLock'
import type { WarehouseDocument } from '@/lib/warehouse/types'
import type { WarehousePageProps } from './warehouseTypes'

type InvMode = 'print' | 'revision' | 'opening' | 'single'

type Props = Pick<
  WarehousePageProps,
  | 'warehouse'
  | 'onRunInventory'
  | 'onPostOpeningBalances'
  | 'onSaveDocumentDraft'
  | 'onPostExistingDocument'
  | 'onUnpostDocument'
  | 'onAcquireDocumentLock'
  | 'onReleaseDocumentLock'
  | 'onQuickEditItem'
  | 'printMeta'
  | 'keeperId'
  | 'keeperName'
> & {
  warehouseId: string
  categoryNames: Map<string, string>
  asOfIso?: string | null
}

export function WarehouseInventoryTab({
  warehouse,
  warehouseId,
  categoryNames,
  onRunInventory,
  onPostOpeningBalances,
  onSaveDocumentDraft,
  onPostExistingDocument,
  onUnpostDocument,
  onAcquireDocumentLock,
  onReleaseDocumentLock,
  onQuickEditItem,
  printMeta,
  keeperId,
  keeperName,
  asOfIso,
}: Props) {
  const { t, tf } = useI18n()
  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse, whId],
  )

  const [mode, setMode] = useState<InvMode>('revision')
  const [notice, setNotice] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [search, setSearch] = useState('')
  const [editorDoc, setEditorDoc] = useState<WarehouseDocument | undefined | null>(null)

  const [itemId, setItemId] = useState(warehouse.items.find((i) => i.active)?.id ?? '')
  const [counted, setCounted] = useState('')
  const [counts, setCounts] = useState<Record<string, string>>({})

  const activeItems = useMemo(
    () =>
      warehouse.items
        .filter((i) => i.active && (!whId || i.warehouseId === whId))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [warehouse.items, whId],
  )

  const inventoryDocs = useMemo(() => {
    return warehouse.documents
      .filter((d) => d.type === 'inventory' && (!whId || d.warehouseId === whId))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }, [warehouse.documents, whId])

  const openingRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return activeItems
      .filter((item) => {
        if (Math.abs(balances.get(item.id)?.balance ?? 0) >= 1e-9) return false
        if (!q) return true
        return item.name.toLowerCase().includes(q) || item.internalCode?.toLowerCase().includes(q)
      })
      .map((item) => {
        const raw = counts[item.id]
        const qty = raw === undefined || raw === '' ? undefined : Number(raw.replace(',', '.'))
        return { item, qty }
      })
  }, [activeItems, balances, counts, search])

  const item = warehouse.items.find((i) => i.id === itemId)
  const current = balances.get(itemId)?.balance ?? 0

  function setCount(itemId: string, value: string) {
    setCounts((prev) => ({ ...prev, [itemId]: value }))
  }

  function submitSingle(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(counted.replace(',', '.'))
    if (!itemId || Number.isNaN(n) || n < 0) return
    onRunInventory({ itemId, warehouseId: whId, counted: n, date, comment: comment || undefined })
    setCounted('')
    setNotice(t('warehouse.inventory.singleDone'))
  }

  async function submitOpening() {
    const lines = openingRows
      .filter((r) => r.qty !== undefined && !Number.isNaN(r.qty!) && r.qty! > 0)
      .map((r) => ({ itemId: r.item.id, quantity: r.qty! }))
    if (lines.length === 0) {
      setNotice(t('warehouse.inventory.openingEmpty'))
      return
    }
    const result = onPostOpeningBalances({
      warehouseId: whId,
      date,
      comment: comment || undefined,
      lines,
    })
    setNotice(
      tf('warehouse.inventory.openingDone', {
        applied: result.applied,
        skipped: result.skipped,
      }),
    )
    setCounts({})
  }

  function openRevisionEditor(doc?: WarehouseDocument) {
    if (doc && isDocumentLockedByOther(doc, keeperId)) {
      setNotice(tf('warehouse.inventory.lockFailed', { name: doc.lockedByName ?? '—' }))
      return
    }
    setEditorDoc(doc ?? undefined)
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-grid bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-stone-500">
          {t('warehouse.date')}
          <input
            type="date"
            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-semibold text-stone-500">
          {t('warehouse.comment')}
          <input
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={
              mode === 'print'
                ? t('warehouse.inventory.printCommentPh')
                : mode === 'opening'
                  ? t('warehouse.inventory.openingCommentPh')
                  : t('warehouse.inventory.revisionCommentPh')
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {mode === 'opening' && (
          <label className="min-w-[10rem] flex-1 text-xs font-semibold text-stone-500">
            {t('warehouse.search')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
      </div>

      <TabBar
        tabs={(
          [
            ['revision', 'warehouse.inventory.tabRevision'],
            ['print', 'warehouse.inventory.tabPrint'],
            ['opening', 'warehouse.inventory.tabOpening'],
            ['single', 'warehouse.inventory.tabSingle'],
          ] as const
        ).map(([id, key]) => ({ id, label: t(key) }))}
        value={mode}
        onChange={setMode}
      />

      {mode === 'print' && (
        <WarehouseInventoryPrintPanel
          warehouse={warehouse}
          date={date}
          comment={comment}
          site={printMeta?.site}
          responsible={printMeta?.responsible}
          asOfIso={asOfIso}
        />
      )}

      {mode === 'revision' && editorDoc === null && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-grid bg-white p-4 shadow-sm">
            <div>
              <h3 className="font-bold text-ink">{t('warehouse.inventory.revisionTitle')}</h3>
              <p className="mt-1 text-sm text-stone-500">{t('warehouse.inventory.revisionDocHint')}</p>
            </div>
            {onSaveDocumentDraft && (
              <button
                type="button"
                className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                onClick={() => openRevisionEditor()}
              >
                {t('warehouse.inventory.newRevision')}
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-3">{t('warehouse.date')}</th>
                  <th className="px-3 py-3">{t('warehouse.doc.number')}</th>
                  <th className="px-3 py-3">{t('warehouse.doc.status')}</th>
                  <th className="px-3 py-3 text-right">{t('warehouse.doc.lines')}</th>
                  <th className="px-3 py-3">{t('warehouse.comment')}</th>
                </tr>
              </thead>
              <tbody>
                {inventoryDocs.map((doc) => {
                  const locked = isDocumentLockedByOther(doc, keeperId)
                  const doubtfulCount = doc.lines.filter((l) => l.doubtful).length
                  return (
                    <tr
                      key={doc.id}
                      className={`cursor-pointer border-b border-grid/60 hover:bg-stone-50 ${
                        doc.status === 'draft' ? 'bg-amber-50/30' : ''
                      }`}
                      title={t('warehouse.doc.doubleClickEdit')}
                      onDoubleClick={() => openRevisionEditor(doc)}
                    >
                      <td className="px-4 py-2.5">{doc.date}</td>
                      <td className="px-3 py-2.5 font-mono text-xs font-medium">{doc.number}</td>
                      <td className="px-3 py-2.5">
                        {doc.status === 'cancelled' ? (
                          <span className="text-red-700">{t('warehouse.doc.status.cancelled')}</span>
                        ) : doc.status === 'draft' ? (
                          <span className="font-medium text-amber-700">
                            {locked
                              ? tf('warehouse.inventory.lockedBy', { name: doc.lockedByName ?? '—' })
                              : t('warehouse.doc.status.draft')}
                          </span>
                        ) : (
                          <span className="text-emerald-700">{t('warehouse.doc.status.posted')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {doc.lines.length}
                        {doubtfulCount > 0 && (
                          <span className="ml-1 text-violet-700" title={t('warehouse.inventory.doubtful')}>
                            · {doubtfulCount} ?
                          </span>
                        )}
                      </td>
                      <td className="max-w-[16rem] truncate px-3 py-2.5 text-stone-600">
                        {doc.comment || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {inventoryDocs.length === 0 && (
              <p className="px-6 py-10 text-center text-sm text-stone-400">
                {t('warehouse.inventory.noRevisionDocs')}
              </p>
            )}
          </div>
        </div>
      )}

      {mode === 'single' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={submitSingle}
            className="space-y-4 rounded-sm border border-grid bg-white p-5 shadow-sm"
          >
            <h3 className="font-bold text-ink">{t('warehouse.inventory.title')}</h3>
            <p className="text-sm text-stone-500">{t('warehouse.inventory.hint')}</p>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.col.name')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                {activeItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm">
              {t('warehouse.inventory.current')}:{' '}
              <span className="font-bold tabular-nums">
                {formatQty(current)} {item?.unit ?? ''}
              </span>
            </p>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.inventory.counted')} *
              <input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-sm bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
            >
              {t('warehouse.inventory.apply')}
            </button>
          </form>
          <RecentInventoryLog warehouse={warehouse} />
        </div>
      )}

      {mode === 'opening' && (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{t('warehouse.inventory.openingTitle')}</h3>
              <p className="mt-1 text-sm text-stone-500">{t('warehouse.inventory.openingHint')}</p>
            </div>
            <button
              type="button"
              className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              onClick={submitOpening}
            >
              {t('warehouse.inventory.openingApply')}
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                  <th className="border border-grid px-2 py-2 text-left">№</th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.internalCode')}
                  </th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.name')}
                  </th>
                  <th className="border border-grid px-2 py-2">{t('warehouse.col.unit')}</th>
                  <th className="border border-grid px-2 py-2 text-right">
                    {t('warehouse.inventory.openingQty')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {openingRows.map((row, idx) => (
                  <tr key={row.item.id}>
                    <td className="border border-grid px-2 py-1 text-center font-mono text-xs">
                      {idx + 1}
                    </td>
                    <td className="border border-grid px-2 py-1 font-mono text-xs">
                      {row.item.internalCode}
                    </td>
                    <td className="border border-grid px-2 py-1">{row.item.name}</td>
                    <td className="border border-grid px-2 py-1 text-center text-xs">
                      {row.item.unit}
                    </td>
                    <td className="border border-grid p-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full border-0 bg-transparent px-2 py-1.5 text-right font-mono"
                        value={counts[row.item.id] ?? ''}
                        onChange={(e) => setCount(row.item.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openingRows.length === 0 && (
            <p className="mt-4 text-center text-sm text-stone-400">
              {t('warehouse.inventory.openingAllSet')}
            </p>
          )}
        </div>
      )}

      {mode !== 'single' && mode !== 'revision' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <RecentInventoryLog warehouse={warehouse} />
        </div>
      )}

      {editorDoc !== null && onSaveDocumentDraft && (
        <WarehouseInventoryRevisionModal
          open
          title={
            editorDoc
              ? `${t('warehouse.doc.type.inventory')} №${editorDoc.number}`
              : t('warehouse.inventory.newRevision')
          }
          onClose={() => setEditorDoc(null)}
          warehouse={warehouse}
          warehouseId={whId}
          categoryNames={categoryNames}
          document={editorDoc}
          keeperId={keeperId}
          keeperName={keeperName}
          readOnly={editorDoc?.status === 'posted' || editorDoc?.status === 'cancelled'}
          onSaveDraft={onSaveDocumentDraft}
          onPostExistingDocument={onPostExistingDocument}
          onUnpostDocument={onUnpostDocument}
          onAcquireLock={onAcquireDocumentLock}
          onReleaseLock={onReleaseDocumentLock}
          onQuickEditItem={onQuickEditItem}
          onSaved={() => setNotice(t('warehouse.doc.draftSaved'))}
        />
      )}
    </div>
  )
}

function RecentInventoryLog({
  warehouse,
}: {
  warehouse: Pick<WarehousePageProps['warehouse'], 'auditLog'>
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="font-bold text-ink">{t('warehouse.inventory.recent')}</h3>
      <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
        {[...warehouse.auditLog]
          .filter((e) => e.action === 'inventory')
          .slice(-25)
          .reverse()
          .map((e) => (
            <li key={e.id} className="border-b border-grid/60 pb-2">
              <span className="text-stone-400">{e.at.slice(0, 16).replace('T', ' ')}</span>
              <p>{e.detail}</p>
            </li>
          ))}
      </ul>
    </div>
  )
}

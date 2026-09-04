import { useMemo, useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { FormNotice } from '@/components/ui/FormNotice'
import {
  WarehouseDocumentEditor,
  type WarehouseDocumentEditorHandle,
} from '@/components/warehouse/WarehouseDocumentEditor'
import { NomenclaturePicker } from '@/components/warehouse/NomenclaturePicker'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { CloseIcon } from '@/components/ui/icons'
import { formatQty } from '@/lib/warehouse/stock'
import { buildItemStockLedger } from '@/lib/warehouse/stockLedger'
import { buildItemMovementSupervisionRows, type MovementSupervisionKind } from '@/lib/warehouse/movementSupervision'
import type { ItemBalance, StockMovementType } from '@/lib/warehouse/types'
import type { WarehousePageProps } from './warehouseTypes'

type Props = Pick<
  WarehousePageProps,
  | 'warehouse'
  | 'brigades'
  | 'onPostDocument'
  | 'onPostTransfer'
  | 'onSaveDocumentDraft'
  | 'onMergeInvoiceRegistry'
  | 'onAddMovement'
  | 'onDeleteMovement'
  | 'printMeta'
  | 'allowNegativeStock'
  | 'counterparties'
  | 'onUpsertCounterparty'
  | 'onOpenCounterparties'
  | 'productionRequests'
  | 'keeperId'
  | 'keeperName'
> & {
  warehouseId: string
  categoryNames: Map<string, string>
  balances: Map<string, ItemBalance>
  asOfIso?: string | null
  /** Переход в документ (для режима надзора движения) */
  onOpenWarehouseDocument?: (documentId: string) => void
}

function MovementTypeBadge({ type }: { type: StockMovementType }) {
  const { t } = useI18n()
  const styles: Record<string, string> = {
    receipt: 'bg-emerald-100 text-emerald-800',
    issue: 'bg-red-100 text-red-800',
    adjustment: 'bg-stone-200 text-stone-700',
    reserve: 'bg-amber-100 text-amber-800',
    unreserve: 'bg-sky-100 text-sky-800',
    inventory: 'bg-violet-100 text-violet-800',
  }
  const labels: Record<string, string> = {
    receipt: t('warehouse.receiptShort'),
    issue: t('warehouse.issueShort'),
    adjustment: t('warehouse.adjustmentShort'),
    reserve: t('warehouse.reserveShort'),
    unreserve: t('warehouse.unreserveShort'),
    inventory: t('warehouse.inventoryShort'),
  }
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase ${styles[type] ?? ''}`}>
      {labels[type] ?? type}
    </span>
  )
}

export function WarehouseMovementsTab({
  warehouse,
  warehouseId,
  brigades,
  categoryNames,
  balances,
  printMeta,
  allowNegativeStock = false,
  counterparties,
  onUpsertCounterparty,
  onOpenCounterparties,
  productionRequests,
  keeperId,
  keeperName,
  onPostDocument,
  onPostTransfer,
  onSaveDocumentDraft,
  onMergeInvoiceRegistry,
  onAddMovement,
  onDeleteMovement,
  onOpenWarehouseDocument,
  asOfIso,
}: Props) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const [mode, setMode] = useState<'document' | 'other' | 'supervision'>('document')
  /** null = выбор на странице; иначе открыто окно прихода/расхода */
  const [docType, setDocType] = useState<'receipt' | 'issue' | null>(null)
  const [docDirty, setDocDirty] = useState(false)
  const docEditorRef = useRef<WarehouseDocumentEditorHandle>(null)

  const [itemId, setItemId] = useState<string | null>(null)
  const [opType, setOpType] = useState<StockMovementType>('adjustment')
  const [qty, setQty] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  /** Карточка учёта (ledger) по выбранной позиции — мониторинг цепочки. */
  const [ledgerItemId, setLedgerItemId] = useState<string | null>(null)

  const itemMap = useMemo(() => new Map(warehouse.items.map((i) => [i.id, i])), [warehouse.items])
  const activeItems = useMemo(() => warehouse.items.filter((i) => i.active), [warehouse.items])

  const [supervisionItemId, setSupervisionItemId] = useState<string | null>(null)
  const [supervisionFrom, setSupervisionFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [supervisionTo, setSupervisionTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [supervisionKind, setSupervisionKind] = useState<'all' | MovementSupervisionKind>('all')
  const [supervisionFromWh, setSupervisionFromWh] = useState<string | null>(null)
  const [supervisionToWh, setSupervisionToWh] = useState<string | null>(null)

  const recent = useMemo(
    () =>
      [...warehouse.movements]
        .filter((m) => !warehouseId || m.warehouseId === warehouseId)
        .filter((m) => !asOfIso || m.createdAt <= asOfIso)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 40),
    [warehouse.movements, warehouseId, asOfIso],
  )

  const ledgerRows = useMemo(() => {
    if (!ledgerItemId) return null
    return buildItemStockLedger(ledgerItemId, warehouse.movements, {
      warehouseId: warehouseId || undefined,
      asOfIso,
      newestFirst: true,
    }).slice(0, 80)
  }, [ledgerItemId, warehouse.movements, warehouseId, asOfIso])

  const showLedger = Boolean(ledgerItemId && ledgerRows)

  function submitOther(e: React.FormEvent) {
    e.preventDefault()
    if (!itemId) {
      setFormError(t('warehouse.err.itemRequired'))
      return
    }
    const quantity = Number(qty.replace(',', '.'))
    if (!qty.trim() || Number.isNaN(quantity) || quantity <= 0) {
      setFormError(t('warehouse.err.qtyInvalid'))
      return
    }
    setFormError(null)
    onAddMovement({
      itemId,
      warehouseId: whId,
      type: opType,
      quantity,
      date,
      comment: comment || undefined,
    })
    setQty('')
    setComment('')
    setItemId(null)
  }

  const otherTypes: StockMovementType[] = ['adjustment', 'reserve', 'unreserve']

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_minmax(18rem,24rem)]">
      <div className="space-y-4 min-w-0">
        <div className="flex rounded-sm border border-grid bg-white p-1 shadow-sm w-fit">
          <button
            type="button"
            className={`rounded-sm px-4 py-2 text-sm font-semibold ${
              mode === 'document' ? 'bg-teal-700 text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
            onClick={() => setMode('document')}
          >
            {t('warehouse.doc.modeDocument')}
          </button>
          <button
            type="button"
            className={`rounded-sm px-4 py-2 text-sm font-semibold ${
              mode === 'other' ? 'bg-teal-700 text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
            onClick={() => setMode('other')}
          >
            {t('warehouse.doc.modeOther')}
          </button>
          <button
            type="button"
            className={`rounded-sm px-4 py-2 text-sm font-semibold ${
              mode === 'supervision' ? 'bg-teal-700 text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
            onClick={() => setMode('supervision')}
            data-coach="warehouse:movementSupervision"
          >
            {t('warehouse.doc.modeSupervision')}
          </button>
        </div>

        {mode === 'document' ? (
          <div className="rounded-sm border border-grid bg-white p-6 shadow-sm">
            <h3 className="text-base font-bold text-ink">{t('warehouse.doc.startTitle')}</h3>
            <p className="mt-1 text-sm text-stone-500">{t('warehouse.doc.startHint')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="flex flex-col items-start gap-1 rounded-sm border-2 border-emerald-600 bg-emerald-50/50 px-5 py-4 text-left hover:bg-emerald-50"
                onClick={() => {
                  setDocDirty(false)
                  setDocType('receipt')
                }}
              >
                <span className="text-base font-bold text-emerald-800">
                  {t('warehouse.doc.startReceipt')}
                </span>
                <span className="text-xs text-emerald-700/80">
                  {t('warehouse.doc.startReceiptHint')}
                </span>
              </button>
              <button
                type="button"
                className="flex flex-col items-start gap-1 rounded-sm border-2 border-red-600 bg-red-50/50 px-5 py-4 text-left hover:bg-red-50"
                onClick={() => {
                  setDocDirty(false)
                  setDocType('issue')
                }}
              >
                <span className="text-base font-bold text-red-800">
                  {t('warehouse.doc.startIssue')}
                </span>
                <span className="text-xs text-red-700/80">
                  {t('warehouse.doc.startIssueHint')}
                </span>
              </button>
            </div>
          </div>
        ) : mode === 'other' ? (
          <form
            onSubmit={submitOther}
            className="space-y-4 rounded-sm border border-grid bg-white p-5 shadow-sm"
          >
            <h3 className="font-bold text-ink">{t('warehouse.doc.modeOther')}</h3>
            {formError && (
              <FormNotice type="error" message={formError} onDismiss={() => setFormError(null)} />
            )}
            <div className="flex flex-wrap gap-2">
              {otherTypes.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-sm border px-3 py-2 text-xs font-semibold ${
                    opType === id ? 'border-teal-700 bg-teal-700 text-white' : 'border-grid'
                  }`}
                  onClick={() => setOpType(id)}
                >
                  {id === 'adjustment'
                    ? t('warehouse.adjustment')
                    : id === 'reserve'
                      ? t('warehouse.reserve')
                      : t('warehouse.unreserve')}
                </button>
              ))}
            </div>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.col.name')}
              <div className="mt-1">
                <NomenclaturePicker
                  items={activeItems}
                  categoryNames={categoryNames}
                  balances={balances}
                  warehouseId={whId}
                  value={itemId}
                  onChange={setItemId}
                />
              </div>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.quantity')}
              <input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.date')}
              <input
                type="date"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.comment')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-sm bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
            >
              {t('warehouse.saveMovement')}
            </button>
          </form>
        ) : (
          <div className="space-y-4 rounded-sm border border-grid bg-white p-5 shadow-sm">
            <h3 className="font-bold text-ink">{t('warehouse.supervision.title')}</h3>
            <p className="text-sm text-stone-500">{t('warehouse.supervision.hint')}</p>

            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.supervision.item')}
              <div className="mt-1">
                <NomenclaturePicker
                  items={activeItems}
                  categoryNames={categoryNames}
                  balances={balances}
                  warehouseId={whId}
                  value={supervisionItemId}
                  onChange={setSupervisionItemId}
                />
              </div>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.supervision.from')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={supervisionFrom}
                  onChange={(e) => setSupervisionFrom(e.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.supervision.to')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={supervisionTo}
                  onChange={(e) => setSupervisionTo(e.target.value)}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.supervision.kind')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={supervisionKind}
                  onChange={(e) => setSupervisionKind(e.target.value as any)}
                >
                  <option value="all">{t('common.all')}</option>
                  <option value="transfer">{t('warehouse.supervision.kind.transfer')}</option>
                  <option value="receipt">{t('warehouse.supervision.kind.receipt')}</option>
                  <option value="issue">{t('warehouse.supervision.kind.issue')}</option>
                  <option value="inventory">{t('warehouse.supervision.kind.inventory')}</option>
                  <option value="adjustment">{t('warehouse.supervision.kind.adjustment')}</option>
                  <option value="reserve">{t('warehouse.supervision.kind.reserve')}</option>
                  <option value="unreserve">{t('warehouse.supervision.kind.unreserve')}</option>
                  <option value="other">{t('warehouse.supervision.kind.other')}</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.supervision.fromWh')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={supervisionFromWh ?? ''}
                  onChange={(e) => setSupervisionFromWh(e.target.value ? e.target.value : null)}
                >
                  <option value="">{t('common.any')}</option>
                  {warehouse.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.supervision.toWh')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={supervisionToWh ?? ''}
                onChange={(e) => setSupervisionToWh(e.target.value ? e.target.value : null)}
              >
                <option value="">{t('common.any')}</option>
                {warehouse.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      <div
        data-coach="warehouse:movementLedger"
        className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm xl:max-h-[calc(100vh-12rem)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grid px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {showLedger
              ? t('warehouse.ledger.title')
              : t('warehouse.journal')}
            {showLedger && ledgerItemId ? (
              <span className="ml-2 font-normal normal-case text-stone-600">
                {itemMap.get(ledgerItemId)?.name ?? '—'}
              </span>
            ) : null}
          </div>
          {showLedger ? (
            <button
              type="button"
              className="text-xs font-medium text-teal-800 hover:underline"
              onClick={() => setLedgerItemId(null)}
            >
              {t('warehouse.ledger.showAll')}
            </button>
          ) : null}
        </div>

        {mode === 'supervision' ? (
          <SupervisionTable
            warehouse={warehouse}
            itemId={supervisionItemId}
            warehouseId={whId}
            fromDate={supervisionFrom}
            toDate={supervisionTo}
            asOfIso={asOfIso}
            kind={supervisionKind}
            fromWarehouseId={supervisionFromWh}
            toWarehouseId={supervisionToWh}
            onOpenWarehouseDocument={onOpenWarehouseDocument}
            categoryNames={categoryNames}
            balances={balances}
            allowNegativeStock={allowNegativeStock}
          />
        ) : (
        (showLedger ? (ledgerRows?.length ?? 0) === 0 : recent.length === 0) ? (
          <p className="p-6 text-sm text-stone-400">{t('warehouse.noMovements')}</p>
        ) : (
          <div className="max-h-[32rem] overflow-auto xl:max-h-none">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-stone-50 text-xs text-stone-500">
                <tr>
                  <th className="px-2 py-2 text-left">{t('warehouse.date')}</th>
                  <th className="px-2 py-2 text-left">{t('warehouse.col.name')}</th>
                  <th className="px-2 py-2">{t('warehouse.type')}</th>
                  <th className="px-2 py-2 text-right">
                    {showLedger ? t('warehouse.ledger.delta') : t('warehouse.quantity')}
                  </th>
                  {showLedger ? (
                    <th className="px-2 py-2 text-right">{t('warehouse.ledger.balance')}</th>
                  ) : null}
                  <th className="px-1 py-2" />
                </tr>
              </thead>
              <tbody>
                {showLedger && ledgerRows
                  ? ledgerRows.map((row) => {
                      const m = row.movement
                      const item = itemMap.get(m.itemId)
                      return (
                        <tr key={m.id} className="border-t border-grid/60">
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-stone-600">
                            {m.date}
                          </td>
                          <td className="max-w-[8rem] truncate px-2 py-2 text-xs" title={item?.name}>
                            {item?.name ?? '—'}
                            {m.documentNo && (
                              <span className="block text-[10px] text-stone-400">
                                № {m.documentNo}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <MovementTypeBadge type={m.type} />
                          </td>
                          <td
                            className={`px-2 py-2 text-right tabular-nums text-xs font-medium ${
                              row.delta < 0 ? 'text-red-700' : 'text-emerald-800'
                            }`}
                          >
                            {row.delta > 0 ? '+' : ''}
                            {formatQty(row.delta)}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-xs font-semibold text-ink">
                            {formatQty(row.balanceAfter)}
                          </td>
                          <td className="px-1 py-2 text-right">
                            {m.documentId ? (
                              <span
                                className="text-[10px] text-stone-400"
                                title={t('warehouse.err.cannotDeleteLinkedMovement')}
                              >
                                {t('warehouse.linkedDocShort')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                aria-label={t('common.delete')}
                                className="text-red-600 hover:text-red-700"
                                onClick={async () => {
                                  if (
                                    !(await confirm({
                                      message: t('warehouse.confirmDeleteMovement'),
                                      danger: true,
                                    }))
                                  )
                                    return
                                  if (!onDeleteMovement(m.id)) {
                                    setFormError(t('warehouse.err.cannotDeleteLinkedMovement'))
                                  }
                                }}
                              >
                                <CloseIcon size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  : recent.map((m) => {
                      const item = itemMap.get(m.itemId)
                      return (
                        <tr key={m.id} className="border-t border-grid/60">
                          <td className="whitespace-nowrap px-2 py-2 text-xs text-stone-600">
                            {m.date}
                          </td>
                          <td className="max-w-[8rem] truncate px-2 py-2 text-xs" title={item?.name}>
                            <button
                              type="button"
                              className="text-left hover:text-teal-800 hover:underline"
                              title={t('warehouse.ledger.openHint')}
                              onClick={() => setLedgerItemId(m.itemId)}
                            >
                              {item?.name ?? '—'}
                            </button>
                            {m.documentNo && (
                              <span className="block text-[10px] text-stone-400">
                                № {m.documentNo}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <MovementTypeBadge type={m.type} />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-xs font-medium">
                            {formatQty(Math.abs(m.quantity))}
                          </td>
                          <td className="px-1 py-2 text-right">
                            {m.documentId ? (
                              <span
                                className="text-[10px] text-stone-400"
                                title={t('warehouse.err.cannotDeleteLinkedMovement')}
                              >
                                {t('warehouse.linkedDocShort')}
                              </span>
                            ) : (
                              <button
                                type="button"
                                aria-label={t('common.delete')}
                                className="text-red-600 hover:text-red-700"
                                onClick={async () => {
                                  if (
                                    !(await confirm({
                                      message: t('warehouse.confirmDeleteMovement'),
                                      danger: true,
                                    }))
                                  )
                                    return
                                  if (!onDeleteMovement(m.id)) {
                                    setFormError(t('warehouse.err.cannotDeleteLinkedMovement'))
                                  }
                                }}
                              >
                                <CloseIcon size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
              </tbody>
            </table>
          </div>
        )
        )}
      </div>

      {docType ? (
        <AppDialog
          open
          size="preview"
          title={docType === 'receipt' ? t('warehouse.receipt') : t('warehouse.issue')}
          dirty={docDirty}
          onSaveDirty={async () => {
            const ok = docEditorRef.current?.saveDraft()
            if (ok === false) throw new Error('draft_save_failed')
          }}
          onClose={() => {
            setDocType(null)
            setDocDirty(false)
          }}
          initialFocus="none"
        >
          <div className="px-4 py-3">
            <WarehouseDocumentEditor
              key={docType}
              ref={docEditorRef}
              warehouse={warehouse}
              categoryNames={categoryNames}
              balances={balances}
              brigades={brigades}
              warehouseId={whId}
              variant="modal"
              lockType
              initialType={docType}
              printMeta={printMeta}
              allowNegativeStock={allowNegativeStock}
              counterparties={counterparties}
              onUpsertCounterparty={onUpsertCounterparty}
              onOpenCounterparties={onOpenCounterparties}
              productionRequests={productionRequests}
              keeperId={keeperId}
              keeperName={keeperName}
              onDirtyChange={setDocDirty}
              onCancel={() => {
                setDocType(null)
                setDocDirty(false)
              }}
              onPost={async (doc) => {
                const result = await Promise.resolve(onPostDocument(doc))
                if (result.ok) {
                  setDocType(null)
                  setDocDirty(false)
                }
                return result
              }}
              onPostTransfer={
                onPostTransfer
                  ? (doc) => {
                      const result = onPostTransfer(doc)
                      if (result.ok) {
                        setDocType(null)
                        setDocDirty(false)
                      }
                      return result
                    }
                  : undefined
              }
              onSaveDraft={
                onSaveDocumentDraft
                  ? (doc) => {
                      const result = onSaveDocumentDraft(doc)
                      if (result.ok) {
                        setDocType(null)
                        setDocDirty(false)
                      }
                      return result
                    }
                  : undefined
              }
              onMergeInvoiceRegistry={onMergeInvoiceRegistry}
            />
          </div>
        </AppDialog>
      ) : null}
    </div>
  )
}

function SupervisionTable({
  warehouse,
  itemId,
  warehouseId,
  fromDate,
  toDate,
  asOfIso,
  kind,
  fromWarehouseId,
  toWarehouseId,
  onOpenWarehouseDocument,
}: {
  warehouse: WarehousePageProps['warehouse']
  itemId: string | null
  warehouseId: string
  fromDate: string
  toDate: string
  asOfIso?: string | null
  kind: 'all' | MovementSupervisionKind
  fromWarehouseId?: string | null
  toWarehouseId?: string | null
  onOpenWarehouseDocument?: (documentId: string) => void
  categoryNames: Map<string, string>
  balances: Map<string, any>
  allowNegativeStock: boolean
}) {
  const { t } = useI18n()
  const rows = useMemo(() => {
    if (!itemId) return []
    return buildItemMovementSupervisionRows(warehouse, {
      itemId,
      warehouseId: warehouseId || undefined,
      fromDate,
      toDate,
      asOfIso: asOfIso ?? null,
      fromWarehouseId,
      toWarehouseId,
      kind,
    })
  }, [warehouse, itemId, warehouseId, fromDate, toDate, asOfIso, fromWarehouseId, toWarehouseId, kind])

  return (
    <div className="max-h-[32rem] overflow-auto xl:max-h-none">
      {itemId && rows.length === 0 ? (
        <p className="p-6 text-sm text-stone-400">{t('warehouse.supervision.empty')}</p>
      ) : !itemId ? (
        <p className="p-6 text-sm text-stone-400">{t('warehouse.supervision.pickItem')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-stone-50 text-xs text-stone-500">
            <tr>
              <th className="px-2 py-2 text-left">{t('warehouse.date')}</th>
              <th className="px-2 py-2 text-left">{t('warehouse.supervision.from')}</th>
              <th className="px-2 py-2 text-left">{t('warehouse.supervision.to')}</th>
              <th className="px-2 py-2 text-right">{t('warehouse.supervision.qty')}</th>
              <th className="px-2 py-2 text-left">{t('warehouse.supervision.type')}</th>
              <th className="px-2 py-2 text-left">{t('warehouse.supervision.docs')}</th>
              <th className="px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-grid/60">
                <td className="whitespace-nowrap px-2 py-2 text-xs text-stone-600">{r.date}</td>
                <td className="px-2 py-2 text-xs text-stone-600">{r.fromWarehouseName ?? '—'}</td>
                <td className="px-2 py-2 text-xs text-stone-600">{r.toWarehouseName ?? '—'}</td>
                <td className={`px-2 py-2 text-right tabular-nums text-xs font-medium ${r.delta != null && r.delta < 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                  {r.delta != null ? (r.delta > 0 ? '+' : '') + formatQty(r.delta) : formatQty(r.qtyAbs)}
                </td>
                <td className="px-2 py-2 text-xs">
                  {r.kind}
                </td>
                <td className="px-2 py-2 text-xs text-stone-600">
                  {r.docNumbers.length ? r.docNumbers.join(' / ') : '—'}
                </td>
                <td className="px-1 py-2 text-right">
                  {r.docIds.length && onOpenWarehouseDocument ? (
                    <button
                      type="button"
                      className="text-teal-700 hover:underline"
                      onClick={() => onOpenWarehouseDocument(r.docReceiptId ?? r.docIssueId ?? r.docIds[0])}
                    >
                      {t('common.open')}
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import {
  getWarehouseAccountingState,
  isWarehouseAccountingActive,
} from '@/lib/warehouse/accountingStatus'
import type { OpeningInventoryLineInput } from '@/lib/warehouse/openingInventory'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { PostDocumentResult } from '@/lib/warehouse/documents'

type Props = {
  warehouse: WarehouseStore
  warehouseId: string
  keeperId?: string
  keeperName?: string
  onSaveDraft: (input: {
    id?: string
    number: string
    date: string
    warehouseId: string
    comment?: string
    lines: OpeningInventoryLineInput[]
  }) => PostDocumentResult | Promise<PostDocumentResult>
  onPost: (input: {
    id?: string
    documentId?: string
    number: string
    date: string
    warehouseId: string
    comment?: string
    lines: OpeningInventoryLineInput[]
  }) => PostDocumentResult | Promise<PostDocumentResult>
}

export function WarehouseOpeningInventoryPanel({
  warehouse,
  warehouseId,
  keeperId,
  keeperName,
  onSaveDraft,
  onPost,
}: Props) {
  const { t } = useI18n()
  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const accounting = getWarehouseAccountingState(warehouse, whId)
  const active = isWarehouseAccountingActive(warehouse, whId)

  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse, whId],
  )

  const items = useMemo(
    () =>
      warehouse.items
        .filter((i) => i.active && (!whId || i.warehouseId === whId))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [warehouse.items, whId],
  )

  const existingDraft = useMemo(
    () =>
      warehouse.documents.find(
        (d) =>
          d.status === 'draft' &&
          d.warehouseId === whId &&
          (d.isOpeningInventory || d.purpose === 'opening_inventory'),
      ),
    [warehouse.documents, whId],
  )

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [number, setNumber] = useState(
    () => existingDraft?.number || `НВИ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
  )
  const [comment, setComment] = useState(existingDraft?.comment ?? '')
  const [counts, setCounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const line of existingDraft?.lines ?? []) {
      init[line.itemId] = String(line.quantity)
    }
    return init
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [draftId, setDraftId] = useState<string | undefined>(existingDraft?.id)

  const rows = useMemo(() => {
    return items.map((item) => {
      const book = balances.get(item.id)?.balance ?? 0
      const raw = counts[item.id]
      const counted =
        raw === undefined || raw === '' ? undefined : Number(String(raw).replace(',', '.'))
      const delta =
        counted === undefined || Number.isNaN(counted) ? undefined : counted - book
      return { item, book, counted, delta }
    })
  }, [items, balances, counts])

  const previewLines = rows.filter(
    (r) => r.counted !== undefined && !Number.isNaN(r.counted!),
  )

  function buildLines(): OpeningInventoryLineInput[] {
    return previewLines.map((r) => ({
      itemId: r.item.id,
      countedQty: r.counted!,
    }))
  }

  async function handleSaveDraft() {
    if (!whId) {
      setNotice(t('warehouse.accounting.pickWarehouse'))
      return
    }
    if (previewLines.length === 0) {
      setNotice(t('warehouse.accounting.openingEmpty'))
      return
    }
    const result = await Promise.resolve(
      onSaveDraft({
        id: draftId,
        number,
        date,
        warehouseId: whId,
        comment: comment || undefined,
        lines: buildLines(),
      }),
    )
    if (!result.ok) {
      setNotice(t(result.error) || result.error)
      return
    }
    setDraftId(result.documentId)
    setNotice(t('warehouse.accounting.draftSaved'))
  }

  function handleConfirmPost() {
    if (!whId) {
      setNotice(t('warehouse.accounting.pickWarehouse'))
      return
    }
    if (previewLines.length === 0) {
      setNotice(t('warehouse.accounting.openingEmpty'))
      return
    }
    setConfirmOpen(true)
  }

  async function handlePost() {
    setConfirmOpen(false)
    const result = await Promise.resolve(
      onPost({
        id: draftId,
        documentId: draftId,
        number,
        date,
        warehouseId: whId,
        comment: comment || undefined,
        lines: buildLines(),
      }),
    )
    if (!result.ok) {
      setNotice(t(result.error) || result.error)
      return
    }
    setNotice(t('warehouse.accounting.activated'))
  }

  if (!whId) {
    return (
      <div className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        {t('warehouse.accounting.pickWarehouse')}
      </div>
    )
  }

  if (active) {
    return (
      <div className="rounded-sm border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        <p className="font-semibold">{t('warehouse.accounting.statusActive')}</p>
        {accounting.activatedAt && (
          <p className="mt-1 text-xs">
            {t('warehouse.accounting.activatedAt')}: {accounting.activatedAt.slice(0, 16).replace('T', ' ')}
            {accounting.activatedByName ? ` · ${accounting.activatedByName}` : ''}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <p className="font-semibold">{t('warehouse.accounting.bannerTitle')}</p>
        <p className="mt-1 text-xs">{t('warehouse.accounting.bannerBody')}</p>
        <p className="mt-1 text-xs font-medium">
          {t('warehouse.accounting.statusLabel')}:{' '}
          {accounting.status === 'reconciling'
            ? t('warehouse.accounting.statusReconciling')
            : t('warehouse.accounting.statusUninitialized')}
        </p>
      </div>

      {notice && (
        <FormNotice
          type={notice === t('warehouse.accounting.activated') ? 'success' : 'info'}
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-stone-500">{t('warehouse.doc.number')}</span>
          <input
            className="rounded-sm border border-grid px-2 py-1.5"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-stone-500">{t('warehouse.accounting.countDate')}</span>
          <input
            type="date"
            className="rounded-sm border border-grid px-2 py-1.5"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="text-xs text-stone-500">{t('warehouse.comment')}</span>
          <input
            className="rounded-sm border border-grid px-2 py-1.5"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={keeperName || ''}
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-sm border border-grid">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-2 py-2">{t('warehouse.col.name')}</th>
              <th className="px-2 py-2">{t('warehouse.col.unit')}</th>
              <th className="px-2 py-2">{t('warehouse.accounting.bookQty')}</th>
              <th className="px-2 py-2">{t('warehouse.accounting.countedQty')}</th>
              <th className="px-2 py-2">{t('warehouse.accounting.delta')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ item, book, delta }) => (
              <tr key={item.id} className="border-t border-grid">
                <td className="px-2 py-1.5">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-stone-500">{item.internalCode}</div>
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">{item.unit}</td>
                <td className="px-2 py-1.5 font-mono text-xs text-stone-500">
                  {formatQty(book)}
                  <div className="text-[10px] normal-case text-amber-800">
                    {t('warehouse.accounting.bookUntrusted')}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className="w-24 rounded-sm border border-grid px-2 py-1 font-mono text-sm"
                    value={counts[item.id] ?? ''}
                    onChange={(e) =>
                      setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="—"
                  />
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {delta === undefined
                    ? '—'
                    : `${delta > 0 ? '+' : ''}${formatQty(delta)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm hover:bg-stone-50"
          onClick={handleSaveDraft}
        >
          {t('warehouse.accounting.saveDraft')}
        </button>
        <button type="button" className="btn-add" onClick={handleConfirmPost}>
          {t('warehouse.accounting.postAndActivate')}
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-sm border border-grid bg-white p-4 shadow-lg">
            <p className="font-semibold">{t('warehouse.accounting.confirmTitle')}</p>
            <p className="mt-2 text-sm text-stone-600">
              {t('warehouse.accounting.confirmBody')}
            </p>
            <p className="mt-2 text-xs text-stone-500">
              {t('warehouse.accounting.confirmMeta')
                .replace('{lines}', String(previewLines.length))
                .replace('{keeper}', keeperName || keeperId || '—')}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                onClick={() => setConfirmOpen(false)}
              >
                {t('common.cancel')}
              </button>
              <button type="button" className="btn-add" onClick={handlePost}>
                {t('warehouse.accounting.confirmPost')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

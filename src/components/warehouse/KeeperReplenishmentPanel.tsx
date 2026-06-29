import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  activeReplenishmentRequests,
  archivedReplenishmentRequests,
} from '@/lib/warehouse/keeperReplenishment'
import { filterConsumableItems } from '@/lib/warehouse/locationKindFilter'
import { formatQty } from '@/lib/warehouse/stock'
import { unitLabel } from '@/lib/warehouse/units'
import type { KeeperReplenishmentRequest, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  warehouseId: string
  keeperId?: string
  keeperName?: string
  onCreate: () => string
  onCreateFromDeficit: () => string | null
  onSubmit: (id: string) => void
  onCancel: (id: string) => void
  onReceive: (
    id: string,
    lines: { itemId: string; quantity: number }[],
  ) => { ok: boolean; error?: string; documentNumber?: string }
  onUpdateDraft: (
    id: string,
    lines: { itemId: string; requestedQty: number; note?: string }[],
  ) => void
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-stone-100 text-stone-700',
  submitted: 'bg-sky-100 text-sky-800',
  partial: 'bg-amber-100 text-amber-900',
  received: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-stone-200 text-stone-600',
}

export function KeeperReplenishmentPanel({
  warehouse,
  warehouseId,
  onCreate,
  onCreateFromDeficit,
  onSubmit,
  onCancel,
  onReceive,
  onUpdateDraft,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [view, setView] = useState<'active' | 'archive'>('active')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [receiveId, setReceiveId] = useState<string | null>(null)
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({})

  const itemMap = useMemo(
    () => new Map(warehouse.items.map((i) => [i.id, i])),
    [warehouse.items],
  )

  const active = useMemo(() => activeReplenishmentRequests(warehouse), [warehouse])
  const archive = useMemo(() => archivedReplenishmentRequests(warehouse), [warehouse])
  const list = view === 'active' ? active : archive

  const receiveRequest = receiveId
    ? (warehouse.replenishmentRequests ?? []).find((r) => r.id === receiveId)
    : null

  function handleCreate() {
    setError(null)
    const id = onCreate()
    if (id) setNotice(t('warehouse.replenishment.created'))
  }

  function handleFromDeficit() {
    setError(null)
    const id = onCreateFromDeficit()
    if (!id) {
      setError(t('warehouse.replenishment.noDeficit'))
      return
    }
    setNotice(t('warehouse.replenishment.fromDeficitOk'))
  }

  async function handleSubmit(req: KeeperReplenishmentRequest) {
    if (!(await confirm({ message: t('warehouse.replenishment.submitConfirm') }))) return
    onSubmit(req.id)
    setNotice(t('warehouse.replenishment.submitted'))
  }

  function openReceive(req: KeeperReplenishmentRequest) {
    const qty: Record<string, string> = {}
    for (const line of req.lines) {
      const remaining = Math.max(0, line.requestedQty - line.receivedQty)
      if (remaining > 0) qty[line.itemId] = formatQty(remaining)
    }
    setReceiveQty(qty)
    setReceiveId(req.id)
  }

  async function handleReceiveConfirm() {
    if (!receiveRequest) return
    const lines = receiveRequest.lines
      .map((line) => {
        const raw = receiveQty[line.itemId]?.trim().replace(',', '.')
        const qty = raw ? Number(raw) : 0
        if (!Number.isFinite(qty) || qty <= 0) return null
        return { itemId: line.itemId, quantity: qty }
      })
      .filter(Boolean) as { itemId: string; quantity: number }[]

    if (lines.length === 0) {
      setError(t('warehouse.replenishment.errNothing'))
      return
    }

    const res = onReceive(receiveRequest.id, lines)
    if (!res.ok) {
      setError(t(res.error ?? 'warehouse.replenishment.errGeneric'))
      return
    }
    setReceiveId(null)
    setNotice(
      tf('warehouse.replenishment.receivedOk', { doc: res.documentNumber ?? '—' }),
    )
  }

  function addLineToDraft(req: KeeperReplenishmentRequest, itemId: string) {
    if (!itemId || req.lines.some((l) => l.itemId === itemId)) return
    onUpdateDraft(req.id, [
      ...req.lines,
      { itemId, requestedQty: 1 },
    ])
  }

  return (
    <div className="space-y-4">
      <Card
        title={t('warehouse.replenishment.title')}
        description={t('warehouse.replenishment.hint')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={handleCreate}>
              {t('warehouse.replenishment.new')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleFromDeficit}>
              {t('warehouse.replenishment.fromDeficit')}
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              view === 'active' ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
            }`}
            onClick={() => setView('active')}
          >
            {t('warehouse.replenishment.tabActive')} ({active.length})
          </button>
          <button
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              view === 'archive' ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
            }`}
            onClick={() => setView('archive')}
          >
            {t('warehouse.replenishment.tabArchive')} ({archive.length})
          </button>
        </div>

        {notice && (
          <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />
        )}
        {error && (
          <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
        )}

        {list.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">
            {view === 'active'
              ? t('warehouse.replenishment.emptyActive')
              : t('warehouse.replenishment.emptyArchive')}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {list.map((req) => (
              <li key={req.id} className="rounded-sm border border-grid bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold text-ink">{req.number}</p>
                    <p className="text-xs text-stone-500">
                      {req.date} · {req.keeperName} · {req.lines.length}{' '}
                      {t('warehouse.replenishment.pos')}
                    </p>
                  </div>
                  <span className={`fc-badge ${STATUS_CLASS[req.status] ?? ''}`}>
                    {t(`warehouse.replenishment.status.${req.status}`)}
                  </span>
                </div>

                <ul className="mt-3 divide-y divide-grid/60 text-sm">
                  {req.lines.map((line) => {
                    const item = itemMap.get(line.itemId)
                    return (
                      <li key={line.itemId} className="flex justify-between gap-2 py-1.5">
                        <span className="truncate text-ink">
                          {item?.name ?? line.itemId}
                          <span className="ml-2 text-xs text-stone-400">
                            {item?.internalCode}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-xs">
                          {formatQty(line.receivedQty)} / {formatQty(line.requestedQty)}{' '}
                          {unitLabel(item?.unit ?? 'шт', locale)}
                        </span>
                      </li>
                    )
                  })}
                </ul>

                {req.status === 'draft' && view === 'active' && (
                  <DraftEditor
                    warehouse={warehouse}
                    warehouseId={warehouseId}
                    req={req}
                    onAddLine={(itemId) => addLineToDraft(req, itemId)}
                    onUpdateLine={(lines) => onUpdateDraft(req.id, lines)}
                  />
                )}

                {view === 'active' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {req.status === 'draft' && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => handleSubmit(req)}>
                          {t('warehouse.replenishment.submit')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onCancel(req.id)}>
                          {t('common.cancel')}
                        </Button>
                      </>
                    )}
                    {(req.status === 'submitted' || req.status === 'partial') && (
                      <>
                        <Button variant="primary" size="sm" onClick={() => openReceive(req)}>
                          {t('warehouse.replenishment.receive')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onCancel(req.id)}>
                          {t('warehouse.replenishment.cancelRequest')}
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {req.warehouseDocumentIds.length > 0 && (
                  <p className="mt-2 text-xs text-stone-500">
                    {t('warehouse.replenishment.receipts')}: {req.warehouseDocumentIds.length}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {receiveRequest && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-stone-900/50 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-sm border border-grid bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-ink">
              {t('warehouse.replenishment.receiveTitle')} {receiveRequest.number}
            </h3>
            <p className="mt-1 text-sm text-stone-500">{t('warehouse.replenishment.receiveHint')}</p>
            <ul className="mt-4 space-y-3">
              {receiveRequest.lines
                .filter((l) => l.receivedQty < l.requestedQty - 1e-9)
                .map((line) => {
                  const item = itemMap.get(line.itemId)
                  const remaining = line.requestedQty - line.receivedQty
                  return (
                    <li key={line.itemId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm">{item?.name}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-24 rounded-sm border border-grid px-2 py-1.5 text-center font-mono text-sm"
                        value={receiveQty[line.itemId] ?? ''}
                        onChange={(e) =>
                          setReceiveQty((prev) => ({ ...prev, [line.itemId]: e.target.value }))
                        }
                        aria-label={item?.name}
                      />
                      <span className="text-xs text-stone-400">
                        / {formatQty(remaining)}
                      </span>
                    </li>
                  )
                })}
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setReceiveId(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="sm" onClick={handleReceiveConfirm}>
                {t('warehouse.replenishment.postReceipt')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DraftEditor({
  warehouse,
  warehouseId,
  req,
  onAddLine,
  onUpdateLine,
}: {
  warehouse: WarehouseStore
  warehouseId: string
  req: KeeperReplenishmentRequest
  onAddLine: (itemId: string) => void
  onUpdateLine: (lines: { itemId: string; requestedQty: number; note?: string }[]) => void
}) {
  const { t } = useI18n()
  const [pickId, setPickId] = useState('')
  const items = useMemo(
    () =>
      filterConsumableItems(
        warehouse.items,
        warehouse.categories,
        warehouseId,
        warehouse.locations,
      ).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [warehouse.items, warehouse.categories, warehouse.locations, warehouseId],
  )

  return (
    <div className="mt-3 rounded-sm border border-dashed border-grid bg-stone-50 p-3">
      <p className="text-xs font-semibold text-stone-600">{t('warehouse.replenishment.editDraft')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          className="fc-input min-w-[12rem] flex-1"
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
        >
          <option value="">{t('warehouse.replenishment.pickItem')}</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.internalCode})
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          size="sm"
          disabled={!pickId}
          onClick={() => {
            onAddLine(pickId)
            setPickId('')
          }}
        >
          +
        </Button>
      </div>
      {req.lines.map((line, idx) => (
        <div key={line.itemId} className="mt-2 flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            className="w-24 rounded-sm border border-grid px-2 py-1 text-sm font-mono"
            value={formatQty(line.requestedQty)}
            onChange={(e) => {
              const v = Number(e.target.value.replace(',', '.'))
              if (!Number.isFinite(v) || v < 0) return
              const next = req.lines.map((l, i) =>
                i === idx ? { ...l, requestedQty: v } : l,
              )
              onUpdateLine(next)
            }}
          />
          <span className="flex-1 truncate text-xs text-stone-600">
            {warehouse.items.find((i) => i.id === line.itemId)?.name}
          </span>
        </div>
      ))}
    </div>
  )
}

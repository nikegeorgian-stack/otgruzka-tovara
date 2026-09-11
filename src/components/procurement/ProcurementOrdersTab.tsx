import { useMemo, useState } from 'react'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { TransportModeBadge } from '@/components/procurement/TransportModeIcon'
import { ReceivePurchaseOrderModal } from '@/components/procurement/ReceivePurchaseOrderModal'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { orderTotalAmount } from '@/lib/procurement/codes'
import type { ReceiveOrderOpts } from '@/lib/procurement/receive'
import {
  daysUntil,
  isOverdue,
  orderEtaDate,
  orderPlannedShipmentDate,
  receivedPercent,
} from '@/lib/procurement/status'
import type { PurchaseOrder } from '@/lib/procurement/types'
import type { ProcurementPageProps } from './procurementTypes'

type Props = Pick<ProcurementPageProps, 'counterparties'> & {
  orders: PurchaseOrder[]
  onEdit: (order: PurchaseOrder) => void
  onRemove?: (id: string) => void
  onReceive?: (
    id: string,
    opts?: ReceiveOrderOpts,
  ) =>
    | { ok: boolean; error?: string; documentId?: string }
    | Promise<{ ok: boolean; error?: string; documentId?: string }>
}

export function ProcurementOrdersTab({ orders, counterparties, onEdit, onRemove, onReceive }: Props) {
  const { t } = useI18n()
  const { confirm, alert } = useConfirm()
  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null)

  async function openReceive(o: PurchaseOrder) {
    if (!onReceive) return
    if (o.status === 'draft') {
      await alert({ message: t('procurement.receive.errDraft') })
      return
    }
    const early =
      o.status !== 'arrived' && o.status !== 'partial' && o.status !== 'customs'
    if (early) {
      if (
        !(await confirm({
          title: t('procurement.receive.title'),
          message: t('procurement.receive.confirmEarly'),
          confirmLabel: t('common.continue'),
        }))
      ) {
        return
      }
    }
    setReceiveOrder(o)
  }

  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  if (!orders.length) {
    return (
      <p className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center text-sm text-stone-500">
        {t('procurement.empty')}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {receiveOrder && onReceive ? (
        <ReceivePurchaseOrderModal
          order={receiveOrder}
          onClose={() => setReceiveOrder(null)}
          onConfirm={async (opts) => {
            const res = await onReceive(receiveOrder.id, opts)
            if (res.ok) {
              void alert({ message: t('procurement.receive.done') })
            }
            return res
          }}
        />
      ) : null}

      <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <th className="px-3 py-2">{t('procurement.col.number')}</th>
              <th className="px-3 py-2">{t('procurement.col.supplier')}</th>
              <th className="px-3 py-2">{t('procurement.col.status')}</th>
              <th className="px-3 py-2">{t('procurement.col.eta')}</th>
              <th className="px-3 py-2 text-right">{t('procurement.col.amount')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const supplier = cpMap.get(o.counterpartyId)
              const recv = receivedPercent(o)
              const eta = orderEtaDate(o)
              const etaDays = eta ? daysUntil(eta) : undefined
              const overdue = isOverdue(o)
              return (
                <tr key={o.id} className="border-b border-grid/60 hover:bg-stone-50/80">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="font-mono text-xs font-semibold text-teal-800 hover:underline"
                      onClick={() => onEdit(o)}
                    >
                      {o.orderNumber}
                    </button>
                    {o.legs[0]?.transportMode ? (
                      <span className="ml-2 inline-block align-middle">
                        <TransportModeBadge mode={o.legs[0].transportMode} />
                      </span>
                    ) : null}
                    {recv > 0 && recv < 100 ? (
                      <p className="mt-1 text-[10px] text-amber-700">
                        {recv}% {t('procurement.received')}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-stone-700">{supplier?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-3 py-2 text-xs text-stone-600">
                    {eta ?? '—'}
                    {etaDays !== undefined && o.status !== 'received' && o.status !== 'cancelled' && (
                      <span
                        className={`ml-1 ${overdue ? 'font-semibold text-red-600' : 'text-stone-400'}`}
                      >
                        ({overdue ? t('procurement.overdue') : `${etaDays}d`})
                      </span>
                    )}
                    {orderPlannedShipmentDate(o) ? (
                      <p className="text-[10px] text-stone-400">
                        {t('procurement.col.shipment')}: {orderPlannedShipmentDate(o)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {orderTotalAmount(o).toLocaleString('ru-RU')} {o.currency}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="text-xs text-teal-700 hover:underline"
                      onClick={() => onEdit(o)}
                    >
                      {t('common.edit')}
                    </button>
                    {onReceive &&
                      ['approved', 'ordered', 'partial'].includes(o.status) &&
                      recv < 100 && (
                        <button
                          type="button"
                          className="ml-2 text-xs font-semibold text-emerald-700 hover:underline"
                          data-coach="procurement:receive"
                          onClick={() => void openReceive(o)}
                        >
                          {t('procurement.receive.action')}
                        </button>
                      )}
                    {o.status === 'draft' && onRemove && (
                      <button
                        type="button"
                        className="ml-2 text-xs text-red-600 hover:underline"
                        onClick={async () => {
                          if (
                            await confirm({ message: t('procurement.confirmDelete'), danger: true })
                          ) {
                            onRemove(o.id)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { TransportModeBadge } from '@/components/procurement/TransportModeIcon'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { orderTotalAmount } from '@/lib/procurement/codes'
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
  onRemove: (id: string) => void
  onReceive?: (id: string) => { ok: boolean; error?: string }
}

export function ProcurementOrdersTab({ orders, counterparties, onEdit, onRemove, onReceive }: Props) {
  const { t } = useI18n()
  const { confirm, alert } = useConfirm()

  async function handleReceive(o: PurchaseOrder) {
    if (!onReceive) return
    if (!(await confirm({ title: t('procurement.receive.title'), message: t('procurement.receive.confirm'), confirmLabel: t('procurement.receive.action') }))) {
      return
    }
    const res = onReceive(o.id)
    if (!res.ok) {
      await alert({ message: t(res.error ?? 'procurement.receive.errNothing') })
      return
    }
    await alert({ message: t('procurement.receive.done') })
  }
  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  if (!orders.length) {
    return (
      <div className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-16 text-center text-stone-500">
        {t('procurement.empty')}
      </div>
    )
  }

  const sorted = [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate))

  return (
    <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('procurement.col.number')}</th>
              <th className="px-3 py-3">{t('procurement.col.supplier')}</th>
              <th className="px-3 py-3">{t('procurement.col.scope')}</th>
              <th className="px-3 py-3">{t('procurement.col.status')}</th>
              <th className="px-3 py-3">{t('procurement.col.shipment')}</th>
              <th className="px-3 py-3">{t('procurement.col.eta')}</th>
              <th className="px-3 py-3">{t('procurement.col.transport')}</th>
              <th className="px-3 py-3 text-right">{t('procurement.col.amount')}</th>
              <th className="px-3 py-3 w-28" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const supplier = cpMap.get(o.counterpartyId)
              const eta = orderEtaDate(o)
              const ship = orderPlannedShipmentDate(o)
              const overdue = isOverdue(o)
              const etaDays = daysUntil(eta)
              const mainTransport = o.legs[0]?.transportMode
              const total = orderTotalAmount(o)
              const recv = receivedPercent(o)
              return (
                <tr
                  key={o.id}
                  className={`border-t border-grid/60 hover:bg-stone-50/80 ${overdue ? 'bg-red-50/40' : ''}`}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-left font-mono text-xs font-semibold text-teal-800 hover:underline"
                      onClick={() => onEdit(o)}
                    >
                      {o.orderNumber}
                    </button>
                    <p className="text-[10px] text-stone-400">{o.orderDate}</p>
                  </td>
                  <td className="max-w-[10rem] truncate px-3 py-3" title={supplier?.name}>
                    {supplier?.name ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {t(`procurement.scope.${o.scope}`)}
                    <span className="mt-0.5 block text-[10px] text-stone-400">
                      {t(`procurement.category.${o.category}`)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <OrderStatusBadge status={o.status} />
                    {recv > 0 && recv < 100 && (
                      <p className="mt-1 text-[10px] text-amber-700">{recv}% {t('procurement.received')}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums">
                    {ship ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs">
                    <span className={`tabular-nums ${overdue ? 'font-bold text-red-700' : ''}`}>
                      {eta ?? '—'}
                    </span>
                    {etaDays !== undefined && o.status !== 'received' && o.status !== 'cancelled' && (
                      <p
                        className={`text-[10px] ${overdue ? 'text-red-600' : etaDays <= 7 ? 'text-amber-600' : 'text-stone-400'}`}
                      >
                        {overdue
                          ? t('procurement.overdueDays').replace('{n}', String(Math.abs(etaDays)))
                          : t('procurement.inDays').replace('{n}', String(etaDays))}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {mainTransport ? <TransportModeBadge mode={mainTransport} /> : '—'}
                    {o.legs.length > 1 && (
                      <p className="mt-0.5 text-[10px] text-stone-400">
                        +{o.legs.length - 1} {t('procurement.legsMore')}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-xs font-medium">
                    {total > 0 ? (
                      <>
                        {total.toLocaleString('ru-RU', { maximumFractionDigits: 0 })}{' '}
                        <span className="text-stone-400">{o.currency}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs text-teal-700 hover:underline"
                      onClick={() => onEdit(o)}
                    >
                      {t('common.edit')}
                    </button>
                    {onReceive && o.status !== 'received' && o.status !== 'cancelled' && recv < 100 && (
                      <button
                        type="button"
                        className="ml-2 text-xs font-semibold text-emerald-700 hover:underline"
                        onClick={() => void handleReceive(o)}
                      >
                        {t('procurement.receive.action')}
                      </button>
                    )}
                    {o.status === 'draft' && (
                      <button
                        type="button"
                        className="ml-2 text-xs text-red-600 hover:underline"
                        onClick={async () => {
                          if (await confirm({ message: t('procurement.confirmDelete'), danger: true })) {
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

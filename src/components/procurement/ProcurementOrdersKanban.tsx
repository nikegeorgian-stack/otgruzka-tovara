import { useMemo } from 'react'
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import { orderTotalAmount } from '@/lib/procurement/codes'
import { ORDER_STATUS_FLOW } from '@/lib/procurement/status'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/procurement/types'
import type { CounterpartyStore } from '@/lib/counterparties/types'

const KANBAN_COLUMNS: PurchaseOrderStatus[] = [...ORDER_STATUS_FLOW, 'cancelled']

type Props = {
  orders: PurchaseOrder[]
  counterparties: CounterpartyStore
  onEdit: (order: PurchaseOrder) => void
  onSetStatus: (orderId: string, status: PurchaseOrderStatus) => void
}

export function ProcurementOrdersKanban({
  orders,
  counterparties,
  onEdit,
  onSetStatus,
}: Props) {
  const { t } = useI18n()
  const { draggingId, dropColumnId, cardDragProps, columnDropProps } =
    useKanbanDrag<PurchaseOrderStatus>()

  const cpMap = useMemo(
    () => new Map(counterparties.items.map((c) => [c.id, c])),
    [counterparties.items],
  )

  function byStatus(status: PurchaseOrderStatus) {
    return orders.filter((o) => o.status === status)
  }

  function handleDrop(itemId: string, status: PurchaseOrderStatus) {
    const order = orders.find((o) => o.id === itemId)
    if (order && order.status !== status) onSetStatus(order.id, status)
  }

  if (!orders.length) {
    return (
      <p className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center text-sm text-stone-500">
        {t('procurement.empty')}
      </p>
    )
  }

  return (
    <div data-coach="procurement:ordersKanban">
      <KanbanBoard>
      {KANBAN_COLUMNS.map((status) => {
        const col = byStatus(status)
        return (
          <KanbanColumn
            key={status}
            title={t(`procurement.status.${status}`)}
            count={col.length}
            isDropTarget={dropColumnId === status}
            isDragging={!!draggingId}
            dropHandlers={columnDropProps(status, handleDrop)}
          >
            {col.map((o) => {
              const supplier = cpMap.get(o.counterpartyId)
              const total = orderTotalAmount(o)
              return (
                <KanbanCardShell
                  key={o.id}
                  dragging={draggingId === o.id}
                  dragProps={cardDragProps(o.id)}
                  onClick={() => onEdit(o)}
                >
                  <div className="font-mono text-[11px] font-semibold text-sky-800">
                    {o.orderNumber || '—'}
                  </div>
                  <div className="mt-0.5 truncate text-xs font-medium text-stone-900">
                    {supplier?.name ?? '—'}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <OrderStatusBadge status={status} />
                    {total > 0 ? (
                      <span className="text-[10px] tabular-nums text-stone-500">
                        {total.toLocaleString('ru-RU')} {o.currency}
                      </span>
                    ) : null}
                  </div>
                  {o.requestedDeliveryDate ? (
                    <div className="mt-1 text-[10px] text-stone-500">{o.requestedDeliveryDate}</div>
                  ) : null}
                </KanbanCardShell>
              )
            })}
          </KanbanColumn>
        )
      })}
      </KanbanBoard>
    </div>
  )
}

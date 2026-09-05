import { useMemo } from 'react'
import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { useI18n } from '@/context/I18nContext'
import {
  SALES_ORDER_STATUSES,
  salesStatusLabel,
  type SalesOrder,
  type SalesOrderStatus,
} from '@/lib/sales/types'
import type { SalesOrderMetrics } from '@/lib/sales/calc'

type Props = {
  orders: SalesOrder[]
  metricsById: Map<string, SalesOrderMetrics>
  onSetStatus: (id: string, status: SalesOrderStatus) => void
  onOpenOrder: (order: SalesOrder) => void
}

const COLUMNS: SalesOrderStatus[] = [
  'draft',
  'confirmed',
  'in_production',
  'shipped',
  'completed',
  'cancelled',
]

export function SalesOrderKanban({ orders, metricsById, onSetStatus, onOpenOrder }: Props) {
  const { locale } = useI18n()
  const { draggingId, dropColumnId, cardDragProps, columnDropProps } =
    useKanbanDrag<SalesOrderStatus>()

  const toneByStatus = useMemo(
    () => new Map(SALES_ORDER_STATUSES.map((s) => [s.key, s.tone])),
    [],
  )

  function byStatus(status: SalesOrderStatus) {
    return orders.filter((o) => o.status === status)
  }

  function handleDrop(itemId: string, status: SalesOrderStatus) {
    const order = orders.find((o) => o.id === itemId)
    if (order && order.status !== status) onSetStatus(order.id, status)
  }

  return (
    <div data-coach="director:ordersKanban">
      <KanbanBoard>
      {COLUMNS.map((status) => {
        const col = byStatus(status)
        const tone = toneByStatus.get(status)
        return (
          <KanbanColumn
            key={status}
            title={salesStatusLabel(status, locale)}
            count={col.length}
            isDropTarget={dropColumnId === status}
            isDragging={!!draggingId}
            dropHandlers={columnDropProps(status, handleDrop)}
          >
            {col.map((o) => {
              const m = metricsById.get(o.id)
              return (
                <KanbanCardShell
                  key={o.id}
                  dragging={draggingId === o.id}
                  dragProps={cardDragProps(o.id)}
                  onClick={() => onOpenOrder(o)}
                  className={[
                    m?.atRisk ? 'border-l-4 border-l-red-500' : '',
                    tone === 'danger' ? 'opacity-80' : '',
                  ].join(' ')}
                >
                  <div className="font-mono text-[11px] font-semibold text-sky-800">
                    {o.orderNumber || '—'}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-stone-700">{o.customer}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-stone-500">
                    {o.dueDate ? (
                      <span className={m?.atRisk ? 'font-medium text-red-600' : ''}>
                        {o.dueDate}
                      </span>
                    ) : null}
                    {m ? <span>{Math.round(m.donePct)}%</span> : null}
                  </div>
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

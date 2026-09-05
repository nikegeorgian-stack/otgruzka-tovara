import { useMemo } from 'react'
import {
  KanbanBoard,
  KanbanCardShell,
  KanbanColumn,
  useKanbanDrag,
} from '@/components/kanban'
import { ProductColorBadge } from '@/components/ui/ProductColorBadge'
import { useI18n } from '@/context/I18nContext'
import { canActivateProductionOrder } from '@/lib/planner/activateGate'
import { summarizeOrder } from '@/lib/planner/stats'
import type { ProductionOrder, PlannerOrderStatus } from '@/lib/planner/types'
import { formatNum } from '@/lib/production/stats'
import { resolveOrderProductColor } from '@/lib/finishedProducts/colors'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { ProductionRequest } from '@/lib/production/types'

const COLUMNS: PlannerOrderStatus[] = ['draft', 'active', 'paused', 'completed', 'cancelled']

const STATUS_RING: Record<PlannerOrderStatus, string> = {
  draft: 'border-l-4 border-l-stone-300',
  active: 'border-l-4 border-l-teal-500',
  paused: 'border-l-4 border-l-amber-500',
  completed: 'border-l-4 border-l-emerald-500',
  cancelled: 'border-l-4 border-l-stone-200 opacity-75',
}

type Props = {
  orders: ProductionOrder[]
  requests: ProductionRequest[]
  finishedProducts: FinishedProduct[]
  onOpen: (order: ProductionOrder) => void
  onMoveStatus: (orderId: string, status: PlannerOrderStatus) => void
}

export function PlannerOrdersKanban({
  orders,
  requests,
  finishedProducts,
  onOpen,
  onMoveStatus,
}: Props) {
  const { t } = useI18n()
  const { draggingId, dropColumnId, cardDragProps, columnDropProps } =
    useKanbanDrag<PlannerOrderStatus>()

  const summaries = useMemo(
    () => new Map(orders.map((o) => [o.id, summarizeOrder(o, requests)])),
    [orders, requests],
  )

  function byStatus(status: PlannerOrderStatus) {
    return orders.filter((o) => o.status === status)
  }

  function handleDrop(itemId: string, status: PlannerOrderStatus) {
    const order = orders.find((o) => o.id === itemId)
    if (!order || order.status === status) return
    if (status === 'active') {
      const gate = canActivateProductionOrder(order)
      if (!gate.ok) return
    }
    onMoveStatus(order.id, status)
  }

  if (!orders.length) {
    return (
      <p className="rounded-sm border border-dashed border-grid bg-white p-6 text-center text-sm text-stone-500">
        {t('planner.empty')}
      </p>
    )
  }

  return (
    <div data-coach="planner:ordersKanban">
      <KanbanBoard>
      {COLUMNS.map((status) => {
        const col = byStatus(status)
        return (
          <KanbanColumn
            key={status}
            title={t(`planner.status.${status}`)}
            count={col.length}
            isDropTarget={dropColumnId === status}
            isDragging={!!draggingId}
            dropHandlers={columnDropProps(status, handleDrop)}
          >
            {col.map((o) => {
              const sum = summaries.get(o.id)
              const color = resolveOrderProductColor(o, finishedProducts)
              return (
                <KanbanCardShell
                  key={o.id}
                  dragging={draggingId === o.id}
                  dragProps={cardDragProps(o.id)}
                  onClick={() => onOpen(o)}
                  className={STATUS_RING[o.status]}
                >
                  <div className="flex items-start gap-2">
                    <ProductColorBadge productColor={color} colorLogo={o.colorLogo} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-ink">
                        {o.orderNumber || t('planner.draft')}
                      </div>
                      <div className="truncate text-[11px] text-stone-600">{o.productName}</div>
                      {o.customer ? (
                        <div className="truncate text-[10px] text-stone-400">{o.customer}</div>
                      ) : null}
                    </div>
                  </div>
                  {sum ? (
                    <div className="mt-2 text-[10px] tabular-nums text-stone-500">
                      {sum.completionPct}% · {formatNum(sum.factMp)}/{formatNum(o.totalQtyMp)}{' '}
                      {t('planner.unitMp')}
                    </div>
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

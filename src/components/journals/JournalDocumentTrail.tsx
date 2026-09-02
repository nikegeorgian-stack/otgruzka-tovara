import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { buildItemStockLedger } from '@/lib/warehouse/stockLedger'
import { formatQty, movementDelta } from '@/lib/warehouse/stock'
import type { AppStore } from '@/lib/types'
import type { UnifiedJournalEntry } from '@/lib/journals/types'

type Props = {
  store: AppStore
  entry: UnifiedJournalEntry
}

function resolveMovementId(entry: UnifiedJournalEntry): string | undefined {
  if (entry.id.startsWith('wh-m-')) return entry.id.slice('wh-m-'.length)
  if (entry.category === 'warehouse_movements' && entry.refId) return entry.refId
  return undefined
}

/** Цепочка связанных движений и документов склада. */
export function JournalDocumentTrail({ store, entry }: Props) {
  const { t } = useI18n()

  const trail = useMemo(() => {
    const items: { label: string; detail: string; at?: string }[] = []

    if (entry.link?.kind === 'warehouse_document' && entry.category !== 'warehouse_movements') {
      const docId = entry.link.documentId
      const doc = store.warehouse.documents.find((d) => d.id === docId)
      if (doc) {
        items.push({
          label: t('journals.trail.document'),
          detail: `${doc.number} · ${doc.type} · ${doc.lines.length} поз.`,
          at: doc.postedAt ?? doc.createdAt,
        })
        if (doc.purchaseOrderId) {
          const po = store.procurement.orders.find((o) => o.id === doc.purchaseOrderId)
          if (po) {
            items.push({
              label: t('journals.trail.procurement'),
              detail: po.orderNumber,
              at: po.updatedAt ?? po.createdAt,
            })
          }
        }
        const moves = store.warehouse.movements.filter((m) => m.documentId === doc.id)
        for (const m of moves.slice(0, 8)) {
          const item = store.warehouse.items.find((i) => i.id === m.itemId)
          items.push({
            label: t('journals.trail.movement'),
            detail: `${item?.name ?? m.itemId.slice(0, 8)} · ${m.quantity} · ${m.type}`,
            at: m.createdAt,
          })
        }
      }
    }

    if (entry.link?.kind === 'procurement_order') {
      const orderId = entry.link.orderId
      const order = store.procurement.orders.find((o) => o.id === orderId)
      if (order) {
        items.push({
          label: t('journals.trail.procurement'),
          detail: order.orderNumber,
          at: order.createdAt,
        })
        const history = order.statusHistory ?? []
        for (const h of history.slice(-5)) {
          items.push({
            label: h.toStatus,
            detail: h.note ?? h.toStatus,
            at: h.at,
          })
        }
      }
    }

    const movementId = resolveMovementId(entry)
    if (movementId) {
      const move = store.warehouse.movements.find((m) => m.id === movementId)
      if (move) {
        const item = store.warehouse.items.find((i) => i.id === move.itemId)
        const delta = movementDelta(move.type, move.quantity)
        items.push({
          label: t('journals.trail.movement'),
          detail: `${item?.name ?? move.itemId.slice(0, 8)} · Δ ${formatQty(delta)} · ${move.type}`,
          at: move.createdAt,
        })
        if (move.documentId) {
          const doc = store.warehouse.documents.find((d) => d.id === move.documentId)
          if (doc) {
            items.push({
              label: t('journals.trail.linkedDoc'),
              detail: doc.number,
              at: doc.postedAt ?? doc.createdAt,
            })
            if (doc.purchaseOrderId) {
              const po = store.procurement.orders.find((o) => o.id === doc.purchaseOrderId)
              if (po) {
                items.push({
                  label: t('journals.trail.procurement'),
                  detail: po.orderNumber,
                  at: po.updatedAt ?? po.createdAt,
                })
              }
            }
          }
        }
        const ledger = buildItemStockLedger(move.itemId, store.warehouse.movements, {
          warehouseId: move.warehouseId,
          newestFirst: true,
        })
        const idx = ledger.findIndex((r) => r.movement.id === move.id)
        if (idx >= 0) {
          const row = ledger[idx]!
          items.push({
            label: t('journals.trail.balanceAfter'),
            detail: formatQty(row.balanceAfter),
            at: move.createdAt,
          })
          for (const neighbor of ledger.slice(idx + 1, idx + 4)) {
            items.push({
              label: t('journals.trail.priorMove'),
              detail: `Δ ${formatQty(neighbor.delta)} → ${formatQty(neighbor.balanceAfter)}`,
              at: neighbor.movement.createdAt,
            })
          }
        }
      }
    }

    return items
  }, [entry, store, t])

  if (trail.length === 0) return null

  return (
    <div className="journal-trail">
      <p className="journal-trail__title">{t('journals.trail.title')}</p>
      <ol className="journal-trail__list">
        {trail.map((step, i) => (
          <li key={`${step.label}-${i}`} className="journal-trail__step">
            <span className="journal-trail__dot" />
            <div>
              <span className="journal-trail__label">{step.label}</span>
              <span className="journal-trail__detail">{step.detail}</span>
              {step.at ? (
                <time className="journal-trail__time">{step.at.slice(0, 16).replace('T', ' ')}</time>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

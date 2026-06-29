import { useEffect, useRef } from 'react'
import { shouldAutoSyncStatus } from '@/lib/procurement/tracking/mapStatus'
import {
  syncOrderFromCarrier,
  TRACKING_SYNC_INTERVAL_MS,
} from '@/lib/procurement/tracking/syncOrder'
import type { PurchaseOrder } from '@/lib/procurement/types'

type Props = {
  orders: PurchaseOrder[]
  onApply: (order: PurchaseOrder) => void
}

export function ProcurementTrackingSync({ orders, onApply }: Props) {
  const busy = useRef(false)
  const ordersRef = useRef(orders)
  ordersRef.current = orders

  useEffect(() => {
    async function tick() {
      if (busy.current) return
      const targets = ordersRef.current.filter((o) => {
        const tr = o.containerTracking
        return (
          tr?.enabled &&
          tr.reference.trim() &&
          shouldAutoSyncStatus(o.status)
        )
      })
      if (!targets.length) return

      busy.current = true
      try {
        for (const order of targets) {
          try {
            const result = await syncOrderFromCarrier(order)
            if (result?.response.ok && result.response.events.length) {
              onApply(result.order)
            }
          } catch {
            /* skip */
          }
        }
      } finally {
        busy.current = false
      }
    }

    tick()
    const id = window.setInterval(tick, TRACKING_SYNC_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [onApply])

  return null
}

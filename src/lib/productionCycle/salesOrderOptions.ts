import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import type { SalesOrder, SalesOrderStatus } from '@/lib/sales/types'
import type { AppStore } from '@/lib/types'
import { displayCycleRef } from './deriveProductionCycle'
import { canNavigateProductionCycleView } from './roleAccess'

export type ProductionCycleSalesOrderOption = {
  id: string
  /** Human label for <option> — never a raw UUID. */
  label: string
  orderNumber?: string
  title?: string
  status?: SalesOrderStatus | string
  /** soft = sales.orders row; g5_anchor = linked from planner/loading without/alongside soft. */
  sources: Array<'soft' | 'g5_anchor'>
}

type Enrichment = {
  orderNumber?: string
  customer?: string
  productName?: string
  orderDate?: string
}

const SELECTABLE_STATUSES = new Set([
  'draft',
  'confirmed',
  'in_production',
  'shipped',
  'completed',
  'fulfilled', // G5 terminal before soft coerce
])

function isSelectableStatus(status: string | undefined): boolean {
  if (!status) return true
  if (status === 'cancelled') return false
  return SELECTABLE_STATUSES.has(status) || !['cancelled'].includes(status)
}

/** Number + title; UUID only as last-resort short fallback. */
export function formatProductionCycleOrderOptionLabel(input: {
  id: string
  orderNumber?: string | null
  customer?: string | null
  productName?: string | null
}): string {
  const number = (input.orderNumber ?? '').trim()
  const title = (input.productName ?? '').trim() || (input.customer ?? '').trim()
  if (number && title) return `${number} · ${title}`
  if (number) return number
  if (title) return title
  return displayCycleRef('', input.id)
}

function enrichFromStore(store: AppStore): Map<string, Enrichment> {
  const map = new Map<string, Enrichment>()
  const bump = (id: string, patch: Enrichment) => {
    if (!id) return
    const prev = map.get(id) ?? {}
    map.set(id, {
      orderNumber: prev.orderNumber || patch.orderNumber,
      customer: prev.customer || patch.customer,
      productName: prev.productName || patch.productName,
      orderDate: prev.orderDate || patch.orderDate,
    })
  }

  for (const po of store.production?.planner?.orders ?? []) {
    const sid = po.salesOrderId?.trim()
    if (!sid) continue
    bump(sid, {
      orderNumber: po.orderNumber,
      customer: po.customer,
      productName: po.productName,
      orderDate: po.startDate || po.createdAt?.slice(0, 10),
    })
  }

  for (const ship of store.warehouse?.loadingShipments ?? []) {
    const sid = ship.salesOrderId?.trim()
    if (!sid) continue
    bump(sid, {
      orderNumber: ship.orderNo,
      customer: ship.counterpartyName,
      orderDate: ship.date,
    })
  }

  return map
}

/**
 * Read-only ЗК options for Production Cycle selector.
 * Merges soft `sales.orders` with G5/cycle anchors (planner + loading links),
 * deduped by stable order id. Does not mutate store.
 */
export function listProductionCycleSalesOrderOptions(
  store: AppStore,
  opts: {
    access?: AccessStore | null
    user?: AppUser | null
    adminCabinet?: AdminCabinetId | null
    limit?: number
  } = {},
): ProductionCycleSalesOrderOption[] {
  const limit = opts.limit ?? 40
  const softOrders = store.sales?.orders ?? []
  const enrich = enrichFromStore(store)

  type Acc = {
    id: string
    soft?: SalesOrder
    sources: Set<'soft' | 'g5_anchor'>
    enrichment: Enrichment
  }
  const byId = new Map<string, Acc>()

  for (const o of softOrders) {
    const id = o.id?.trim()
    if (!id) continue
    if (!isSelectableStatus(o.status)) continue
    const cur = byId.get(id) ?? { id, sources: new Set(), enrichment: enrich.get(id) ?? {} }
    cur.soft = o
    cur.sources.add('soft')
    cur.enrichment = {
      orderNumber: o.orderNumber || cur.enrichment.orderNumber,
      customer: o.customer || cur.enrichment.customer,
      productName: o.lines?.[0]?.productName || cur.enrichment.productName,
      orderDate: o.orderDate || cur.enrichment.orderDate,
    }
    byId.set(id, cur)
  }

  for (const [id, patch] of enrich) {
    const soft = softOrders.find((o) => o.id === id)
    if (soft && soft.status === 'cancelled') continue
    const cur = byId.get(id) ?? { id, sources: new Set(), enrichment: {} }
    cur.sources.add('g5_anchor')
    cur.enrichment = {
      orderNumber: cur.enrichment.orderNumber || patch.orderNumber,
      customer: cur.enrichment.customer || patch.customer,
      productName: cur.enrichment.productName || patch.productName,
      orderDate: cur.enrichment.orderDate || patch.orderDate,
    }
    if (soft) cur.soft = soft
    byId.set(id, cur)
  }

  const rows: ProductionCycleSalesOrderOption[] = []
  for (const acc of byId.values()) {
    const status = acc.soft?.status
    if (status && !isSelectableStatus(status)) continue
    const orderNumber = (acc.soft?.orderNumber || acc.enrichment.orderNumber || '').trim() || undefined
    const productName =
      (acc.soft?.lines?.[0]?.productName || acc.enrichment.productName || '').trim() || undefined
    const customer = (acc.soft?.customer || acc.enrichment.customer || '').trim() || undefined
    rows.push({
      id: acc.id,
      label: formatProductionCycleOrderOptionLabel({
        id: acc.id,
        orderNumber,
        productName,
        customer,
      }),
      orderNumber,
      title: productName || customer,
      status,
      sources: [...acc.sources],
    })
  }

  rows.sort((a, b) => {
    const da = a.orderNumber || ''
    const db = b.orderNumber || ''
    const dateA =
      softOrders.find((o) => o.id === a.id)?.orderDate ||
      enrich.get(a.id)?.orderDate ||
      ''
    const dateB =
      softOrders.find((o) => o.id === b.id)?.orderDate ||
      enrich.get(b.id)?.orderDate ||
      ''
    return dateB.localeCompare(dateA) || db.localeCompare(da) || a.id.localeCompare(b.id)
  })

  // Role: listing stays available for panel viewers; navigate actions gated elsewhere.
  // If a user is present but cannot reach any cycle view, hide options (actions already hidden).
  if (opts.user && opts.access) {
    const cycleViews = [
      'director',
      'planner',
      'production',
      'warehouse',
      'procurement',
      'technologist',
      'otc',
      'mixer',
    ] as const
    const canSee = cycleViews.some((v) =>
      canNavigateProductionCycleView(opts.access, opts.user, v, opts.adminCabinet),
    )
    if (!canSee) return []
  }

  return rows.slice(0, limit)
}

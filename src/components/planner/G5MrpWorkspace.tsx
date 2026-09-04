/**
 * PHASE G5.2 — full MRP workspace (horizon, materials, FG demand, shortages, procurement, capacity).
 * Mutating actions go through g5ServerClient; success UI only after server ack.
 */
import { useState, Fragment } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { DirectorySection } from '@/lib/directories/types'
import {
  g5AcknowledgeShortage,
  g5AcceptProductionDrafts,
  g5FlagsFromStore,
  g5GenerateProcurementDrafts,
  g5ProcurementApprove,
  g5ProcurementCancel,
  g5ProcurementMarkOrdered,
  g5ProcurementPaymentRecord,
  g5ProcurementReceiptPost,
  g5ProcurementSubmit,
  g5ProductionRecommendationCreateManual,
  g5ResolveShortageManual,
  g5RunMrp,
  g5SalesFulfillmentSync,
  type G5AckPayload,
  type G5ServerResult,
} from '@/lib/planner/g5ServerClient'
import type { AppStore } from '@/lib/types'
import type { WorkTaskDraft } from '@/lib/tasks/types'
import { formatQty } from '@/lib/warehouse/stock'
import { shortContentHash } from '@/lib/planner/g5PackagingBom'
import { G6CapacityWorkspace } from '@/components/planner/G6CapacityWorkspace'

type WarehouseItemLite = {
  id: string
  code?: string
  name?: string
  unit?: string
  categoryId?: string
}

type PlanningDomain = {
  planningRuns?: MrpRun[]
  shortages?: ShortageRow[]
  productionRecommendations?: ProductionRec[]
  masterDataErrors?: MasterDataError[]
  [key: string]: unknown
}

type MrpHorizon = {
  detailedMonths?: Array<{
    month: string
    daily?: Record<string, number>
    weekly?: Record<string, number>
    totalQty?: number
  }>
  aggregateMonths?: Array<{ month: string; totalQty?: number }>
  capacityNotCalculated?: boolean
}

type MrpEvent = {
  kind?: string
  itemId?: string
  qty?: number
  dueDate?: string
  date?: string
  salesOrderId?: string
  productionOrderId?: string
  finishedProductId?: string
  [key: string]: unknown
}

type PackagingBomRefRow = {
  finishedProductId: string
  packagingBomId: string
  version?: number
  contentHash?: string
}

type MrpRun = {
  id: string
  calculatedAt?: string
  inputCriticalRevision?: number
  contentHash?: string
  stale?: boolean
  packagingBomRefs?: PackagingBomRefRow[]
  demandEvents?: MrpEvent[]
  supplyEvents?: MrpEvent[]
  shortages?: ShortageRow[]
  horizon?: MrpHorizon
  materialDateBuckets?: MrpHorizon
  errors?: MasterDataError[]
  [key: string]: unknown
}

type ShortageRow = {
  id: string
  planningRunId?: string
  itemId: string
  grossRequirement?: number
  onHand?: number
  reserved?: number
  available?: number
  inboundByEta?: number
  projectedAvailable?: number
  shortageQty?: number
  firstShortageDate?: string | null
  affectedOrderIds?: string[]
  priority?: number
  supplierId?: string
  leadTimeDays?: number
  latestSafeOrderDate?: string
  safetyStock?: number
  status?: string
  confirmedAt?: string
  note?: string
  [key: string]: unknown
}

type ProductionRec = {
  id: string
  finishedProductId?: string
  requiredQty?: number
  remainingDemand?: number
  dueDate?: string
  priority?: number
  salesOrderId?: string
  salesLineId?: string
  status?: string
  packagingBomId?: string
  packagingBomVersion?: number
  packagingBomContentHash?: string
  packagingRequirements?: Array<{
    itemId?: string
    normQty?: number
    unit?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}

type MasterDataError = {
  id?: string
  kind?: string
  message?: string
  entityId?: string
  [key: string]: unknown
}

type ProcurementOrderLite = {
  id: string
  status?: string
  supplierId?: string
  supplierNameSnapshot?: string
  sourcePlanningRunId?: string
  lines?: Array<{
    lineId?: string
    itemId?: string
    requestedQty?: number
    receivedQty?: number
    requiredDate?: string
    sourceShortageIds?: string[]
    moqApplied?: boolean
    [key: string]: unknown
  }>
  eta?: string
  confirmedDeliveryDate?: string
  paymentTotal?: number
  currency?: string
  [key: string]: unknown
}

type WorkspaceSection =
  | 'horizon'
  | 'materials'
  | 'fgDemand'
  | 'shortages'
  | 'procurement'
  | 'capacity'

export type G5MrpWorkspaceProps = {
  asOfDate?: string
  salesOrders?: unknown[]
  warehouseItems?: WarehouseItemLite[]
  finishedProducts?: unknown[]
  counterparties?: unknown[]
  procurementOrders?: unknown[]
  store?: AppStore | null
  initialPlanning?: PlanningDomain | null
  planning?: PlanningDomain | null
  criticalRevision?: number
  onOpenSalesOrder?: (id: string) => void
  onOpenProductionOrder?: (id: string) => void
  onNavigateToDirectory?: (section: DirectorySection) => void
  onCreateWorkTask?: (draft: WorkTaskDraft) => string
  access?: AccessStore | unknown
  currentUser?: AppUser | null | unknown
  canViewPayment?: boolean
  /** PHASE G6 — allow capacity.domain.activate from Capacity tab. */
  canActivateG6?: boolean
  onG6StoreMirrored?: (next: AppStore) => void
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function idemKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function readPlanningOverlay(
  store: AppStore | null | undefined,
  initialPlanning: PlanningDomain | null | undefined,
  planningProp: PlanningDomain | null | undefined,
  lastAck: G5AckPayload | null,
): PlanningDomain {
  if (lastAck?.planning && typeof lastAck.planning === 'object') {
    return lastAck.planning as PlanningDomain
  }
  if (planningProp) return planningProp
  if (initialPlanning) return initialPlanning
  if (!store) return {}
  const production = asRecord(store.production)
  const fromProduction = asRecord(production?.planning) as PlanningDomain | null
  const fromStore = asRecord((store as unknown as { planning?: unknown }).planning) as PlanningDomain | null
  return fromProduction ?? fromStore ?? {}
}

function latestRun(planning: PlanningDomain): MrpRun | null {
  const runs = Array.isArray(planning.planningRuns) ? planning.planningRuns : []
  if (!runs.length) return null
  return [...runs].sort((a, b) => str(b.calculatedAt).localeCompare(str(a.calculatedAt)))[0] ?? null
}

function nameById(list: unknown[] | undefined, id: string): string {
  if (!id || !Array.isArray(list)) return id || '—'
  for (const raw of list) {
    const row = asRecord(raw)
    if (row && str(row.id) === id) {
      return str(row.name || row.code || id)
    }
  }
  return id
}

function itemMeta(
  items: WarehouseItemLite[] | undefined,
  itemId: string,
): WarehouseItemLite {
  const found = items?.find((i) => i.id === itemId)
  return found ?? { id: itemId, code: itemId, name: itemId, unit: '' }
}

function mapServerError(
  result: G5ServerResult<unknown>,
  t: (k: string) => string,
): { kind: 'forbidden' | 'conflict' | 'auth' | 'other'; message: string } {
  const err = str(result.ok === false ? result.error : '')
  const msg = result.ok === false ? result.message : ''
  if (err === '401' || err === 'unauthorized' || /unauth/i.test(err)) {
    return { kind: 'auth', message: t('g5.mrp.error.unauthorized') }
  }
  if (err === '403' || err === 'forbidden' || /forbidden|capability|denied/i.test(err)) {
    return { kind: 'forbidden', message: t('g5.mrp.error.forbidden') }
  }
  if (
    err === '409' ||
    /conflict|stale|revision/i.test(err) ||
    /conflict|stale|revision/i.test(msg)
  ) {
    return { kind: 'conflict', message: t('g5.mrp.error.conflict') }
  }
  return { kind: 'other', message: msg || err || t('g5.mrp.error.generic') }
}

function monthLabelsFromAsOf(asOfDate?: string): string[] {
  const anchor = (asOfDate || new Date().toISOString()).slice(0, 10)
  const base = new Date(`${anchor}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) {
    const now = new Date()
    base.setTime(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  }
  const out: string[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

function formatPackagingRequirementsSummary(
  reqs: ProductionRec['packagingRequirements'],
  items: WarehouseItemLite[] | undefined,
): string {
  if (!Array.isArray(reqs) || reqs.length === 0) return '—'
  return reqs
    .map((r) => {
      const itemId = str(r.itemId)
      const meta = itemMeta(items, itemId)
      const label = str(meta.code || meta.name || itemId)
      return `${label}: ${formatQty(num(r.normQty))} ${str(r.unit) || ''}`.trim()
    })
    .join(' · ')
}

export function G5MrpWorkspace({
  asOfDate,
  salesOrders = [],
  warehouseItems = [],
  finishedProducts = [],
  counterparties = [],
  procurementOrders,
  store,
  initialPlanning,
  planning: planningProp,
  criticalRevision: criticalRevisionProp,
  onOpenSalesOrder,
  onOpenProductionOrder,
  onNavigateToDirectory,
  canViewPayment = false,
  canActivateG6 = false,
  onG6StoreMirrored,
}: G5MrpWorkspaceProps) {
  const { t, tf } = useI18n()
  const [section, setSection] = useState<WorkspaceSection>('horizon')
  const [lastAck, setLastAck] = useState<G5AckPayload | null>(null)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)
  const [resolveReason, setResolveReason] = useState('')
  const [resolveTargetId, setResolveTargetId] = useState<string | null>(null)
  const [selectedShortageIds, setSelectedShortageIds] = useState<string[]>([])

  const [filterPeriod, setFilterPeriod] = useState('')
  const [filterItem, setFilterItem] = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [filterOrder, setFilterOrder] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterNeedsSupplier, setFilterNeedsSupplier] = useState(false)
  const [filterBomError, setFilterBomError] = useState(false)

  const flags = g5FlagsFromStore(store ?? null)
  const planning = readPlanningOverlay(store, initialPlanning, planningProp, lastAck)
  const run = latestRun(planning)
  const horizon = run?.horizon ?? run?.materialDateBuckets
  const criticalRevision =
    criticalRevisionProp ??
    lastAck?.criticalRevision ??
    num(asRecord(store?.production)?.g5CriticalRevision, NaN)

  const stale =
    run?.stale === true ||
    (Number.isFinite(criticalRevision) &&
      run?.inputCriticalRevision != null &&
      Number(run.inputCriticalRevision) !== Number(criticalRevision))

  const months = monthLabelsFromAsOf(asOfDate)

  const packagingBomRefs = Array.isArray(run?.packagingBomRefs) ? run!.packagingBomRefs! : []

  const productionRecs = (() => {
    const list = Array.isArray(planning.productionRecommendations)
      ? (planning.productionRecommendations as ProductionRec[])
      : []
    return [...list].sort((a, b) => {
      const d = str(a.dueDate).localeCompare(str(b.dueDate))
      if (d) return d
      return num(b.priority) - num(a.priority)
    })
  })()

  const shortages = (() => {
    const fromPlanning = Array.isArray(planning.shortages) ? planning.shortages : []
    const fromRun = Array.isArray(run?.shortages) ? run!.shortages! : []
    const byId = new Map<string, ShortageRow>()
    for (const s of [...fromPlanning, ...fromRun]) {
      if (s?.id) byId.set(s.id, s)
    }
    return [...byId.values()]
  })()

  const materialRows = (() => {
    const demand = Array.isArray(run?.demandEvents) ? run!.demandEvents! : []
    const supply = Array.isArray(run?.supplyEvents) ? run!.supplyEvents! : []
    const byItem = new Map<string, ShortageRow>()
    for (const s of shortages) {
      if (s.itemId) byItem.set(s.itemId, s)
    }
    const itemIds = new Set<string>([
      ...byItem.keys(),
      ...demand.map((e) => str(e.itemId)).filter(Boolean),
      ...supply.map((e) => str(e.itemId)).filter(Boolean),
    ])
    return [...itemIds].map((itemId) => {
      const sh = byItem.get(itemId)
      const meta = itemMeta(warehouseItems, itemId)
      const issuedOwn = supply
        .filter((e) => e.kind === 'issued_to_line' && str(e.itemId) === itemId)
        .reduce((sum, e) => sum + num(e.qty), 0)
      const supplierName = nameById(counterparties, str(sh?.supplierId))
      const status =
        num(sh?.shortageQty) > 0
          ? 'shortage'
          : num(sh?.available) > 0
            ? 'ok'
            : 'neutral'
      return {
        itemId,
        code: meta.code || itemId,
        name: meta.name || itemId,
        unit: meta.unit || '',
        onHand: num(sh?.onHand),
        reserved: num(sh?.reserved),
        issuedOwn,
        // Issued-to-line is NOT free available
        available: num(sh?.available),
        inbound: num(sh?.inboundByEta),
        projected: num(sh?.projectedAvailable),
        safetyStock: num(sh?.safetyStock),
        shortageQty: num(sh?.shortageQty),
        firstShortageDate: str(sh?.firstShortageDate) || '',
        latestSafeOrderDate: str(sh?.latestSafeOrderDate) || '',
        supplier: supplierName,
        supplierId: str(sh?.supplierId),
        leadTime: num(sh?.leadTimeDays),
        affectedOrders: sh?.affectedOrderIds ?? [],
        priority: num(sh?.priority),
        status,
        shortageId: sh?.id,
      }
    })
  })()

  const timelineFor = (itemId: string) => {
    const demand = (run?.demandEvents ?? []).filter((e) => str(e.itemId) === itemId)
    const supply = (run?.supplyEvents ?? []).filter((e) => str(e.itemId) === itemId)
    const rows: Array<{
      date: string
      type: string
      source: string
      demand: number
      inbound: number
      projected: number
    }> = []
    for (const e of demand) {
      rows.push({
        date: str(e.dueDate || e.date) || '—',
        type: str(e.kind) || 'demand',
        source: str(e.salesOrderId || e.productionOrderId || ''),
        demand: num(e.qty),
        inbound: 0,
        projected: 0,
      })
    }
    for (const e of supply) {
      if (e.kind === 'issued_to_line') continue // not free inbound/available
      rows.push({
        date: str(e.dueDate || e.date) || '—',
        type: str(e.kind) || 'supply',
        source: str(e.salesOrderId || e.productionOrderId || e.kind || ''),
        demand: 0,
        inbound: num(e.qty),
        projected: 0,
      })
    }
    return rows.sort((a, b) => a.date.localeCompare(b.date))
  }

  const fgDemandRows = (() => {
    const fromEvents = (run?.demandEvents ?? []).filter((e) => e.kind === 'sales_fg')
    if (fromEvents.length) {
      return fromEvents.map((e) => {
        const soId = str(e.salesOrderId)
        const so = salesOrders.find((o) => str(asRecord(o)?.id) === soId)
        const soRec = asRecord(so)
        const lines = Array.isArray(soRec?.lines) ? soRec!.lines : []
        const line = lines.find(
          (ln: unknown) =>
            str(asRecord(ln)?.lineId || asRecord(ln)?.id) === str(e.salesLineId),
        )
        const ln = asRecord(line) ?? {}
        const productId = str(e.finishedProductId || ln.finishedProductId)
        const linked = Array.isArray(ln.linkedProductionOrderIds)
          ? (ln.linkedProductionOrderIds as string[])
          : Array.isArray(ln.productionOrderIds)
            ? (ln.productionOrderIds as string[])
            : []
        return {
          salesOrderId: soId,
          salesLineId: str(e.salesLineId),
          customer: str(
            soRec?.customerNameSnapshot || soRec?.customerName || soRec?.customer || '',
          ),
          product: nameById(finishedProducts, productId) || str(ln.productNameSnapshot || ln.productName),
          ordered: num(ln.quantity ?? ln.qtyMp ?? e.qty),
          released: num(ln.releasedQty),
          planned: num(e.linkedProductionRemaining ?? ln.productionAllocatedQty),
          produced: num(ln.producedQty),
          shipped: num(ln.shippedQty),
          remaining: num(e.qty ?? ln.remainingQty),
          due: str(e.dueDate || ln.requestedShipDate || ''),
          priority: num(e.priority ?? soRec?.priority ?? ln.priority),
          linkedPOs: linked.map(String),
        }
      })
    }
    // Fallback: UI sales orders when no MRP run yet
    return salesOrders.flatMap((raw) => {
      const so = asRecord(raw)
      if (!so) return []
      const lines = Array.isArray(so.lines) ? so.lines : []
      return lines.map((lineRaw: unknown) => {
        const ln = asRecord(lineRaw) ?? {}
        const progress = asRecord(ln.progress)
        const linked = Array.isArray(ln.productionOrderIds)
          ? (ln.productionOrderIds as string[])
          : []
        return {
          salesOrderId: str(so.id),
          salesLineId: str(ln.id || ln.lineId),
          customer: str(so.customerName || so.customer || ''),
          product: str(ln.productName || nameById(finishedProducts, str(ln.finishedProductId))),
          ordered: num(ln.qtyMp ?? ln.quantity),
          released: num(progress?.readyToShipQty ?? ln.releasedQty),
          planned: num(progress?.productionAllocatedQty),
          produced: num(progress?.producedGoodQty ?? ln.producedQty),
          shipped: num(progress?.shippedQty ?? ln.shippedQty),
          remaining: num(
            progress?.remainingToShipQty ??
              Math.max(0, num(ln.qtyMp ?? ln.quantity) - num(ln.shippedQty)),
          ),
          due: str(so.requestedShipDate || ln.requestedShipDate || so.dueDate || ''),
          priority: num(so.priority ?? ln.priority),
          linkedPOs: linked.map(String),
        }
      })
    })
  })()

  const openRecsMissingBom = productionRecs.filter(
    (r) => str(r.status) === 'open' && !str(r.packagingBomId),
  )
  const bomRefsMissing =
    Boolean(run?.id) && packagingBomRefs.length === 0 && fgDemandRows.length > 0
  const bomWarnStale = stale && Boolean(run?.id)
  const bomWarnMissingRefs = bomRefsMissing || openRecsMissingBom.length > 0

  const filteredShortages = (() => {
    let rows = [...shortages]
    rows.sort((a, b) => {
      const d = str(a.firstShortageDate).localeCompare(str(b.firstShortageDate))
      if (d) return d
      const p = num(b.priority) - num(a.priority)
      if (p) return p
      const lt = num(a.leadTimeDays) - num(b.leadTimeDays)
      if (lt) return lt
      return str(a.confirmedAt).localeCompare(str(b.confirmedAt))
    })
    if (filterPeriod) {
      rows = rows.filter((s) => str(s.firstShortageDate).startsWith(filterPeriod))
    }
    if (filterItem) {
      const q = filterItem.toLowerCase()
      rows = rows.filter((s) => {
        const meta = itemMeta(warehouseItems, s.itemId)
        return (
          s.itemId.toLowerCase().includes(q) ||
          str(meta.code).toLowerCase().includes(q) ||
          str(meta.name).toLowerCase().includes(q)
        )
      })
    }
    if (filterSupplier) {
      rows = rows.filter((s) => str(s.supplierId) === filterSupplier)
    }
    if (filterOrder) {
      rows = rows.filter((s) =>
        (s.affectedOrderIds ?? []).some((id) => str(id).includes(filterOrder)),
      )
    }
    if (filterPriority !== '') {
      const p = Number(filterPriority)
      rows = rows.filter((s) => num(s.priority) === p)
    }
    if (filterStatus) {
      rows = rows.filter((s) => str(s.status) === filterStatus)
    }
    if (filterNeedsSupplier) {
      rows = rows.filter((s) => !str(s.supplierId))
    }
    if (filterBomError) {
      const errIds = new Set(
        (planning.masterDataErrors ?? [])
          .filter((e) => /bom|item|product|supplier/i.test(str(e.kind)))
          .map((e) => str(e.entityId))
          .filter(Boolean),
      )
      rows = errIds.size
        ? rows.filter((s) => errIds.has(s.itemId))
        : rows.filter(() => false)
    }
    return rows
  })()

  const poList = (() => {
    const fromAck = Array.isArray(lastAck?.procurement?.orders)
      ? (lastAck!.procurement!.orders as ProcurementOrderLite[])
      : []
    const fromProp = Array.isArray(procurementOrders)
      ? (procurementOrders as ProcurementOrderLite[])
      : []
    const fromStore = Array.isArray(store?.procurement?.orders)
      ? (store!.procurement.orders as unknown as ProcurementOrderLite[])
      : []
    const byId = new Map<string, ProcurementOrderLite>()
    for (const o of [...fromStore, ...fromProp, ...fromAck]) {
      if (o?.id) byId.set(o.id, o)
    }
    return [...byId.values()]
  })()

  async function runCommand<T extends G5AckPayload>(
    fn: () => Promise<G5ServerResult<T>>,
    successKey: string,
  ): Promise<T | null> {
    setInFlight(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await fn()
      if (!result.ok) {
        const mapped = mapServerError(result, t)
        setError(
          mapped.kind === 'conflict'
            ? `${mapped.message} ${t('g5.mrp.error.reloadHint')}`
            : mapped.message,
        )
        return null
      }
      setLastAck(result.data)
      setSuccess(t(successKey))
      return result.data
    } finally {
      setInFlight(false)
    }
  }

  async function handleRecalculate() {
    await runCommand(
      () => g5RunMrp({ idempotencyKey: idemKey('mrp-run'), asOfDate }),
      'g5.mrp.success.recalculated',
    )
  }

  async function handleAcknowledge(shortageId: string) {
    await runCommand(
      () =>
        g5AcknowledgeShortage({
          shortageId,
          idempotencyKey: idemKey(`ack-${shortageId}`),
        }),
      'g5.mrp.success.acknowledged',
    )
  }

  async function handleResolveManual(shortageId: string) {
    const reason = resolveReason.trim()
    if (!reason) {
      setError(t('g5.mrp.error.reasonRequired'))
      return
    }
    const ok = await runCommand(
      () =>
        g5ResolveShortageManual({
          shortageId,
          reason,
          note: reason,
          idempotencyKey: idemKey(`resolve-${shortageId}`),
        }),
      'g5.mrp.success.resolved',
    )
    if (ok) {
      setResolveTargetId(null)
      setResolveReason('')
    }
  }

  async function handleAcceptProductionDrafts() {
    await runCommand(
      () =>
        g5AcceptProductionDrafts({
          idempotencyKey: idemKey('accept-prod'),
        }),
      'g5.mrp.success.productionDrafts',
    )
  }

  async function handleGenerateProcurementDrafts() {
    const runId = run?.id
    if (!runId) {
      setError(t('g5.mrp.error.noRun'))
      return
    }
    await runCommand(
      () =>
        g5GenerateProcurementDrafts({
          planningRunId: runId,
          idempotencyKey: idemKey(`po-drafts-${runId}`),
        }),
      'g5.mrp.success.procurementDrafts',
    )
  }

  async function handleCreateManualProductionRecommendation() {
    const first = fgDemandRows[0]
    if (!first?.salesOrderId) {
      setError(t('g5.mrp.error.noFgDemand'))
      return
    }
    await runCommand(
      () =>
        g5ProductionRecommendationCreateManual({
          idempotencyKey: idemKey('prod-rec-manual'),
          command: {
            salesOrderId: first.salesOrderId,
            salesLineId: first.salesLineId,
            finishedProductId: first.product,
            quantity: first.remaining || first.ordered,
          },
        }),
      'g5.mrp.success.productionManual',
    )
  }

  async function handlePoLifecycle(
    poId: string,
    action: 'submit' | 'approve' | 'ordered' | 'cancel',
  ) {
    const map = {
      submit: g5ProcurementSubmit,
      approve: g5ProcurementApprove,
      ordered: g5ProcurementMarkOrdered,
      cancel: g5ProcurementCancel,
    } as const
    await runCommand(
      () =>
        map[action]({
          idempotencyKey: idemKey(`po-${action}-${poId}`),
          command: { id: poId },
        }),
      `g5.mrp.success.po.${action}`,
    )
  }

  async function handlePoPartialReceipt(po: ProcurementOrderLite) {
    const line = (po.lines ?? [])[0]
    if (!line?.lineId) {
      setError(t('g5.mrp.error.noPoLine'))
      return
    }
    const requested = num(line.requestedQty)
    const received = num(line.receivedQty)
    const openQty = Math.max(0, requested - received)
    const qty = openQty > 0 ? Math.max(0.001, openQty / 2) : Math.max(0.001, requested / 2 || 0.5)
    await runCommand(
      () =>
        g5ProcurementReceiptPost({
          idempotencyKey: idemKey(`po-receipt-${po.id}`),
          command: {
            id: po.id,
            orderId: po.id,
            lines: [{ lineId: line.lineId, quantity: qty }],
          },
        }),
      'g5.mrp.success.po.receipt',
    )
  }

  async function handlePoPayment(poId: string) {
    if (!canViewPayment) {
      setError(t('g5.mrp.error.paymentAcl'))
      return
    }
    await runCommand(
      () =>
        g5ProcurementPaymentRecord({
          idempotencyKey: idemKey(`po-pay-${poId}`),
          command: { orderId: poId, amount: 0, note: 'ui-ack' },
        }),
      'g5.mrp.success.po.payment',
    )
  }

  function toggleShortage(id: string) {
    setSelectedShortageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const sectionTabs: Array<{ id: WorkspaceSection; label: string }> = [
    { id: 'horizon', label: t('g5.mrp.section.horizon') },
    { id: 'materials', label: t('g5.mrp.section.materials') },
    { id: 'fgDemand', label: t('g5.mrp.section.fgDemand') },
    { id: 'shortages', label: t('g5.mrp.section.shortages') },
    { id: 'procurement', label: t('g5.mrp.section.procurement') },
    { id: 'capacity', label: t('g5.mrp.section.capacity') },
  ]

  return (
    <div className="space-y-4" data-coach="planner:mrp">
      {!flags.salesPlanningActive && store != null && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {t('g5.mrp.salesPlanningInactive')}
        </div>
      )}

      <div className="flex flex-wrap gap-2 rounded-sm border border-grid bg-stone-50 px-3 py-2">
        <Button
          size="xs"
          variant="ghost"
          disabled={inFlight || !flags.salesPlanningActive}
          onClick={() => void handleCreateManualProductionRecommendation()}
        >
          {t('g5.mrp.action.createProductionManual')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={inFlight || !flags.salesPlanningActive}
          onClick={() =>
            void runCommand(
              () =>
                g5SalesFulfillmentSync({
                  idempotencyKey: idemKey('fulfillment-sync'),
                }),
              'g5.mrp.success.fulfillmentSync',
            )
          }
        >
          {t('g5.mrp.action.fulfillmentSync')}
        </Button>
      </div>

      {error && (
        <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
      )}
      {success && (
        <FormNotice type="success" message={success} onDismiss={() => setSuccess(null)} />
      )}

      <TabBar
        coachPrefix="planner-mrp"
        tabs={sectionTabs}
        value={section}
        onChange={(id) => setSection(id as WorkspaceSection)}
      />

      {section === 'horizon' && (
        <section className="space-y-3 rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
                {t('g5.mrp.horizonTitle')}
              </h3>
              <p className="mt-1 text-xs text-stone-500">{t('g5.mrp.horizonDetail')}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-600">
                <span>
                  {t('g5.mrp.lastRun')}:{' '}
                  <span className="font-mono">{run?.id ?? '—'}</span>
                </span>
                <span>
                  {t('g5.mrp.revision')}:{' '}
                  <span className="font-mono">
                    {run?.inputCriticalRevision ?? '—'}
                    {Number.isFinite(criticalRevision) ? ` / ${criticalRevision}` : ''}
                  </span>
                </span>
                <span>
                  {t('g5.mrp.calculatedAt')}: {run?.calculatedAt ?? '—'}
                </span>
                {stale ? (
                  <span className="rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                    {t('g5.mrp.stale')}
                  </span>
                ) : null}
              </div>
              {(bomWarnStale || bomWarnMissingRefs) && (
                <div className="mt-2 space-y-1">
                  {bomWarnStale ? (
                    <p className="text-xs font-medium text-amber-900">{t('g5.mrp.bom.warnStale')}</p>
                  ) : null}
                  {bomRefsMissing ? (
                    <p className="text-xs font-medium text-amber-900">
                      {t('g5.mrp.bom.warnMissingRefs')}
                    </p>
                  ) : null}
                  {openRecsMissingBom.length > 0 ? (
                    <p className="text-xs font-medium text-amber-900">
                      {tf('g5.mrp.bom.warnRecsMissingBom', { count: openRecsMissingBom.length })}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={inFlight}
              onClick={() => void handleRecalculate()}
              data-coach="planner:mrp:recalculate"
            >
              {inFlight ? t('g5.mrp.recalculating') : t('g5.mrp.recalculate')}
            </Button>
          </div>

          <div className="overflow-auto rounded-sm border border-grid">
            <h4 className="border-b border-grid bg-stone-50 px-3 py-2 text-xs font-semibold uppercase text-stone-500">
              {t('g5.mrp.bom.refsTitle')}
            </h4>
            <table className="fc-table min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-stone-500">
                  <th className="px-3 py-2">{t('g5.mrp.bom.col.product')}</th>
                  <th className="px-3 py-2">{t('g5.mrp.bom.col.bomId')}</th>
                  <th className="px-3 py-2 text-right">{t('g5.mrp.bom.col.version')}</th>
                  <th className="px-3 py-2">{t('g5.mrp.bom.col.hash')}</th>
                </tr>
              </thead>
              <tbody>
                {packagingBomRefs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-sm text-stone-400">
                      {t('g5.mrp.bom.emptyRefs')}
                    </td>
                  </tr>
                ) : (
                  packagingBomRefs.map((ref) => (
                    <tr key={`${ref.finishedProductId}-${ref.packagingBomId}`} className="border-t border-grid">
                      <td className="px-3 py-2 text-xs">
                        {nameById(finishedProducts, str(ref.finishedProductId))}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{str(ref.packagingBomId) || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {ref.version ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs" title={str(ref.contentHash)}>
                        {shortContentHash(str(ref.contentHash))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="overflow-auto rounded-sm border border-grid">
              <h4 className="border-b border-grid bg-stone-50 px-3 py-2 text-xs font-semibold uppercase text-stone-500">
                {t('g5.mrp.detailedMonths')}
              </h4>
              <table className="fc-table min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">{t('g5.mrp.col.month')}</th>
                    <th className="px-3 py-2 text-right">{t('g5.mrp.col.totalQty')}</th>
                    <th className="px-3 py-2 text-left">{t('g5.mrp.col.weeks')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(horizon?.detailedMonths ?? months.slice(0, 3).map((m) => ({ month: m, totalQty: 0, weekly: {} }))).map(
                    (row) => (
                      <tr key={row.month} className="border-t border-grid">
                        <td className="px-3 py-2 font-mono text-xs">{row.month}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">
                          {formatQty(num(row.totalQty))}
                        </td>
                        <td className="px-3 py-2 text-xs text-stone-600">
                          {row.weekly && Object.keys(row.weekly).length
                            ? Object.entries(row.weekly)
                                .map(([wk, qty]) => `${wk}: ${formatQty(num(qty))}`)
                                .join(' · ')
                            : '—'}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="overflow-auto rounded-sm border border-grid">
              <h4 className="border-b border-grid bg-stone-50 px-3 py-2 text-xs font-semibold uppercase text-stone-500">
                {t('g5.mrp.aggregateMonths')}
              </h4>
              <table className="fc-table min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">{t('g5.mrp.col.month')}</th>
                    <th className="px-3 py-2 text-right">{t('g5.mrp.col.totalQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    horizon?.aggregateMonths ??
                    months.slice(3, 12).map((m) => ({ month: m, totalQty: 0 }))
                  ).map((row) => (
                    <tr key={row.month} className="border-t border-grid">
                      <td className="px-3 py-2 font-mono text-xs">{row.month}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        {formatQty(num(row.totalQty))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {section === 'materials' && (
        <section className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <h3 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {t('g5.mrp.section.materials')}
          </h3>
          <table className="fc-table min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                {[
                  'code',
                  'name',
                  'unit',
                  'onHand',
                  'reserved',
                  'issuedOwn',
                  'available',
                  'inbound',
                  'projected',
                  'safetyStock',
                  'shortageQty',
                  'firstShortageDate',
                  'latestSafeOrderDate',
                  'supplier',
                  'leadTime',
                  'affectedOrders',
                  'priority',
                  'status',
                ].map((col) => (
                  <th key={col} className="whitespace-nowrap px-2 py-2">
                    {t(`g5.mrp.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {materialRows.length === 0 ? (
                <tr>
                  <td colSpan={18} className="px-3 py-4 text-center text-sm text-stone-400">
                    {t('g5.mrp.empty.materials')}
                  </td>
                </tr>
              ) : (
                materialRows.map((row) => (
                  <Fragment key={row.itemId}>
                    <tr
                      className={`border-t border-grid cursor-pointer ${
                        row.shortageQty > 0 ? 'bg-red-50/40' : ''
                      }`}
                      onClick={() =>
                        setExpandedItemId((id) => (id === row.itemId ? null : row.itemId))
                      }
                    >
                      <td className="px-2 py-1.5 font-mono text-xs">{row.code}</td>
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className="px-2 py-1.5 text-xs">{row.unit || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(row.onHand)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-amber-800">
                        {formatQty(row.reserved)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-stone-500">
                        {formatQty(row.issuedOwn)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(row.available)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(row.inbound)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(row.projected)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(row.safetyStock)}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-mono text-xs font-semibold ${
                          row.shortageQty > 0 ? 'text-red-700' : 'text-stone-400'
                        }`}
                      >
                        {row.shortageQty > 0 ? formatQty(row.shortageQty) : '—'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {row.firstShortageDate || '—'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {row.latestSafeOrderDate || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs">{row.supplier || '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {row.leadTime || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {row.affectedOrders.length
                          ? row.affectedOrders.map((oid) => (
                              <button
                                key={oid}
                                type="button"
                                className="mr-1 text-sky-700 underline"
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  if (oid.startsWith('so') || oid.includes('sales')) {
                                    onOpenSalesOrder?.(oid)
                                  } else {
                                    onOpenProductionOrder?.(oid)
                                  }
                                }}
                              >
                                {oid}
                              </button>
                            ))
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {row.priority}
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`rounded-sm px-2 py-0.5 text-[10px] font-semibold ${
                            row.status === 'shortage'
                              ? 'bg-red-100 text-red-800'
                              : row.status === 'ok'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-stone-100 text-stone-500'
                          }`}
                        >
                          {t(`g5.mrp.materialStatus.${row.status}`)}
                        </span>
                      </td>
                    </tr>
                    {expandedItemId === row.itemId ? (
                      <tr className="border-t border-grid bg-stone-50/80">
                        <td colSpan={18} className="px-3 py-3">
                          <div className="text-xs font-semibold uppercase text-stone-500">
                            {t('g5.mrp.eventTimeline')}
                          </div>
                          <table className="mt-2 min-w-full text-xs">
                            <thead>
                              <tr className="text-left text-stone-500">
                                <th className="py-1 pr-3">{t('g5.mrp.col.date')}</th>
                                <th className="py-1 pr-3">{t('g5.mrp.col.type')}</th>
                                <th className="py-1 pr-3">{t('g5.mrp.col.source')}</th>
                                <th className="py-1 pr-3 text-right">{t('g5.mrp.col.demand')}</th>
                                <th className="py-1 pr-3 text-right">{t('g5.mrp.col.inbound')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {timelineFor(row.itemId).map((ev, idx) => (
                                <tr key={`${row.itemId}-ev-${idx}`}>
                                  <td className="py-0.5 pr-3 font-mono">{ev.date}</td>
                                  <td className="py-0.5 pr-3">{ev.type}</td>
                                  <td className="py-0.5 pr-3">{ev.source || '—'}</td>
                                  <td className="py-0.5 pr-3 text-right font-mono">
                                    {ev.demand ? formatQty(ev.demand) : '—'}
                                  </td>
                                  <td className="py-0.5 pr-3 text-right font-mono">
                                    {ev.inbound ? formatQty(ev.inbound) : '—'}
                                  </td>
                                </tr>
                              ))}
                              {timelineFor(row.itemId).length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="py-2 text-stone-400">
                                    {t('g5.mrp.empty.timeline')}
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {section === 'fgDemand' && (
        <section className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <h3 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {t('g5.mrp.section.fgDemand')}
          </h3>
          <table className="fc-table min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                {[
                  'salesOrder',
                  'customer',
                  'product',
                  'ordered',
                  'released',
                  'planned',
                  'produced',
                  'shipped',
                  'remaining',
                  'due',
                  'priority',
                  'linkedPOs',
                ].map((col) => (
                  <th key={col} className="whitespace-nowrap px-2 py-2">
                    {t(`g5.mrp.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fgDemandRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-4 text-center text-sm text-stone-400">
                    {t('g5.mrp.empty.fgDemand')}
                  </td>
                </tr>
              ) : (
                fgDemandRows.map((row) => (
                  <tr
                    key={`${row.salesOrderId}-${row.salesLineId}`}
                    className="border-t border-grid"
                  >
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        className="font-mono text-xs text-sky-700 underline"
                        onClick={() => onOpenSalesOrder?.(row.salesOrderId)}
                      >
                        {row.salesOrderId || '—'}
                      </button>
                      {row.salesLineId ? (
                        <span className="ml-1 text-[10px] text-stone-400">
                          / {row.salesLineId}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-xs">{row.customer || '—'}</td>
                    <td className="px-2 py-1.5 text-xs">{row.product || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {formatQty(row.ordered)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {formatQty(row.released)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {formatQty(row.planned)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {formatQty(row.produced)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {formatQty(row.shipped)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold">
                      {formatQty(row.remaining)}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-xs">{row.due || '—'}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-xs">
                      {row.priority}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {row.linkedPOs.length
                        ? row.linkedPOs.map((pid) => (
                            <button
                              key={pid}
                              type="button"
                              className="mr-1 text-sky-700 underline"
                              onClick={() => onOpenProductionOrder?.(pid)}
                            >
                              {pid}
                            </button>
                          ))
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}

      {section === 'shortages' && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-2 rounded-sm border border-grid bg-white p-3 shadow-sm">
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.period')}
              <input
                className="fc-input mt-0.5 block min-w-[7rem]"
                value={filterPeriod}
                onChange={(e) => setFilterPeriod(e.target.value)}
                placeholder="YYYY-MM"
              />
            </label>
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.item')}
              <input
                className="fc-input mt-0.5 block min-w-[8rem]"
                value={filterItem}
                onChange={(e) => setFilterItem(e.target.value)}
              />
            </label>
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.supplier')}
              <select
                className="fc-input mt-0.5 block min-w-[10rem]"
                value={filterSupplier}
                onChange={(e) => setFilterSupplier(e.target.value)}
              >
                <option value="">{t('g5.mrp.filter.all')}</option>
                {counterparties.map((c) => {
                  const row = asRecord(c)
                  if (!row) return null
                  return (
                    <option key={str(row.id)} value={str(row.id)}>
                      {str(row.name || row.code || row.id)}
                    </option>
                  )
                })}
              </select>
            </label>
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.order')}
              <input
                className="fc-input mt-0.5 block min-w-[8rem]"
                value={filterOrder}
                onChange={(e) => setFilterOrder(e.target.value)}
              />
            </label>
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.priority')}
              <input
                className="fc-input mt-0.5 block w-16"
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
              />
            </label>
            <label className="text-xs text-stone-500">
              {t('g5.mrp.filter.status')}
              <select
                className="fc-input mt-0.5 block min-w-[8rem]"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">{t('g5.mrp.filter.all')}</option>
                {['open', 'acknowledged', 'resolved', 'superseded'].map((s) => (
                  <option key={s} value={s}>
                    {t(`g5.mrp.shortageStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={filterNeedsSupplier}
                onChange={(e) => setFilterNeedsSupplier(e.target.checked)}
              />
              {t('g5.mrp.filter.needsSupplier')}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={filterBomError}
                onChange={(e) => setFilterBomError(e.target.checked)}
              />
              {t('g5.mrp.filter.bomError')}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={inFlight || !run?.id}
              onClick={() => void handleGenerateProcurementDrafts()}
            >
              {t('g5.mrp.action.generateProcurementDrafts')}
            </Button>
            <Button
              size="sm"
              disabled={inFlight}
              onClick={() => void handleAcceptProductionDrafts()}
            >
              {t('g5.mrp.action.acceptProductionDrafts')}
            </Button>
            {onNavigateToDirectory ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={inFlight}
                onClick={() => onNavigateToDirectory('counterparties')}
              >
                {t('g5.mrp.action.assignSupplier')}
              </Button>
            ) : null}
          </div>

          {productionRecs.length > 0 ? (
            <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
              <h4 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
                {t('g5.mrp.bom.recsTitle')}
              </h4>
              <table className="fc-table min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-2 py-2">{t('g5.mrp.col.product')}</th>
                    <th className="px-2 py-2 text-right">{t('g5.mrp.col.remaining')}</th>
                    <th className="px-2 py-2">{t('g5.mrp.bom.col.bomId')}</th>
                    <th className="px-2 py-2 text-right">{t('g5.mrp.bom.col.version')}</th>
                    <th className="px-2 py-2">{t('g5.mrp.bom.col.hash')}</th>
                    <th className="px-2 py-2">{t('g5.mrp.bom.col.requirements')}</th>
                    <th className="px-2 py-2">{t('g5.mrp.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {productionRecs.map((rec) => (
                    <tr key={rec.id} className="border-t border-grid">
                      <td className="px-2 py-1.5 text-xs">
                        {nameById(finishedProducts, str(rec.finishedProductId))}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(num(rec.remainingDemand ?? rec.requiredQty))}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {str(rec.packagingBomId) || '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {rec.packagingBomVersion ?? '—'}
                      </td>
                      <td
                        className="px-2 py-1.5 font-mono text-xs"
                        title={str(rec.packagingBomContentHash)}
                      >
                        {shortContentHash(str(rec.packagingBomContentHash))}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-stone-600">
                        {formatPackagingRequirementsSummary(rec.packagingRequirements, warehouseItems)}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold">
                          {str(rec.status) || 'open'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
            <table className="fc-table min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
                <tr>
                  <th className="px-2 py-2" />
                  <th className="px-2 py-2">{t('g5.mrp.col.code')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.shortageQty')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.firstShortageDate')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.priority')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.leadTime')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.supplier')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.status')}</th>
                  <th className="px-2 py-2">{t('g5.mrp.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredShortages.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-center text-sm text-stone-400">
                      {t('g5.mrp.empty.shortages')}
                    </td>
                  </tr>
                ) : (
                  filteredShortages.map((s) => {
                    const meta = itemMeta(warehouseItems, s.itemId)
                    return (
                      <tr key={s.id} className="border-t border-grid">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedShortageIds.includes(s.id)}
                            onChange={() => toggleShortage(s.id)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-mono text-xs">{meta.code}</div>
                          <div className="text-xs text-stone-500">{meta.name}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold text-red-700">
                          {formatQty(num(s.shortageQty))}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs">
                          {str(s.firstShortageDate) || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">
                          {num(s.priority)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs">
                          {num(s.leadTimeDays) || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-xs">
                          {s.supplierId
                            ? nameById(counterparties, str(s.supplierId))
                            : t('g5.mrp.noSupplier')}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold">
                            {t(`g5.mrp.shortageStatus.${str(s.status) || 'open'}`)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            <Button
                              size="xs"
                              disabled={inFlight || str(s.status) !== 'open'}
                              onClick={() => void handleAcknowledge(s.id)}
                            >
                              {t('g5.mrp.action.acknowledge')}
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={inFlight || str(s.status) === 'resolved'}
                              onClick={() => {
                                setResolveTargetId(s.id)
                                setResolveReason('')
                              }}
                            >
                              {t('g5.mrp.action.resolveManual')}
                            </Button>
                          </div>
                          {resolveTargetId === s.id ? (
                            <div className="mt-2 space-y-1">
                              <input
                                className="fc-input w-full text-xs"
                                value={resolveReason}
                                onChange={(e) => setResolveReason(e.target.value)}
                                placeholder={t('g5.mrp.resolveReasonPlaceholder')}
                              />
                              <Button
                                size="xs"
                                variant="primary"
                                disabled={inFlight || !resolveReason.trim()}
                                onClick={() => void handleResolveManual(s.id)}
                              >
                                {t('g5.mrp.action.confirmResolve')}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {selectedShortageIds.length > 0 ? (
            <p className="text-xs text-stone-500">
              {tf('g5.mrp.selectedCount', { count: selectedShortageIds.length })}
            </p>
          ) : null}
        </section>
      )}

      {section === 'procurement' && (
        <section className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <h3 className="border-b border-grid px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {t('g5.mrp.section.procurement')}
          </h3>
          <table className="fc-table min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-2 py-2">{t('g5.mrp.col.poId')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.status')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.supplier')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.sourceRun')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.shortageIds')}</th>
                <th className="px-2 py-2 text-right">{t('g5.mrp.col.qty')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.eta')}</th>
                <th className="px-2 py-2">{t('g5.mrp.col.moq')}</th>
                {canViewPayment ? (
                  <th className="px-2 py-2 text-right">{t('g5.mrp.col.payment')}</th>
                ) : null}
                <th className="px-2 py-2">{t('g5.mrp.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {poList.length === 0 ? (
                <tr>
                  <td
                    colSpan={canViewPayment ? 10 : 9}
                    className="px-3 py-4 text-center text-sm text-stone-400"
                  >
                    {t('g5.mrp.empty.procurement')}
                  </td>
                </tr>
              ) : (
                poList.map((po) => {
                  const status = str(po.status) || 'draft'
                  const eta = str(po.eta || po.confirmedDeliveryDate || '')
                  const overdue =
                    eta &&
                    !['received', 'cancelled'].includes(status) &&
                    eta < new Date().toISOString().slice(0, 10)
                  const qty = (po.lines ?? []).reduce(
                    (sum, ln) => sum + num(ln.requestedQty),
                    0,
                  )
                  const shortageIds = [
                    ...new Set(
                      (po.lines ?? []).flatMap((ln) => ln.sourceShortageIds ?? []),
                    ),
                  ]
                  const moqNote = (po.lines ?? []).some(
                    (ln) => ln.moqApplied === true || num(ln.requestedQty) > 0,
                  )
                  return (
                    <tr key={po.id} className="border-t border-grid">
                      <td className="px-2 py-1.5 font-mono text-xs">{po.id}</td>
                      <td className="px-2 py-1.5">
                        <span className="rounded-sm bg-stone-100 px-2 py-0.5 text-[10px] font-semibold">
                          {t(`g5.mrp.poStatus.${status}`)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {str(po.supplierNameSnapshot) ||
                          nameById(counterparties, str(po.supplierId)) ||
                          '—'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {str(po.sourcePlanningRunId) || '—'}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-stone-500">
                        {shortageIds.length ? shortageIds.join(', ') : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs">
                        {formatQty(qty)}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-xs">
                        {eta || '—'}
                        {overdue ? (
                          <span className="ml-1 rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800">
                            {t('g5.mrp.overdue')}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-stone-500">
                        {moqNote ? t('g5.mrp.moqNote') : '—'}
                      </td>
                      {canViewPayment ? (
                        <td className="px-2 py-1.5 text-right font-mono text-xs">
                          {po.paymentTotal != null
                            ? `${formatQty(num(po.paymentTotal))} ${str(po.currency) || ''}`
                            : '—'}
                        </td>
                      ) : null}
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {status === 'draft' ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              disabled={inFlight}
                              onClick={() => void handlePoLifecycle(po.id, 'submit')}
                            >
                              {t('g5.mrp.action.poSubmit')}
                            </Button>
                          ) : null}
                          {status === 'submitted' ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              disabled={inFlight}
                              onClick={() => void handlePoLifecycle(po.id, 'approve')}
                            >
                              {t('g5.mrp.action.poApprove')}
                            </Button>
                          ) : null}
                          {status === 'approved' ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              disabled={inFlight}
                              onClick={() => void handlePoLifecycle(po.id, 'ordered')}
                            >
                              {t('g5.mrp.action.poOrdered')}
                            </Button>
                          ) : null}
                          {['approved', 'ordered', 'partially_received'].includes(status) ? (
                            <Button
                              size="xs"
                              variant="secondary"
                              disabled={inFlight}
                              onClick={() => void handlePoPartialReceipt(po)}
                            >
                              {t('g5.mrp.action.poReceipt')}
                            </Button>
                          ) : null}
                          {canViewPayment &&
                          ['approved', 'ordered', 'partially_received', 'received'].includes(
                            status,
                          ) ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={inFlight}
                              onClick={() => void handlePoPayment(po.id)}
                            >
                              {t('g5.mrp.action.poPayment')}
                            </Button>
                          ) : null}
                          {!['received', 'cancelled'].includes(status) ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={inFlight}
                              onClick={() => void handlePoLifecycle(po.id, 'cancel')}
                            >
                              {t('g5.mrp.action.poCancel')}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </section>
      )}

      {section === 'capacity' && (
        <G6CapacityWorkspace
          store={store}
          asOfDate={asOfDate}
          finishedProducts={finishedProducts}
          canActivateG6={canActivateG6}
          onStoreMirrored={onG6StoreMirrored}
        />
      )}
    </div>
  )
}

/**
 * PHASE G6 — capacity planning workspace (activate → run → schedule → publish).
 * Mutating actions go through g6ServerClient; success UI only after server ack.
 */
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { readCapacityFromStore } from '@/lib/cloud/g6AuthoritativeStrip'
import {
  g6CapacityDomainActivate,
  g6CapacityOverloadApprove,
  g6CapacityRun,
  g6CapacityScheduleMove,
  g6CapacitySchedulePublish,
  g6CapacityScheduleSplit,
  g6FlagsFromStore,
  mirrorG6AckIfOk,
  type G6AckPayload,
  type G6CapacityAllocation,
  type G6CapacityBucket,
  type G6CapacityRun,
  type G6CapacitySchedule,
  type G6ServerResult,
} from '@/lib/planner/g6ServerClient'
import type { AppStore } from '@/lib/types'
import { formatQty } from '@/lib/warehouse/stock'

export type G6CapacityWorkspaceProps = {
  store?: AppStore | null
  asOfDate?: string
  finishedProducts?: unknown[]
  /** Parent decides — true for sysadmin / capacity.norm.approve path. */
  canActivateG6?: boolean
  onStoreMirrored?: (next: AppStore) => void
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

function mapServerError(
  result: G6ServerResult<unknown>,
  t: (k: string) => string,
): string {
  const err = str(result.ok === false ? result.error : '')
  const msg = result.ok === false ? result.message : ''
  if (err === '401' || err === 'unauthorized' || /unauth/i.test(err)) {
    return t('g6.capacity.error.unauthorized')
  }
  if (err === '403' || err === 'forbidden' || /forbidden|capability|denied/i.test(err)) {
    return t('g6.capacity.error.forbidden')
  }
  if (err === '409' || /conflict|stale|revision|inactive/i.test(err) || /conflict|stale|inactive/i.test(msg)) {
    return t('g6.capacity.error.conflict')
  }
  return msg || err || t('g6.capacity.error.generic')
}

function nameById(list: unknown[] | undefined, id: string): string {
  if (!id || !Array.isArray(list)) return id || '—'
  for (const raw of list) {
    const row = asRecord(raw)
    if (row && str(row.id) === id) return str(row.name || row.code || id)
  }
  return id
}

function lineLabel(lineId: string, t: (k: string) => string): string {
  if (lineId === '1') return t('g6.capacity.line.1')
  if (lineId === '2') return t('g6.capacity.line.2')
  if (lineId === 'pack') return t('g6.capacity.line.pack')
  return lineId || '—'
}

function stageLabel(stage: string, t: (k: string) => string): string {
  if (stage === 'packaging') return t('g6.capacity.stage.packaging')
  if (stage === 'production') return t('g6.capacity.stage.production')
  return stage || '—'
}

function latestRun(capacity: ReturnType<typeof readCapacityFromStore>): G6CapacityRun | null {
  const runs = Array.isArray(capacity?.runs) ? (capacity!.runs as G6CapacityRun[]) : []
  if (!runs.length) return null
  return (
    [...runs].sort((a, b) => str(b.calculatedAt).localeCompare(str(a.calculatedAt)))[0] ?? null
  )
}

function draftSchedule(
  capacity: ReturnType<typeof readCapacityFromStore>,
  runId?: string,
): G6CapacitySchedule | null {
  const schedules = Array.isArray(capacity?.schedules)
    ? (capacity!.schedules as G6CapacitySchedule[])
    : []
  const drafts = schedules.filter((s) => str(s.status) === 'draft')
  if (runId) {
    const match = drafts.find((s) => str(s.capacityRunId) === runId)
    if (match) return match
  }
  return drafts[0] ?? null
}

type PlanActualRow = {
  key: string
  date: string
  shiftId: string
  lineId: string
  stage: string
  planM2: number
  actualM2: number
}

function buildPlanVsActual(
  allocations: G6CapacityAllocation[],
  store: AppStore | null | undefined,
): PlanActualRow[] {
  const shiftReports = Array.isArray(store?.production?.shiftReports)
    ? store!.production!.shiftReports!
    : []
  const packagingReports = Array.isArray(store?.production?.packagingReports)
    ? store!.production!.packagingReports!
    : []

  const planByKey = new Map<string, PlanActualRow>()
  for (const a of allocations) {
    if (a.aggregated || !a.date) continue
    const stage = str(a.stage || 'production')
    const lineId = str(a.lineId)
    const date = str(a.date)
    const shiftId = str(a.shiftId || 'day')
    const key = `${lineId}|${stage}|${date}|${shiftId}`
    const prev = planByKey.get(key)
    const qty = num(a.quantityM2)
    if (prev) {
      prev.planM2 += qty
    } else {
      planByKey.set(key, {
        key,
        date,
        shiftId,
        lineId,
        stage,
        planM2: qty,
        actualM2: 0,
      })
    }
  }

  for (const raw of shiftReports) {
    const r = asRecord(raw)
    if (!r || str(r.status) !== 'confirmed') continue
    const lineId = str(r.lineId)
    const date = str(r.date || r.shiftDate || '').slice(0, 10)
    const shiftId = str(r.shift || r.shiftId || 'day')
    const stage =
      lineId === 'pack' || str(r.stage) === 'packaging' ? 'packaging' : 'production'
    if (stage === 'packaging') continue
    const key = `${lineId}|production|${date}|${shiftId}`
    const row = planByKey.get(key)
    if (row) row.actualM2 += num(r.outputMp)
  }

  for (const raw of packagingReports) {
    const r = asRecord(raw)
    if (!r || str(r.status) !== 'confirmed') continue
    const lineId = str(r.lineId || 'pack')
    const date = str(r.date || r.shiftDate || '').slice(0, 10)
    const shiftId = str(r.shift || r.shiftId || 'day')
    const key = `${lineId}|packaging|${date}|${shiftId}`
    const row = planByKey.get(key)
    if (row) row.actualM2 += num(r.outputMp ?? r.quantityMp)
  }

  return [...planByKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.lineId.localeCompare(b.lineId))
}

export function G6CapacityWorkspace({
  store,
  asOfDate,
  finishedProducts = [],
  canActivateG6 = false,
  onStoreMirrored,
}: G6CapacityWorkspaceProps) {
  const { t, tf } = useI18n()
  const [localStore, setLocalStore] = useState<AppStore | null>(null)
  const [lastAck, setLastAck] = useState<G6AckPayload | null>(null)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [filterPeriod, setFilterPeriod] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterLine, setFilterLine] = useState('')
  const [filterFirm, setFilterFirm] = useState<'all' | 'firm' | 'tentative'>('all')

  const [selectedAllocationId, setSelectedAllocationId] = useState<string | null>(null)
  const [moveDate, setMoveDate] = useState('')
  const [moveLineId, setMoveLineId] = useState('')
  const [moveShiftId, setMoveShiftId] = useState('day')
  const [splitQty, setSplitQty] = useState('')
  const [splitDate, setSplitDate] = useState('')
  const [splitLineId, setSplitLineId] = useState('')
  const [overloadReason, setOverloadReason] = useState('')

  const effectiveStore = localStore ?? store ?? null
  const flags = g6FlagsFromStore(effectiveStore)
  const capacity = useMemo(() => {
    if (lastAck?.capacity && typeof lastAck.capacity === 'object') {
      return lastAck.capacity
    }
    return readCapacityFromStore(effectiveStore)
  }, [lastAck, effectiveStore])

  const run = latestRun(capacity)
  const schedule = draftSchedule(capacity, str(run?.capacityRunId))
  const allocations = useMemo((): G6CapacityAllocation[] => {
    if (Array.isArray(schedule?.allocations)) {
      return schedule!.allocations as G6CapacityAllocation[]
    }
    return [
      ...(Array.isArray(run?.firmAllocations) ? run!.firmAllocations! : []),
      ...(Array.isArray(run?.tentativeAllocations) ? run!.tentativeAllocations! : []),
    ]
  }, [schedule, run])

  const selected = allocations.find((a) => str(a.allocationId) === selectedAllocationId) ?? null

  const filteredAllocations = allocations.filter((a) => {
    if (filterProduct && str(a.finishedProductId) !== filterProduct) return false
    if (filterLine && str(a.lineId) !== filterLine) return false
    if (filterFirm === 'firm' && a.firm !== true) return false
    if (filterFirm === 'tentative' && a.firm === true) return false
    if (filterPeriod) {
      const period = filterPeriod.trim()
      if (period.length === 7) {
        const ym = str(a.month || a.date).slice(0, 7)
        if (ym !== period) return false
      } else if (period.length >= 10) {
        if (str(a.date) !== period.slice(0, 10) && str(a.month) !== period.slice(0, 7)) return false
      }
    }
    return true
  })

  const detailedBuckets: G6CapacityBucket[] = Array.isArray(run?.detailedBuckets)
    ? run!.detailedBuckets!
    : []
  const monthlyBuckets: G6CapacityBucket[] = Array.isArray(run?.monthlyBuckets)
    ? run!.monthlyBuckets!
    : []

  const filteredDetailed = detailedBuckets.filter((b) => {
    if (filterLine && str(b.lineId) !== filterLine) return false
    if (filterPeriod) {
      const p = filterPeriod.trim()
      if (p.length === 7 && str(b.date).slice(0, 7) !== p) return false
      if (p.length >= 10 && str(b.date) !== p.slice(0, 10)) return false
    }
    return true
  })

  const filteredMonthly = monthlyBuckets.filter((b) => {
    if (filterLine && str(b.lineId) !== filterLine) return false
    if (filterPeriod) {
      const p = filterPeriod.trim().slice(0, 7)
      if (p.length === 7 && str(b.month) !== p) return false
    }
    return true
  })

  const lateOrders = Array.isArray(run?.lateOrders)
    ? run!.lateOrders!
    : Array.isArray(lastAck?.lateOrders)
      ? lastAck!.lateOrders!
      : []
  const materialBlocked = Array.isArray(run?.materialBlockedOrders)
    ? run!.materialBlockedOrders!
    : Array.isArray(lastAck?.materialBlockedOrders)
      ? lastAck!.materialBlockedOrders!
      : []

  const planVsActual = useMemo(
    () => buildPlanVsActual(allocations.filter((a) => a.firm === true), effectiveStore),
    [allocations, effectiveStore],
  )

  async function applyResult(result: G6ServerResult<G6AckPayload>, okMessage: string) {
    if (!result.ok) {
      setError(mapServerError(result, t))
      setSuccess(null)
      return
    }
    setLastAck(result.data)
    setError(null)
    setSuccess(okMessage)
    if (effectiveStore) {
      const mirrored = mirrorG6AckIfOk(effectiveStore, result)
      if (mirrored) {
        setLocalStore(mirrored)
        onStoreMirrored?.(mirrored)
      }
    }
  }

  async function handleActivate() {
    if (!canActivateG6 || inFlight) return
    setInFlight(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await g6CapacityDomainActivate({
        idempotencyKey: idemKey('g6-activate'),
        reason: 'ui-activate',
      })
      await applyResult(result, t('g6.capacity.activated'))
    } finally {
      setInFlight(false)
    }
  }

  async function handleRun() {
    if (inFlight) return
    setInFlight(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await g6CapacityRun({
        idempotencyKey: idemKey('g6-run'),
        asOfDate: asOfDate || new Date().toISOString().slice(0, 10),
      })
      await applyResult(result, t('g6.capacity.runDone'))
    } finally {
      setInFlight(false)
    }
  }

  async function handleMove() {
    if (!schedule?.scheduleId || !selected?.allocationId || inFlight) return
    setInFlight(true)
    setError(null)
    try {
      const result = await g6CapacityScheduleMove({
        idempotencyKey: idemKey('g6-move'),
        scheduleId: schedule.scheduleId,
        allocationId: selected.allocationId,
        date: moveDate || selected.date,
        lineId: moveLineId || selected.lineId,
        shiftId: moveShiftId || selected.shiftId || 'day',
      })
      await applyResult(result, t('g6.capacity.moveDone'))
    } finally {
      setInFlight(false)
    }
  }

  async function handleSplit() {
    if (!schedule?.scheduleId || !selected?.allocationId || inFlight) return
    const partQty = num(splitQty)
    const total = num(selected.quantityM2)
    if (!(partQty > 0) || partQty >= total) {
      setError(t('g6.capacity.splitInvalid'))
      return
    }
    setInFlight(true)
    setError(null)
    try {
      const result = await g6CapacityScheduleSplit({
        idempotencyKey: idemKey('g6-split'),
        scheduleId: schedule.scheduleId,
        allocationId: selected.allocationId,
        parts: [
          {
            quantityM2: partQty,
            date: splitDate || selected.date,
            lineId: splitLineId || selected.lineId,
            shiftId: selected.shiftId || 'day',
          },
          {
            quantityM2: Math.round((total - partQty) * 1e6) / 1e6,
            date: selected.date,
            lineId: selected.lineId,
            shiftId: selected.shiftId || 'day',
          },
        ],
      })
      await applyResult(result, t('g6.capacity.splitDone'))
    } finally {
      setInFlight(false)
    }
  }

  async function handlePublish() {
    if (!schedule?.scheduleId || inFlight) return
    setInFlight(true)
    setError(null)
    try {
      const result = await g6CapacitySchedulePublish({
        idempotencyKey: idemKey('g6-publish'),
        scheduleId: schedule.scheduleId,
      })
      await applyResult(result, t('g6.capacity.publishDone'))
    } finally {
      setInFlight(false)
    }
  }

  async function handleOverloadApprove() {
    if (!schedule?.scheduleId || inFlight) return
    if (!overloadReason.trim()) {
      setError(t('g6.capacity.overloadReasonRequired'))
      return
    }
    setInFlight(true)
    setError(null)
    try {
      const result = await g6CapacityOverloadApprove({
        idempotencyKey: idemKey('g6-overload'),
        scheduleId: schedule.scheduleId,
        reason: overloadReason.trim(),
      })
      await applyResult(result, t('g6.capacity.overloadApproved'))
    } finally {
      setInFlight(false)
    }
  }

  if (!flags.capacityPlanningActive) {
    return (
      <section className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
        <div className="font-medium">{t('g6.capacity.title')}</div>
        <div className="opacity-90">{t('g5.mrp.capacityNotCalculated')}</div>
        {canActivateG6 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={inFlight} onClick={() => void handleActivate()}>
              {inFlight ? t('g6.capacity.activating') : t('g6.capacity.activate')}
            </Button>
            <span className="text-xs opacity-80">{t('g6.capacity.activateHint')}</span>
          </div>
        ) : (
          <div className="mt-1 text-xs opacity-80">{t('g6.capacity.activateNeedAdmin')}</div>
        )}
        {error ? (
          <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
        ) : null}
        {success ? (
          <FormNotice type="success" message={success} onDismiss={() => setSuccess(null)} />
        ) : null}
      </section>
    )
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{t('g6.capacity.title')}</div>
          <div className="text-xs text-slate-600">
            {run
              ? tf('g6.capacity.lastRun', {
                  at: str(run.calculatedAt) || '—',
                  load: formatQty(num(run.loadPercentage ?? lastAck?.loadPercentage)),
                  free: formatQty(num(run.freeCapacity ?? lastAck?.freeCapacity)),
                })
              : t('g6.capacity.noRun')}
            {run?.stale === true ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                {t('g6.capacity.stale')}
              </span>
            ) : null}
          </div>
        </div>
        <Button size="sm" disabled={inFlight} onClick={() => void handleRun()}>
          {inFlight ? t('g6.capacity.running') : t('g6.capacity.run')}
        </Button>
      </div>

      {error ? (
        <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
      ) : null}
      {success ? (
        <FormNotice type="success" message={success} onDismiss={() => setSuccess(null)} />
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <label className="flex flex-col gap-0.5 text-xs">
          <span>{t('g6.capacity.filter.period')}</span>
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            placeholder="YYYY-MM / YYYY-MM-DD"
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span>{t('g6.capacity.filter.product')}</span>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={filterProduct}
            onChange={(e) => setFilterProduct(e.target.value)}
          >
            <option value="">{t('g6.capacity.filter.all')}</option>
            {finishedProducts.map((raw) => {
              const row = asRecord(raw)
              if (!row?.id) return null
              return (
                <option key={str(row.id)} value={str(row.id)}>
                  {str(row.code || row.name || row.id)}
                </option>
              )
            })}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span>{t('g6.capacity.filter.line')}</span>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={filterLine}
            onChange={(e) => setFilterLine(e.target.value)}
          >
            <option value="">{t('g6.capacity.filter.all')}</option>
            <option value="1">{lineLabel('1', t)}</option>
            <option value="2">{lineLabel('2', t)}</option>
            <option value="pack">{lineLabel('pack', t)}</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs">
          <span>{t('g6.capacity.filter.firmness')}</span>
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={filterFirm}
            onChange={(e) => setFilterFirm(e.target.value as 'all' | 'firm' | 'tentative')}
          >
            <option value="all">{t('g6.capacity.filter.all')}</option>
            <option value="firm">{t('g6.capacity.filter.firm')}</option>
            <option value="tentative">{t('g6.capacity.filter.tentative')}</option>
          </select>
        </label>
      </div>

      <section className="space-y-2">
        <div className="font-medium">{t('g6.capacity.detailedCalendar')}</div>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">{t('g6.capacity.col.date')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.shift')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.line')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.stage')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.loadPct')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.free')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.load')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.capacity')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredDetailed.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-slate-500">
                    {t('g6.capacity.emptyBuckets')}
                  </td>
                </tr>
              ) : (
                filteredDetailed
                  .slice()
                  .sort((a, b) =>
                    str(a.date).localeCompare(str(b.date)) ||
                    str(a.lineId).localeCompare(str(b.lineId)) ||
                    str(a.stage).localeCompare(str(b.stage)),
                  )
                  .map((b, i) => {
                    const overloaded = num(b.loadPct) > 100
                    return (
                      <tr
                        key={`${b.lineId}-${b.stage}-${b.date}-${b.shiftId}-${i}`}
                        className={overloaded ? 'bg-rose-50' : undefined}
                      >
                        <td className="px-2 py-1">{str(b.date)}</td>
                        <td className="px-2 py-1">{str(b.shiftId || 'day')}</td>
                        <td className="px-2 py-1">{lineLabel(str(b.lineId), t)}</td>
                        <td className="px-2 py-1">{stageLabel(str(b.stage), t)}</td>
                        <td className="px-2 py-1">{formatQty(num(b.loadPct))}%</td>
                        <td className="px-2 py-1">{formatQty(num(b.freeM2))}</td>
                        <td className="px-2 py-1">{formatQty(num(b.loadM2))}</td>
                        <td className="px-2 py-1">{formatQty(num(b.capacityM2))}</td>
                      </tr>
                    )
                  })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="font-medium">{t('g6.capacity.monthlyTable')}</div>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">{t('g6.capacity.col.month')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.line')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.stage')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.loadPct')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.free')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.load')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.capacity')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredMonthly.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-slate-500">
                    {t('g6.capacity.emptyBuckets')}
                  </td>
                </tr>
              ) : (
                filteredMonthly
                  .slice()
                  .sort((a, b) =>
                    str(a.month).localeCompare(str(b.month)) ||
                    str(a.lineId).localeCompare(str(b.lineId)),
                  )
                  .map((b, i) => (
                    <tr key={`${b.lineId}-${b.stage}-${b.month}-${i}`}>
                      <td className="px-2 py-1">{str(b.month)}</td>
                      <td className="px-2 py-1">{lineLabel(str(b.lineId), t)}</td>
                      <td className="px-2 py-1">{stageLabel(str(b.stage), t)}</td>
                      <td className="px-2 py-1">{formatQty(num(b.loadPct))}%</td>
                      <td className="px-2 py-1">{formatQty(num(b.freeM2))}</td>
                      <td className="px-2 py-1">{formatQty(num(b.loadM2))}</td>
                      <td className="px-2 py-1">{formatQty(num(b.capacityM2))}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded border border-slate-200 p-3">
          <div className="mb-2 font-medium">{t('g6.capacity.lateOrders')}</div>
          {lateOrders.length === 0 ? (
            <div className="text-xs text-slate-500">{t('g6.capacity.emptyList')}</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {lateOrders.map((raw, i) => {
                const row = asRecord(raw)
                return (
                  <li key={str(row?.sourceId) || i}>
                    {str(row?.sourceId)} · {nameById(finishedProducts, str(row?.finishedProductId))} ·{' '}
                    {formatQty(num(row?.remaining ?? row?.quantityM2))} m²
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="rounded border border-slate-200 p-3">
          <div className="mb-2 font-medium">{t('g6.capacity.materialBlocked')}</div>
          {materialBlocked.length === 0 ? (
            <div className="text-xs text-slate-500">{t('g6.capacity.emptyList')}</div>
          ) : (
            <ul className="space-y-1 text-xs">
              {materialBlocked.map((raw, i) => {
                const row = asRecord(raw)
                return (
                  <li key={str(row?.sourceId) || i}>
                    {str(row?.sourceId)} · {nameById(finishedProducts, str(row?.finishedProductId))} ·{' '}
                    {formatQty(num(row?.remaining))} m²
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-2">
        <div className="font-medium">{t('g6.capacity.allocations')}</div>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">{t('g6.capacity.col.order')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.product')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.line')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.stage')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.date')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.qty')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.firmness')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.norm')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAllocations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-slate-500">
                    {t('g6.capacity.emptyList')}
                  </td>
                </tr>
              ) : (
                filteredAllocations.map((a) => {
                  const id = str(a.allocationId)
                  const active = id === selectedAllocationId
                  return (
                    <tr
                      key={id || `${a.sourceId}-${a.date}-${a.lineId}`}
                      className={`cursor-pointer ${active ? 'bg-sky-50' : a.overload ? 'bg-rose-50' : ''}`}
                      onClick={() => {
                        setSelectedAllocationId(id)
                        setMoveDate(str(a.date))
                        setMoveLineId(str(a.lineId))
                        setMoveShiftId(str(a.shiftId || 'day'))
                        setSplitDate(str(a.date))
                        setSplitLineId(str(a.lineId))
                        setSplitQty('')
                      }}
                    >
                      <td className="px-2 py-1">{str(a.sourceId)}</td>
                      <td className="px-2 py-1">
                        {nameById(finishedProducts, str(a.finishedProductId))}
                      </td>
                      <td className="px-2 py-1">{lineLabel(str(a.lineId), t)}</td>
                      <td className="px-2 py-1">{stageLabel(str(a.stage), t)}</td>
                      <td className="px-2 py-1">{str(a.date || a.month)}</td>
                      <td className="px-2 py-1">{formatQty(num(a.quantityM2))}</td>
                      <td className="px-2 py-1">
                        {a.firm === true
                          ? t('g6.capacity.filter.firm')
                          : t('g6.capacity.filter.tentative')}
                        {a.overload ? ` · ${t('g6.capacity.overload')}` : ''}
                      </td>
                      <td className="px-2 py-1">
                        {a.normId
                          ? `${str(a.normId)}@${str(a.normVersion)}`
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <section className="space-y-3 rounded border border-slate-200 p-3">
          <div className="font-medium">{t('g6.capacity.allocationCard')}</div>
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              {t('g6.capacity.col.order')}: {str(selected.sourceId)}
            </div>
            <div>
              {t('g6.capacity.col.product')}:{' '}
              {nameById(finishedProducts, str(selected.finishedProductId))}
            </div>
            <div>
              {t('g6.capacity.col.line')}: {lineLabel(str(selected.lineId), t)}
            </div>
            <div>
              {t('g6.capacity.col.norm')}:{' '}
              {selected.normId
                ? `${str(selected.normId)}@${str(selected.normVersion)} (${str(selected.normContentHash).slice(0, 10)})`
                : '—'}
            </div>
          </div>

          {schedule?.status === 'draft' && selected.closedShift !== true ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded bg-slate-50 p-2">
                <div className="text-xs font-medium">{t('g6.capacity.move')}</div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    type="date"
                    value={moveDate}
                    onChange={(e) => setMoveDate(e.target.value)}
                  />
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    value={moveLineId}
                    onChange={(e) => setMoveLineId(e.target.value)}
                  >
                    <option value="1">{lineLabel('1', t)}</option>
                    <option value="2">{lineLabel('2', t)}</option>
                    <option value="pack">{lineLabel('pack', t)}</option>
                  </select>
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    value={moveShiftId}
                    onChange={(e) => setMoveShiftId(e.target.value)}
                  >
                    <option value="day">{t('g6.capacity.shift.day')}</option>
                    <option value="night">{t('g6.capacity.shift.night')}</option>
                  </select>
                  <Button size="xs" disabled={inFlight} onClick={() => void handleMove()}>
                    {t('g6.capacity.move')}
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded bg-slate-50 p-2">
                <div className="text-xs font-medium">{t('g6.capacity.split')}</div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                    placeholder={t('g6.capacity.splitQty')}
                    value={splitQty}
                    onChange={(e) => setSplitQty(e.target.value)}
                  />
                  <input
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    type="date"
                    value={splitDate}
                    onChange={(e) => setSplitDate(e.target.value)}
                  />
                  <select
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    value={splitLineId}
                    onChange={(e) => setSplitLineId(e.target.value)}
                  >
                    <option value="1">{lineLabel('1', t)}</option>
                    <option value="2">{lineLabel('2', t)}</option>
                    <option value="pack">{lineLabel('pack', t)}</option>
                  </select>
                  <Button size="xs" disabled={inFlight} onClick={() => void handleSplit()}>
                    {t('g6.capacity.split')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {schedule?.status === 'draft' ? (
        <section className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-3">
          <div className="flex-1 space-y-1">
            <div className="text-xs font-medium">{t('g6.capacity.overloadApprove')}</div>
            <input
              className="w-full max-w-md rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder={t('g6.capacity.overloadReasonPlaceholder')}
              value={overloadReason}
              onChange={(e) => setOverloadReason(e.target.value)}
            />
            {schedule.overloadApproved === true ? (
              <div className="text-xs text-emerald-700">{t('g6.capacity.overloadAlready')}</div>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={inFlight || schedule.overloadApproved === true}
            onClick={() => void handleOverloadApprove()}
          >
            {t('g6.capacity.overloadApprove')}
          </Button>
          <Button size="sm" disabled={inFlight} onClick={() => void handlePublish()}>
            {t('g6.capacity.publish')}
          </Button>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="font-medium">{t('g6.capacity.planVsActual')}</div>
        <div className="text-xs text-slate-500">{t('g6.capacity.planVsActualHint')}</div>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1.5">{t('g6.capacity.col.date')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.shift')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.line')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.stage')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.plan')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.actual')}</th>
                <th className="px-2 py-1.5">{t('g6.capacity.col.delta')}</th>
              </tr>
            </thead>
            <tbody>
              {planVsActual.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-slate-500">
                    {t('g6.capacity.emptyList')}
                  </td>
                </tr>
              ) : (
                planVsActual.map((row) => (
                  <tr key={row.key}>
                    <td className="px-2 py-1">{row.date}</td>
                    <td className="px-2 py-1">{row.shiftId}</td>
                    <td className="px-2 py-1">{lineLabel(row.lineId, t)}</td>
                    <td className="px-2 py-1">{stageLabel(row.stage, t)}</td>
                    <td className="px-2 py-1">{formatQty(row.planM2)}</td>
                    <td className="px-2 py-1">{formatQty(row.actualM2)}</td>
                    <td className="px-2 py-1">{formatQty(row.actualM2 - row.planM2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

/**
 * PHASE G6 — capacity planning: norms, horizon, allocation, overload, activation, legacy.
 * Pure logic via applyG6CommandLocal / allocateHorizon; executeG6Command for forge/activation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyCriticalPayload,
  isCapacityPlanningFeatureActive,
  markCapacityPlanningFeatureActive,
  markProductionDomainActive,
  markWarehouseDomainActive,
  markMasterDataDomainActive,
  markSalesPlanningActive,
  markProcurementDomainActive,
  parseCriticalPayload,
  serializeCriticalPayload,
  fingerprintCriticalPayload,
  G1_ALLOWED_DOMAINS,
} from '../api/fst/_g1CriticalHelpers.mjs'
import { G6_CAPS, defaultG6Capabilities } from '../api/fst/_g6Capabilities.mjs'
import {
  applyG6CommandLocal,
  allocateHorizon,
  selectApprovedNorm,
  tbilisiDate,
  KNOWN_LINE_IDS,
} from '../api/fst/_g6CapacityService.mjs'

const dcState = {
  principals: new Map<string, Record<string, unknown>>(),
  critical: null as null | Record<string, unknown>,
  receipts: new Map<string, Record<string, unknown>>(),
}

const calls = {
  getPrincipal: vi.fn(async () => ({ data: { fstPrincipalAccesses: [] as unknown[] } })),
  getCritical: vi.fn(async () => ({ data: { fstCriticalStore: null as unknown } })),
  getReceipt: vi.fn(async () => ({ data: { fstCommandReceipt: null as unknown } })),
  upsertPrincipal: vi.fn(async () => undefined),
  upsertCritical: vi.fn(async () => undefined),
  updateCas: vi.fn(async () => undefined),
  insertReceipt: vi.fn(async () => undefined),
}

vi.mock('../api/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../api/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_CAPS = defaultG6Capabilities(
  Object.fromEntries(Object.values(G6_CAPS).map((k) => [k, true])),
)
const NOW = '2026-09-04T12:00:00.000Z'
const DATE = '2026-09-04'
const FP = 'fp-g6'

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  dcState.principals.clear()
  dcState.critical = null
  dcState.receipts.clear()

  calls.getPrincipal.mockImplementation(
    async (_dc: unknown, vars: { firebaseUid: string; storeId: string }) => {
      const id = `${vars.storeId}::${vars.firebaseUid}`
      const row = dcState.principals.get(id)
      return { data: { fstPrincipalAccesses: row ? [row] : [] } }
    },
  )
  calls.getCritical.mockImplementation(async () => ({
    data: { fstCriticalStore: dcState.critical },
  }))
  calls.getReceipt.mockImplementation(async (_dc: unknown, vars: { id: string }) => ({
    data: { fstCommandReceipt: dcState.receipts.get(vars.id) ?? null },
  }))
  calls.upsertCritical.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    dcState.critical = { ...row }
  })
  calls.updateCas.mockImplementation(async (_dc: unknown, vars: Record<string, unknown>) => {
    if (!dcState.critical) throw new Error('missing')
    if (dcState.critical.revision !== vars.expectedRevision) throw new Error('revision_conflict')
    dcState.critical = {
      ...dcState.critical,
      revision: vars.revision,
      payloadJson: vars.payloadJson,
      fingerprint: vars.fingerprint,
      updatedByUid: vars.updatedByUid,
    }
  })
  calls.insertReceipt.mockImplementation(async (_dc: unknown, row: Record<string, unknown>) => {
    if (dcState.receipts.has(String(row.id))) throw new Error('duplicate_receipt')
    dcState.receipts.set(String(row.id), row)
  })
})

afterEach(() => {
  vi.resetModules()
})

function grant(caps: Record<string, unknown>, uid = 'u1') {
  const id = `${STORE}::${uid}`
  dcState.principals.set(id, {
    id,
    firebaseUid: uid,
    storeId: STORE,
    roleId: 'planner',
    capabilitiesJson: JSON.stringify(caps),
    active: true,
    revision: 1,
    createdByUid: 'sys',
    updatedByUid: 'sys',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payloadFromCritical(): any {
  return JSON.parse(String(dcState.critical!.payloadJson))
}

async function g6() {
  return import('../api/fst/_g6CapacityService.mjs')
}

function weekdayTemplates(lineId: string, stage: string) {
  return [1, 2, 3, 4, 5].map((wd) => ({
    id: `ctpl-${lineId}-${stage}-${wd}`,
    lineId,
    weekday: wd,
    weekdayConvention: 'ISO_8601' as const,
    shiftId: 'day',
    stage,
    plannedMinutes: 480,
    capacityFactor: 1,
    effectiveFrom: '2026-01-01',
    effectiveTo: '2029-12-31',
  }))
}

function activePayload() {
  let p = emptyCriticalPayload()
  p = markCapacityPlanningFeatureActive(p, 'u1', NOW)
  p = markMasterDataDomainActive(p, 'u1', NOW)
  p.domains.masterData = {
    ...(p.domains.masterData ?? {}),
    finishedProducts: [
      {
        id: FP,
        code: 'FP',
        name: 'Film',
        active: true,
        validProductionLineIds: ['1', '2'],
        validPackagingLineIds: ['pack'],
      },
    ],
  }
  p.domains.capacity = {
    norms: [],
    calendars: [],
    calendarTemplates: [
      ...weekdayTemplates('1', 'production'),
      ...weekdayTemplates('2', 'production'),
      ...weekdayTemplates('pack', 'packaging'),
    ],
    downtimes: [],
    runs: [],
    schedules: [],
    auditLog: [],
  }
  return p
}

function approveNorm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: any,
  opts: {
    lineId: string
    stage: string
    capacityM2PerShift: number
    normId?: string
    effectiveFrom?: string
    effectiveTo?: string
  },
) {
  const draft = applyG6CommandLocal(
    p,
    'capacity.norm.draft.save',
    {
      normId: opts.normId ?? `cn-${opts.lineId}-${opts.stage}`,
      finishedProductId: FP,
      lineId: opts.lineId,
      stage: opts.stage,
      capacityM2PerShift: opts.capacityM2PerShift,
      effectiveFrom: opts.effectiveFrom ?? '2026-01-01',
      effectiveTo: opts.effectiveTo,
    },
    actor,
    NOW,
  )
  expect(draft.ok).toBe(true)
  p.domains.capacity = draft.capacity
  const ap = applyG6CommandLocal(
    p,
    'capacity.norm.approve',
    { normId: draft.result.normId, version: draft.result.version },
    actor,
    NOW,
  )
  expect(ap.ok).toBe(true)
  p.domains.capacity = ap.capacity
  return p
}

describe('G6 helpers & domain allowlist', () => {
  it('KNOWN_LINE_IDS and G1 capacity domain', () => {
    expect([...KNOWN_LINE_IDS]).toEqual(['1', '2', 'pack'])
    expect(G1_ALLOWED_DOMAINS).toContain('capacity')
  })

  it('tbilisiDate respects Asia/Tbilisi day boundaries', () => {
    // 2026-09-03 21:30 UTC = 2026-09-04 01:30 in Tbilisi (UTC+4)
    expect(tbilisiDate('2026-09-03T21:30:00.000Z')).toBe('2026-09-04')
    // 2026-09-03 19:30 UTC = 2026-09-03 23:30 in Tbilisi
    expect(tbilisiDate('2026-09-03T19:30:00.000Z')).toBe('2026-09-03')
  })
})

describe('G6 norm selection', () => {
  it('different approved norms for same product on line 1 vs 2', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: '2', stage: 'production', capacityM2PerShift: 40 })
    const n1 = selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', DATE)
    const n2 = selectApprovedNorm(p.domains.capacity.norms, FP, '2', 'production', DATE)
    expect(n1?.capacityM2PerShift).toBe(100)
    expect(n2?.capacityM2PerShift).toBe(40)
    expect(n1?.lineId).toBe('1')
    expect(n2?.lineId).toBe('2')
  })

  it('production and packaging stages are independent', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 80 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 120 })
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', DATE)?.capacityM2PerShift).toBe(80)
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, 'pack', 'packaging', DATE)?.capacityM2PerShift).toBe(120)
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'packaging', DATE)).toBeNull()
  })

  it('approved/draft/retired/effective window selection', () => {
    let p = activePayload()
    // draft only — ignored
    const d = applyG6CommandLocal(
      p,
      'capacity.norm.draft.save',
      {
        normId: 'cn-draft',
        finishedProductId: FP,
        lineId: '1',
        stage: 'production',
        capacityM2PerShift: 10,
        effectiveFrom: '2026-01-01',
      },
      actor,
      NOW,
    )
    p.domains.capacity = d.capacity
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', DATE)).toBeNull()

    p = approveNorm(p, {
      lineId: '1',
      stage: 'production',
      capacityM2PerShift: 50,
      normId: 'cn-old',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
    })
    p = approveNorm(p, {
      lineId: '1',
      stage: 'production',
      capacityM2PerShift: 90,
      normId: 'cn-cur',
      effectiveFrom: '2026-07-01',
    })
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', '2026-03-15')?.capacityM2PerShift).toBe(50)
    const cur = selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', DATE)
    expect(cur?.capacityM2PerShift).toBe(90)

    const retire = applyG6CommandLocal(
      p,
      'capacity.norm.retire',
      { normId: cur.normId, version: cur.version },
      actor,
      NOW,
    )
    expect(retire.ok).toBe(true)
    p.domains.capacity = retire.capacity
    expect(selectApprovedNorm(p.domains.capacity.norms, FP, '1', 'production', DATE)).toBeNull()
  })
})

describe('G6 allocation horizon & ordering', () => {
  it('3 months detailed + 9 months aggregated', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 10 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 10 })
    // huge firm order forces spill into aggregated months
    p.domains.production.orders = [
      {
        id: 'ord-big',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50000,
        priority: 1,
        dueDate: '2027-12-01',
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.detailedMonths).toBe(3)
    expect(body.horizonMonths).toBe(12)
    expect(body.timezone).toBe('Asia/Tbilisi')
    const detailedDates = new Set(body.detailedBuckets.map((b: { date: string }) => b.date?.slice(0, 7)))
    expect([...detailedDates].sort()).toEqual(['2026-09', '2026-10', '2026-11'])
    const months = body.monthlyBuckets.map((b: { month: string }) => b.month).sort()
    expect(months.length).toBeGreaterThan(0)
    expect(months[0]).toBe('2026-12')
    expect(months[months.length - 1]).toBe('2027-08')
    expect(body.firmAllocations.some((a: { aggregated?: boolean }) => a.aggregated === true)).toBe(true)
  })

  it('firm before tentative; higher priority and earlier due first', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    p.domains.production.orders = [
      {
        id: 'ord-low',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 40,
        priority: 1,
        dueDate: '2026-09-20',
        createdAt: NOW,
      },
      {
        id: 'ord-high',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 40,
        priority: 10,
        dueDate: '2026-09-10',
        createdAt: NOW,
      },
    ]
    p.domains.planning.productionRecommendations = [
      {
        id: 'rec-tent',
        status: 'tentative',
        finishedProductId: FP,
        lineId: '1',
        quantityMp: 40,
        priority: 99,
        dueDate: '2026-09-05',
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const day0Firm = body.firmAllocations.filter(
      (a: { date?: string; stage: string }) => a.date === DATE && a.stage === 'production',
    )
    expect(day0Firm.map((a: { sourceId: string }) => a.sourceId)).toEqual(['ord-high', 'ord-low'])
    const tentDay0 = body.tentativeAllocations.filter(
      (a: { date?: string; stage: string }) => a.date === DATE && a.stage === 'production',
    )
    // firm consumed 80 of 100; tentative gets remainder
    expect(tentDay0[0]?.sourceId).toBe('rec-tent')
    expect(tentDay0[0]?.quantityM2).toBe(20)
  })
})

describe('G6 calendar, downtime, reports, material marker', () => {
  it('partial/reduced shift capacityFactor cuts available capacity', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    const cal = applyG6CommandLocal(
      p,
      'capacity.calendar.upsert',
      { lineId: '1', date: DATE, shiftId: 'day', status: 'reduced', capacityFactor: 0.5 },
      actor,
      NOW,
    )
    p.domains.capacity = cal.capacity
    p.domains.production.orders = [
      {
        id: 'ord-1',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 100,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const bucket = body.detailedBuckets.find(
      (b: { lineId: string; date: string; stage: string }) =>
        b.lineId === '1' && b.date === DATE && b.stage === 'production',
    )
    expect(bucket?.capacityM2).toBe(50)
    expect(bucket?.factor).toBe(0.5)
  })

  it('downtime reduces capacity without double-counting calendar', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 480 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    const dt = applyG6CommandLocal(
      p,
      'capacity.downtime.record',
      { lineId: '1', date: DATE, shiftId: 'day', minutes: 240, reason: 'maint' },
      actor,
      NOW,
    )
    p.domains.capacity = dt.capacity
    p.domains.production.orders = [
      {
        id: 'ord-1',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 480,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const bucket = body.detailedBuckets.find(
      (b: { lineId: string; date: string; stage: string }) =>
        b.lineId === '1' && b.date === DATE && b.stage === 'production',
    )
    expect(bucket?.capacityM2).toBe(240)
  })

  it('confirmed shift report reduces remaining load', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    p.domains.production.orders = [
      {
        id: 'ord-1',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 100,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    p.domains.production.shiftReports = [
      {
        id: 'sr-1',
        status: 'confirmed',
        productionOrderId: 'ord-1',
        lineId: '1',
        outputMp: 60,
        stage: 'production',
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const prodAlloc = body.firmAllocations.filter(
      (a: { sourceId: string; stage: string; overload?: boolean }) =>
        a.sourceId === 'ord-1' && a.stage === 'production' && !a.overload,
    )
    const sum = prodAlloc.reduce((s: number, a: { quantityM2: number }) => s + a.quantityM2, 0)
    expect(sum).toBe(40)
  })

  it('material shortage marks order without double-reducing capacity', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    p.domains.production.orders = [
      {
        id: 'ord-short',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50,
        materialShortage: true,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.materialBlockedOrders.some((m: { sourceId: string }) => m.sourceId === 'ord-short')).toBe(
      true,
    )
    const alloc = body.firmAllocations.find(
      (a: { sourceId: string; stage: string; date?: string }) =>
        a.sourceId === 'ord-short' && a.stage === 'production' && a.date === DATE,
    )
    expect(alloc?.quantityM2).toBe(50)
    expect(alloc?.materialBlocked).toBe(true)
    const bucket = body.detailedBuckets.find(
      (b: { lineId: string; date: string; stage: string }) =>
        b.lineId === '1' && b.date === DATE && b.stage === 'production',
    )
    // capacity reduced once by allocation, not twice for shortage
    expect(bucket?.loadM2).toBe(50)
    expect(bucket?.freeM2).toBe(50)
  })
})

describe('G6 schedule split / publish / overload', () => {
  function runWithOverload() {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 10 })
    p = approveNorm(p, { lineId: '2', stage: 'production', capacityM2PerShift: 10 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 10000 })
    p.domains.production.orders = [
      {
        id: 'ord-ov',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50000,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const run = applyG6CommandLocal(p, 'capacity.run', { asOfDate: DATE, capacityRunId: 'crun-ov' }, actor, NOW, 1)
    expect(run.ok).toBe(true)
    expect(run.result.overloadQuantity).toBeGreaterThan(0)
    p.domains.capacity = run.capacity
    return { p, scheduleId: run.result.scheduleId as string }
  }

  it('split between shifts/lines; duplicate allocation rejected', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: '2', stage: 'production', capacityM2PerShift: 100 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 1000 })
    p.domains.production.orders = [
      {
        id: 'ord-split',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 40,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const run = applyG6CommandLocal(
      p,
      'capacity.run',
      { asOfDate: DATE, capacityRunId: 'crun-sp' },
      actor,
      NOW,
      1,
    )
    p.domains.capacity = run.capacity
    const scheduleId = run.result.scheduleId
    const alloc = run.capacity.schedules[0].allocations.find(
      (a: { sourceId: string; stage: string; date?: string }) =>
        a.sourceId === 'ord-split' && a.stage === 'production' && a.date === DATE,
    )
    expect(alloc).toBeTruthy()
    const splitOk = applyG6CommandLocal(
      p,
      'capacity.schedule.split',
      {
        scheduleId,
        allocationId: alloc.allocationId,
        parts: [
          { lineId: '1', date: DATE, shiftId: 'day', quantityM2: 20 },
          { lineId: '2', date: DATE, shiftId: 'day', quantityM2: 20 },
        ],
      },
      actor,
      NOW,
    )
    expect(splitOk.ok, String(splitOk.error)).toBe(true)
    p.domains.capacity = splitOk.capacity

    // force duplicate keys → fail
    const bad = applyG6CommandLocal(
      p,
      'capacity.schedule.split',
      {
        scheduleId,
        allocationId: splitOk.result.parts[0],
        parts: [
          { lineId: '1', date: DATE, shiftId: 'day', quantityM2: 10 },
          { lineId: '1', date: DATE, shiftId: 'day', quantityM2: 10 },
        ],
      },
      actor,
      NOW,
    )
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe('duplicate_allocation')
  })

  it('overload blocks publish; director approval with reason allows publish', () => {
    const { p, scheduleId } = runWithOverload()
    const blocked = applyG6CommandLocal(p, 'capacity.schedule.publish', { scheduleId }, actor, NOW)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toBe('overload_blocks_publish')
    expect(blocked.status).toBe(403)

    const noReason = applyG6CommandLocal(p, 'capacity.overload.approve', { scheduleId }, actor, NOW)
    expect(noReason.ok).toBe(false)
    expect(noReason.error).toBe('overload_reason_required')

    const approved = applyG6CommandLocal(
      p,
      'capacity.overload.approve',
      { scheduleId, reason: 'director: accept overtime' },
      actor,
      NOW,
    )
    expect(approved.ok).toBe(true)
    p.domains.capacity = approved.capacity
    const pub = applyG6CommandLocal(p, 'capacity.schedule.publish', { scheduleId }, actor, NOW)
    expect(pub.ok, String(pub.error)).toBe(true)
    expect(pub.result.status).toBe('published')
  })

  it('stale revision marks prior runs', () => {
    let p = activePayload()
    p = approveNorm(p, { lineId: '1', stage: 'production', capacityM2PerShift: 50 })
    p = approveNorm(p, { lineId: 'pack', stage: 'packaging', capacityM2PerShift: 50 })
    p.domains.production.orders = [
      {
        id: 'ord-1',
        status: 'confirmed',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 10,
        dueDate: DATE,
        createdAt: NOW,
      },
    ]
    const run = applyG6CommandLocal(p, 'capacity.run', { asOfDate: DATE }, actor, NOW, 3)
    p.domains.capacity = run.capacity
    expect(run.capacity.runs[0].inputCriticalRevision).toBe(3)
    expect(run.capacity.runs[0].contentHash).toMatch(/^g6:/)

    const later = applyG6CommandLocal(
      p,
      'capacity.calendar.upsert',
      { lineId: '1', date: DATE, status: 'available' },
      actor,
      NOW,
      4,
    )
    expect(later.ok).toBe(true)
    expect(later.capacity.runs[0].stale).toBe(true)
    expect(later.capacity.runs[0].staleReason).toBe('critical_revision')
  })
})

describe('G6 activation / forge / execute path', () => {
  it('inactive → capacity_feature_inactive; empty domain not authoritative; production activate does not set capacityPlanning', async () => {
    const empty = emptyCriticalPayload()
    expect(isCapacityPlanningFeatureActive(empty)).toBe(false)
    const parsed = parseCriticalPayload(serializeCriticalPayload(empty))
    expect(parsed.ok).toBe(true)
    expect(isCapacityPlanningFeatureActive(parsed.payload)).toBe(false)

    const prodOnly = markProductionDomainActive(emptyCriticalPayload(), 'u1', NOW)
    expect(prodOnly.domainMeta.production.active).toBe(true)
    expect(isCapacityPlanningFeatureActive(prodOnly)).toBe(false)

    grant({ ...ALL_CAPS, productionLineIds: ['*', '1', '2', 'pack'] })
    const svc = await g6()
    const inactive = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g6-inactive-run',
      commandType: 'capacity.run',
      command: { asOfDate: DATE },
    })
    expect(inactive.ok).toBe(false)
    expect(inactive.error).toBe('capacity_feature_inactive')

    const act = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'g6-act',
      commandType: 'capacity.domain.activate',
      command: { reason: 'enable g6' },
    })
    expect(act.ok, String(act.error)).toBe(true)
    expect(act.capacityPlanningActive).toBe(true)
    expect(isCapacityPlanningFeatureActive(payloadFromCritical())).toBe(true)
  })

  it('forged client payloadJson / roleId rejected', async () => {
    grant(ALL_CAPS)
    const svc = await g6()
    const forged = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'forge-1',
      commandType: 'capacity.domain.activate',
      command: { reason: 'x' },
      payloadJson: '{}',
    })
    expect(forged.ok).toBe(false)
    expect(forged.error).toBe('forged_client_payload_rejected')

    const role = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'forge-2',
      commandType: 'capacity.domain.activate',
      command: { reason: 'x' },
      roleId: 'admin',
    })
    expect(role.ok).toBe(false)
    expect(role.error).toBe('client_role_not_proof')
  })

  it('idempotent retry returns same receipt without duplicate norms', async () => {
    grant({ ...ALL_CAPS, productionLineIds: ['*', '1', '2', 'pack'] })
    const svc = await g6()
    expect(
      (
        await svc.executeG6Command({
          actor,
          storeId: STORE,
          idempotencyKey: 'g6-act2',
          commandType: 'capacity.domain.activate',
          command: { reason: 'a' },
        })
      ).ok,
    ).toBe(true)

    const first = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'norm-1',
      commandType: 'capacity.norm.draft.save',
      command: {
        normId: 'cn-idem',
        finishedProductId: FP,
        lineId: '1',
        stage: 'production',
        capacityM2PerShift: 70,
        effectiveFrom: '2026-01-01',
      },
    })
    expect(first.ok, String(first.error)).toBe(true)
    const retry = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'norm-1',
      commandType: 'capacity.norm.draft.save',
      command: {
        normId: 'cn-idem',
        finishedProductId: FP,
        lineId: '1',
        stage: 'production',
        capacityM2PerShift: 999,
        effectiveFrom: '2026-01-01',
      },
    })
    expect(retry.ok).toBe(true)
    expect(retry.idempotent === true || retry.recoveredFromEmbeddedReceipt === true).toBe(true)
    const norms = payloadFromCritical().domains.capacity.norms ?? []
    expect(norms.filter((n: { normId: string }) => n.normId === 'cn-idem')).toHaveLength(1)
    expect(norms[0].capacityM2PerShift).toBe(70)
  })
})

describe('G6 legacy migration fail-closed', () => {
  it('ambiguous mapping → error queue; apply without stable IDs fails', () => {
    const p = activePayload()
    p.domains.production.dayPlans = [
      { id: 'dp-bad', date: DATE, productName: 'Film without id' },
      { id: 'dp-ok', date: DATE, finishedProductId: FP, lineId: '1' },
    ]
    p.domains.planning = {
      ...(p.domains.planning ?? {}),
      legacyDayPlans: [{ id: 'leg-1', name: 'old', lineId: 'line-A' }],
    }
    const scan = applyG6CommandLocal(p, 'capacity.legacy.scan', {}, actor, NOW)
    expect(scan.ok).toBe(true)
    expect(scan.result.authoritative).toBe(false)
    expect(scan.result.errorQueue.some((e: { code: string }) => e.code === 'ambiguous_mapping')).toBe(
      true,
    )
    expect(scan.result.candidates.some((c: { id: string }) => c.id === 'dp-ok')).toBe(true)

    const badApply = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      { reason: 'migrate', items: [{ finishedProductId: '', lineId: '1', date: DATE }] },
      actor,
      NOW,
    )
    expect(badApply.ok).toBe(false)
    expect(badApply.error).toBe('legacy_apply_fail_closed')

    const okApply = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'migrate-ok',
        items: [{ kind: 'calendar', finishedProductId: FP, lineId: '1', date: DATE }],
      },
      actor,
      NOW,
    )
    expect(okApply.ok, String(okApply.error)).toBe(true)
  })
})

describe('G6 cross-domain preservation (execute)', () => {
  it('warehouse/sales/planning/procurement survive capacity CAS', async () => {
    grant({ ...ALL_CAPS, productionLineIds: ['*', '1', '2', 'pack'] })
    const svc = await g6()
    await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'xd-act',
      commandType: 'capacity.domain.activate',
      command: { reason: 'xd' },
    })

    let p = payloadFromCritical()
    p = markWarehouseDomainActive(p, 'u1', NOW)
    p = markMasterDataDomainActive(p, 'u1', NOW)
    p = markSalesPlanningActive(p, 'u1', NOW)
    p = markProcurementDomainActive(p, 'u1', NOW)
    p.domains.warehouse.movements = [
      { id: 'm-keep', type: 'receipt', warehouseId: 'wh-main', itemId: 'mat-1', quantity: 9, at: DATE },
    ]
    p.domains.sales.orders = [{ id: 'so-keep', status: 'confirmed' }]
    p.domains.planning.planningRuns = [{ id: 'pr-keep', status: 'completed' }]
    p.domains.procurement.purchaseOrders = [{ id: 'po-keep', status: 'draft' }]
    const json = serializeCriticalPayload(p)
    dcState.critical!.payloadJson = json
    dcState.critical!.fingerprint = fingerprintCriticalPayload(json)

    const whBefore = structuredClone(payloadFromCritical().domains.warehouse)
    const salesBefore = structuredClone(payloadFromCritical().domains.sales)
    const planBefore = structuredClone(payloadFromCritical().domains.planning)
    const procBefore = structuredClone(payloadFromCritical().domains.procurement)

    const saved = await svc.executeG6Command({
      actor,
      storeId: STORE,
      idempotencyKey: 'xd-norm',
      commandType: 'capacity.norm.draft.save',
      command: {
        finishedProductId: FP,
        lineId: '1',
        stage: 'production',
        capacityM2PerShift: 33,
        effectiveFrom: '2026-01-01',
      },
    })
    expect(saved.ok, String(saved.error)).toBe(true)
    const after = payloadFromCritical()
    expect(after.domains.warehouse.movements).toEqual(whBefore.movements)
    expect(after.domains.sales.orders).toEqual(salesBefore.orders)
    expect(after.domains.planning.planningRuns).toEqual(planBefore.planningRuns)
    expect(after.domains.procurement.purchaseOrders).toEqual(procBefore.purchaseOrders)
  })
})

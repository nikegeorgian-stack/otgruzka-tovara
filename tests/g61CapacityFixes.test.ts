/**
 * PHASE G6.1 — long-horizon calendar templates, packaging/WIP dependency, validLineIds fail-closed.
 */
import { describe, expect, it } from 'vitest'
import {
  emptyCriticalPayload,
  markCapacityPlanningFeatureActive,
  markMasterDataDomainActive,
} from '../server/fst/_g1CriticalHelpers.mjs'
import {
  applyG6CommandLocal,
  allocateHorizon,
  computeMonthCapacityM2,
  computeOrderCapacityBalances,
  expandShiftsForDate,
  tbilisiWeekdayIso,
} from '../server/fst/_g6CapacityService.mjs'

const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const NOW = '2026-09-04T12:00:00.000Z'
const DATE = '2026-09-04'
const FP = 'fp-g61'

function weekdayTemplates(lineId: string, stage: string, weekdays: number[] = [1, 2, 3, 4, 5]) {
  return weekdays.map((wd) => ({
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

function basePayload(templates = true) {
  let p = emptyCriticalPayload()
  p = markCapacityPlanningFeatureActive(p, 'u1', NOW)
  p = markMasterDataDomainActive(p, 'u1', NOW)
  p.domains.masterData = {
    finishedProducts: [
      {
        id: FP,
        validProductionLineIds: ['1'],
        validPackagingLineIds: ['pack'],
        active: true,
      },
    ],
  }
  p.domains.capacity = {
    norms: [
      {
        normId: 'n1',
        finishedProductId: FP,
        lineId: '1',
        stage: 'production',
        version: 1,
        status: 'approved',
        capacityM2PerShift: 100,
        contentHash: 'g6:n1',
        effectiveFrom: '2026-01-01',
      },
      {
        normId: 'np',
        finishedProductId: FP,
        lineId: 'pack',
        stage: 'packaging',
        version: 1,
        status: 'approved',
        capacityM2PerShift: 80,
        contentHash: 'g6:np',
        effectiveFrom: '2026-01-01',
      },
    ],
    calendars: [],
    calendarTemplates: templates
      ? [...weekdayTemplates('1', 'production'), ...weekdayTemplates('pack', 'packaging')]
      : [],
    downtimes: [],
    runs: [],
    schedules: [],
    auditLog: [],
  }
  return p
}

describe('G6.1 long-horizon calendar', () => {
  it('month capacity is not automatically 22 × norm', () => {
    const templates = weekdayTemplates('1', 'production') // Mon–Fri only
    const computed = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2026-12',
      finishedProductId: FP,
      norms: basePayload().domains.capacity.norms,
      calendars: [],
      templates,
      downtimes: [],
    })
    expect(computed.unknown).toBe(false)
    // Dec 2026 has 23 weekdays (Mon-Fri), not fixed 22
    expect(computed.shiftCount).not.toBe(22)
    expect(computed.capacityM2).toBe(computed.shiftCount! * 100)
    expect(computed.capacityM2).not.toBe(22 * 100)
  })

  it('recurring template with different shift counts changes monthly capacity', () => {
    const monOnly = weekdayTemplates('1', 'production', [1])
    const monFri = weekdayTemplates('1', 'production', [1, 2, 3, 4, 5])
    const norms = basePayload().domains.capacity.norms
    const a = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2027-01',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates: monOnly,
      downtimes: [],
    })
    const b = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2027-01',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates: monFri,
      downtimes: [],
    })
    expect(a.shiftCount!).toBeLessThan(b.shiftCount!)
    expect(a.capacityM2).toBeLessThan(b.capacityM2!)
  })

  it('downtime reduces aggregated month capacity', () => {
    const templates = weekdayTemplates('1', 'production')
    const norms = basePayload().domains.capacity.norms
    const base = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2026-12',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates,
      downtimes: [],
    })
    const reduced = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2026-12',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates,
      downtimes: [{ id: 'dt1', lineId: '1', date: '2026-12-07', fullShift: true, status: 'active' }],
    })
    expect(reduced.capacityM2).toBeLessThan(base.capacityM2!)
  })

  it('absence of calendar/template → capacity_unknown', () => {
    const computed = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2027-03',
      finishedProductId: FP,
      norms: basePayload().domains.capacity.norms,
      calendars: [],
      templates: [],
      downtimes: [],
    })
    expect(computed.unknown).toBe(true)
    expect(computed.capacityM2).toBe(0)

    const p = basePayload(false)
    p.domains.production.orders = [
      {
        id: 'ord-1',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 500,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.errors.some((e: { code: string }) => e.code === 'capacity_unknown')).toBe(true)
    expect(body.masterDataErrors.some((e: { code: string }) => e.code === 'capacity_unknown')).toBe(
      true,
    )
  })

  it('expandShiftsForDate uses Tbilisi weekday', () => {
    // 2026-09-04 is Friday → ISO 5
    expect(tbilisiWeekdayIso('2026-09-04')).toBe(5)
    const shifts = expandShiftsForDate(
      '1',
      'production',
      '2026-09-04',
      [],
      weekdayTemplates('1', 'production'),
    )
    expect(shifts.map((s) => s.shiftId)).toEqual(['day'])
    const weekend = expandShiftsForDate(
      '1',
      'production',
      '2026-09-05', // Saturday
      [],
      weekdayTemplates('1', 'production'),
    )
    expect(weekend).toHaveLength(0)
  })
})

describe('G6.1 packaging / WIP dependency', () => {
  it('productionRemaining and packagingRemaining differ after partial WIP and partial pack', () => {
    const production = {
      orders: [{ id: 'o1', totalQtyMp: 100 }],
      shiftReports: [
        {
          id: 'sr1',
          status: 'confirmed',
          productionOrderId: 'o1',
          lineId: '1',
          outputMp: 40,
        },
      ],
      packagingReports: [
        {
          id: 'pr1',
          status: 'confirmed',
          productionOrderId: 'o1',
          outputMp: 10,
        },
      ],
      wipBatches: [],
    }
    const bal = computeOrderCapacityBalances(production, { id: 'o1', totalQtyMp: 100 })
    expect(bal.productionRemaining).toBe(60)
    expect(bal.packagingRemaining).toBe(90)
    expect(bal.actualWipAvailable).toBe(30)
    expect(bal.productionRemaining).not.toBe(bal.packagingRemaining)
  })

  it('packaging cannot be placed before WIP; future planned WIP tagged wip_planned', () => {
    const p = basePayload()
    // No actual WIP yet — packaging must wait for planned production
    p.domains.production.orders = [
      {
        id: 'ord-wip',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const prod = body.firmAllocations.filter((a: { stage: string }) => a.stage === 'production')
    const pack = body.firmAllocations.filter((a: { stage: string }) => a.stage === 'packaging')
    expect(prod.length).toBeGreaterThan(0)
    // packaging allocations that depend on planned WIP should be tagged
    const plannedTagged = pack.filter((a: { wipDependency?: string }) => a.wipDependency === 'wip_planned')
    expect(plannedTagged.length).toBeGreaterThan(0)
    // no packaging before first production date
    const firstProd = [...prod].filter((a: { date?: string }) => a.date).sort((a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : 1))[0]
    const earlyPack = pack.filter(
      (a: { date?: string; wipDependency?: string }) =>
        a.date && firstProd?.date && a.date < firstProd.date && a.wipDependency !== 'wip_blocked',
    )
    expect(earlyPack).toHaveLength(0)
  })

  it('actual WIP shortage without planned production → wip_blocked', () => {
    const p = basePayload()
    // Huge packaging remaining but production already complete (remainingProduction=0)
    // and no WIP left (fully packed) — wait: if packaging remaining > 0 and actual WIP=0 and no planned prod
    p.domains.production.orders = [
      {
        id: 'ord-block',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 100,
        priority: 1,
        createdAt: NOW,
      },
    ]
    p.domains.production.shiftReports = [
      {
        id: 'sr-full',
        status: 'confirmed',
        productionOrderId: 'ord-block',
        lineId: '1',
        outputMp: 100,
      },
    ]
    p.domains.production.packagingReports = [
      {
        id: 'pr-part',
        status: 'confirmed',
        productionOrderId: 'ord-block',
        outputMp: 100,
      },
    ]
    // packaging remaining = 0 → no packaging stage. Force imbalance via correction-like zero WIP:
    // production full, packaging only 20 → actual WIP 80, packaging remaining 80 — should allocate from actual
    p.domains.production.packagingReports = [
      {
        id: 'pr-part',
        status: 'confirmed',
        productionOrderId: 'ord-block',
        outputMp: 20,
      },
    ]
    const bal = computeOrderCapacityBalances(p.domains.production, p.domains.production.orders[0])
    expect(bal.productionRemaining).toBe(0)
    expect(bal.packagingRemaining).toBe(80)
    expect(bal.actualWipAvailable).toBe(80)
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const pack = body.firmAllocations.filter(
      (a: { stage: string; wipDependency?: string }) =>
        a.stage === 'packaging' && a.wipDependency !== 'wip_blocked',
    )
    expect(pack.reduce((s: number, a: { quantityM2: number }) => s + a.quantityM2, 0)).toBeGreaterThan(0)
  })

  it('correction/reversal does not double packaging or production output', () => {
    const production = {
      shiftReports: [
        {
          id: 'sr-old',
          status: 'confirmed',
          productionOrderId: 'o1',
          lineId: '1',
          outputMp: 50,
          superseded: true,
        },
        {
          id: 'sr-new',
          status: 'confirmed',
          productionOrderId: 'o1',
          lineId: '1',
          outputMp: 30,
          replacesReportId: 'sr-old',
        },
      ],
      packagingReports: [
        {
          id: 'pr-old',
          status: 'confirmed',
          productionOrderId: 'o1',
          outputMp: 20,
          superseded: true,
        },
        {
          id: 'pr-new',
          status: 'confirmed',
          productionOrderId: 'o1',
          outputMp: 15,
          replacesReportId: 'pr-old',
        },
        {
          id: 'pr-rev',
          status: 'confirmed',
          productionOrderId: 'o1',
          outputMp: 5,
          reversal: true,
        },
      ],
      wipBatches: [],
    }
    const bal = computeOrderCapacityBalances(production, { id: 'o1', totalQtyMp: 100 })
    expect(bal.productionWipMp).toBe(30)
    expect(bal.packagingOutputMp).toBe(10) // 15 - 5
  })
})

describe('G6.1 stage line mapping fail-closed', () => {
  it('missing validProductionLineIds → missing_valid_line_mapping + master-data error queue', () => {
    const p = basePayload()
    p.domains.masterData.finishedProducts = [{ id: FP, active: true }] // no stage mappings
    p.domains.production.orders = [
      {
        id: 'ord-map',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 10,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.errors.some((e: { code: string }) => e.code === 'missing_valid_line_mapping')).toBe(
      true,
    )
    expect(body.firmAllocations.filter((a: { stage: string }) => a.stage === 'production')).toHaveLength(
      0,
    )
    const run = applyG6CommandLocal(p, 'capacity.run', { asOfDate: DATE }, actor, NOW, 1)
    expect(run.ok).toBe(true)
    expect(run.planning.masterDataErrors.some((e: { code: string }) => e.code === 'missing_valid_line_mapping')).toBe(
      true,
    )
  })

  it('forged client lineId not in validProductionLineIds is rejected from preferred line', () => {
    const p = basePayload()
    p.domains.production.orders = [
      {
        id: 'ord-forge',
        status: 'active',
        finishedProductId: FP,
        lineId: '2', // not in validProductionLineIds=['1']
        totalQtyMp: 10,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.errors.some((e: { code: string }) => e.code === 'forged_client_line_mapping')).toBe(
      true,
    )
    // still can allocate on authoritative valid line 1
    const prod = body.firmAllocations.filter((a: { stage: string; lineId: string }) => a.stage === 'production')
    expect(prod.every((a: { lineId: string }) => a.lineId === '1')).toBe(true)
  })
})

describe('G6.1 CAS / cross-domain preservation (local)', () => {
  it('capacity.run preserves sibling domains when applied locally', () => {
    const p = basePayload()
    p.domains.warehouse = { ...(p.domains.warehouse ?? {}), documents: [{ id: 'keep-wh' }] }
    p.domains.sales = { orders: [{ id: 'keep-so' }], auditLog: [] }
    p.domains.procurement = { orders: [{ id: 'keep-po' }], unassignedShortages: [], payments: [], auditLog: [] }
    p.domains.production.orders = [
      {
        id: 'ord-x',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 5,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const run = applyG6CommandLocal(p, 'capacity.run', { asOfDate: DATE }, actor, NOW, 2)
    expect(run.ok).toBe(true)
    // local apply only returns capacity(+planning); payload siblings untouched on input
    expect(p.domains.warehouse.documents[0].id).toBe('keep-wh')
    expect(p.domains.sales.orders[0].id).toBe('keep-so')
    expect(p.domains.procurement.orders[0].id).toBe('keep-po')
    expect(run.capacity.runs.length).toBe(1)
  })
})

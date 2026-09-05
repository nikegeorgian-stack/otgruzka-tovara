/**
 * PHASE G6.2 — ISO weekday semantics, monthly buckets (no ym-28), stage line mapping.
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
  expandShiftsForDate,
  jsWeekdayToIso,
  monthPeriodBounds,
  previewLegacyProductLineMapping,
  tbilisiWeekdayIso,
  WEEKDAY_CONVENTION_ISO,
} from '../server/fst/_g6CapacityService.mjs'

const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const NOW = '2026-09-04T12:00:00.000Z'
const DATE = '2026-09-04'
const FP = 'fp-g62'

function isoTemplates(lineId: string, stage: string, weekdays: number[] = [1, 2, 3, 4, 5]) {
  return weekdays.map((wd) => ({
    id: `ctpl-${lineId}-${stage}-${wd}`,
    lineId,
    weekday: wd,
    weekdayConvention: WEEKDAY_CONVENTION_ISO,
    shiftId: 'day',
    stage,
    plannedMinutes: 480,
    capacityFactor: 1,
    effectiveFrom: '2020-01-01',
    effectiveTo: '2030-12-31',
  }))
}

function basePayload() {
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
        contentHash: 'g62:n1',
        effectiveFrom: '2020-01-01',
      },
      {
        normId: 'np',
        finishedProductId: FP,
        lineId: 'pack',
        stage: 'packaging',
        version: 1,
        status: 'approved',
        capacityM2PerShift: 80,
        contentHash: 'g62:np',
        effectiveFrom: '2020-01-01',
      },
    ],
    calendars: [],
    calendarTemplates: [
      ...isoTemplates('1', 'production'),
      ...isoTemplates('pack', 'packaging'),
    ],
    downtimes: [],
    runs: [],
    schedules: [],
    auditLog: [],
  }
  return p
}

describe('G6.2 ISO weekday', () => {
  it('ISO Monday=1 and Sunday=7 for Tbilisi civil dates', () => {
    // 2026-09-07 = Monday, 2026-09-13 = Sunday
    expect(tbilisiWeekdayIso('2026-09-07')).toBe(1)
    expect(tbilisiWeekdayIso('2026-09-13')).toBe(7)
  })

  it('weekday=0 rejected on calendarTemplate.upsert', () => {
    const p = basePayload()
    const r = applyG6CommandLocal(
      p,
      'capacity.calendarTemplate.upsert',
      {
        templateId: 'bad-0',
        lineId: '1',
        stage: 'production',
        weekday: 0,
        weekdayConvention: WEEKDAY_CONVENTION_ISO,
      },
      actor,
      NOW,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_weekday')
  })

  it('JS Sunday 0 preview → ISO 7; apply migrates with reason', () => {
    expect(jsWeekdayToIso(0)).toBe(7)
    expect(jsWeekdayToIso(1)).toBe(1)
    const p = basePayload()
    p.domains.capacity.calendarTemplates = [
      {
        id: 'legacy-sun',
        lineId: '1',
        weekday: 0,
        weekdayConvention: 'JS_SUNDAY_0',
        shiftId: 'day',
        stage: 'production',
        plannedMinutes: 480,
        capacityFactor: 1,
      },
    ]
    const scan = applyG6CommandLocal(p, 'capacity.legacy.scan', {}, actor, NOW)
    expect(scan.ok).toBe(true)
    const mig = scan.result.weekdayMigrations.find(
      (m: { templateId: string }) => m.templateId === 'legacy-sun',
    )
    expect(mig.previewIsoWeekday).toBe(7)
    expect(mig.previewConvention).toBe(WEEKDAY_CONVENTION_ISO)

    const apply = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'migrate JS Sunday to ISO',
        items: [
          {
            kind: 'weekday_migrate',
            templateId: 'legacy-sun',
            legacyWeekday: 0,
            previewIsoWeekday: 7,
          },
        ],
      },
      actor,
      NOW,
    )
    expect(apply.ok).toBe(true)
    const t = apply.capacity.calendarTemplates.find((x: { id: string }) => x.id === 'legacy-sun')
    expect(t.weekday).toBe(7)
    expect(t.weekdayConvention).toBe(WEEKDAY_CONVENTION_ISO)

    // idempotent second apply
    p.domains.capacity = apply.capacity
    const again = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'idempotent',
        items: [
          {
            kind: 'weekday_migrate',
            templateId: 'legacy-sun',
            legacyWeekday: 0,
            previewIsoWeekday: 7,
          },
        ],
      },
      actor,
      NOW,
    )
    expect(again.ok).toBe(true)
    expect(again.capacity.calendarTemplates.find((x: { id: string }) => x.id === 'legacy-sun').weekday).toBe(7)
  })

  it('mixed ISO + JS conventions flagged; JS templates do not expand authoritatively', () => {
    const p = basePayload()
    p.domains.capacity.calendarTemplates = [
      ...isoTemplates('1', 'production', [1]),
      {
        id: 'js-mon',
        lineId: '1',
        weekday: 1,
        weekdayConvention: 'JS_SUNDAY_0',
        shiftId: 'night',
        stage: 'production',
        plannedMinutes: 480,
        capacityFactor: 1,
        effectiveFrom: '2020-01-01',
        effectiveTo: '2030-12-31',
      },
    ]
    const scan = applyG6CommandLocal(p, 'capacity.legacy.scan', {}, actor, NOW)
    expect(scan.result.errorQueue.some((e: { code: string }) => e.code === 'mixed_weekday_convention')).toBe(
      true,
    )
    // Monday 2026-09-07: ISO template matches; JS weekday=1 is also Mon but convention blocks it
    const shifts = expandShiftsForDate(
      '1',
      'production',
      '2026-09-07',
      [],
      p.domains.capacity.calendarTemplates,
    )
    expect(shifts.every((s: { shiftId: string }) => s.shiftId !== 'night')).toBe(true)
  })

  it('JS_SUNDAY_0 convention rejected on authoritative upsert', () => {
    const p = basePayload()
    const r = applyG6CommandLocal(
      p,
      'capacity.calendarTemplate.upsert',
      {
        templateId: 'bad-conv',
        lineId: '1',
        weekday: 1,
        weekdayConvention: 'JS_SUNDAY_0',
      },
      actor,
      NOW,
    )
    expect(r.ok).toBe(false)
    expect(r.error).toBe('weekday_convention_must_be_ISO_8601')
  })
})

describe('G6.2 monthly buckets (no ym-28)', () => {
  it('February non-leap has 28 days; leap has 29', () => {
    const a = monthPeriodBounds('2026-02')
    const b = monthPeriodBounds('2024-02')
    expect(a.dayCount).toBe(28)
    expect(a.periodEnd).toBe('2026-02-28')
    expect(b.dayCount).toBe(29)
    expect(b.periodEnd).toBe('2024-02-29')
  })

  it('months with 30 and 31 days have correct periodEnd', () => {
    expect(monthPeriodBounds('2026-04').periodEnd).toBe('2026-04-30')
    expect(monthPeriodBounds('2026-05').periodEnd).toBe('2026-05-31')
  })

  it('December→January year boundary is deterministic', () => {
    const norms = basePayload().domains.capacity.norms
    const templates = isoTemplates('1', 'production')
    const dec = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2026-12',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates,
      downtimes: [],
    })
    const jan = computeMonthCapacityM2({
      lineId: '1',
      stage: 'production',
      ym: '2027-01',
      finishedProductId: FP,
      norms,
      calendars: [],
      templates,
      downtimes: [],
    })
    expect(dec.bucketKey).toBe('2026-12')
    expect(jan.bucketKey).toBe('2027-01')
    expect(dec.periodStart).toBe('2026-12-01')
    expect(jan.periodStart).toBe('2027-01-01')
    expect(dec.unknown).toBe(false)
    expect(jan.unknown).toBe(false)
  })

  it('authoritative result has no ym-28 surrogate dates', () => {
    const p = basePayload()
    p.domains.production.orders = [
      {
        id: 'ord-big',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 80000,
        priority: 1,
        dueDate: '2026-09-10',
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const blob = JSON.stringify(body)
    expect(blob.includes('ym-28')).toBe(false)
    for (const a of [...body.firmAllocations, ...body.tentativeAllocations]) {
      if (a.aggregated) {
        expect(a.bucketKey).toMatch(/^\d{4}-\d{2}$/)
        expect(a.periodStart).toMatch(/^\d{4}-\d{2}-01$/)
        expect(a.periodEnd).toBeTruthy()
        expect(a.date).toBeUndefined()
        // no surrogate civil day inside the month
        expect(String(a.allocationId)).not.toMatch(/-\d{4}-\d{2}-28$/)
      }
    }
    for (const b of body.monthlyBuckets) {
      expect(b.bucketKey).toBeTruthy()
      expect(b.periodStart).toBeTruthy()
      expect(b.periodEnd).toBeTruthy()
      expect(b).toHaveProperty('availableShiftCount')
      expect(b).toHaveProperty('availableMinutes')
      expect(b).toHaveProperty('capacityM2')
      expect(b).toHaveProperty('allocatedM2')
      expect(b).toHaveProperty('remainingM2')
      expect(b).toHaveProperty('overloadM2')
    }
  })

  it('dueDate ordering inside monthly bucket marks late only before periodStart', () => {
    const p = basePayload()
    p.domains.production.orders = [
      {
        id: 'ord-late',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 80000,
        priority: 1,
        dueDate: '2026-09-01',
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const lateAgg = body.lateOrders.filter((l: { bucketKey?: string }) => l.bucketKey)
    expect(lateAgg.length).toBeGreaterThan(0)
    for (const l of lateAgg) {
      expect(l.dueOrStart < l.periodStart).toBe(true)
    }
  })

  it('packaging dependency across monthly buckets uses bucket order', () => {
    const p = basePayload()
    // Huge production+packaging remaining forces both into aggregated months
    p.domains.production.orders = [
      {
        id: 'ord-wip-bucket',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 90000,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    const prodMonths = body.firmAllocations
      .filter((a: { stage: string; aggregated?: boolean }) => a.stage === 'production' && a.aggregated)
      .map((a: { bucketKey: string }) => a.bucketKey)
      .sort()
    const packMonths = body.firmAllocations
      .filter((a: { stage: string; aggregated?: boolean }) => a.stage === 'packaging' && a.aggregated)
      .map((a: { bucketKey: string }) => a.bucketKey)
      .sort()
    expect(prodMonths.length).toBeGreaterThan(0)
    // packaging bucket keys never precede earliest production bucket
    if (packMonths.length) {
      expect(packMonths[0] >= prodMonths[0]).toBe(true)
    }
    const packWip = body.firmAllocations.filter(
      (a: { stage: string; wipDependency?: string }) =>
        a.stage === 'packaging' && a.wipDependency === 'wip_planned',
    )
    expect(packWip.length).toBeGreaterThan(0)
  })
})

describe('G6.2 stage line mapping', () => {
  it('missing production or packaging mapping fail-closed; validLineIds alone not authoritative', () => {
    const p = basePayload()
    p.domains.masterData.finishedProducts = [
      { id: FP, active: true, validLineIds: ['1', 'pack'] },
    ]
    p.domains.production.orders = [
      {
        id: 'ord-legacy-only',
        status: 'active',
        finishedProductId: FP,
        totalQtyMp: 10,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(body.errors.filter((e: { code: string }) => e.code === 'missing_valid_line_mapping').length).toBeGreaterThan(
      0,
    )
    expect(body.firmAllocations.length).toBe(0)

    const preview = previewLegacyProductLineMapping(p.domains.masterData.finishedProducts[0])
    expect(preview.validProductionLineIds).toEqual(['1'])
    expect(preview.validPackagingLineIds).toEqual(['pack'])
  })

  it('forged stage/line mapping rejected; pack not auto-assigned from production ids', () => {
    const p = basePayload()
    p.domains.masterData.finishedProducts = [
      {
        id: FP,
        active: true,
        validProductionLineIds: ['1'],
        // missing packaging on purpose
      },
    ]
    p.domains.production.orders = [
      {
        id: 'ord-no-pack-map',
        status: 'active',
        finishedProductId: FP,
        lineId: '1',
        totalQtyMp: 50,
        priority: 1,
        createdAt: NOW,
      },
    ]
    const body = allocateHorizon(p, p.domains.capacity, DATE, NOW)
    expect(
      body.errors.some(
        (e: { code: string; stage?: string }) =>
          e.code === 'missing_valid_line_mapping' && e.stage === 'packaging',
      ),
    ).toBe(true)
    expect(body.firmAllocations.some((a: { stage: string }) => a.stage === 'packaging')).toBe(false)
  })

  it('migration preview/apply for product line mapping is idempotent', () => {
    const p = basePayload()
    p.domains.masterData.finishedProducts = [
      { id: FP, active: true, validLineIds: ['1', '2', 'pack'] },
    ]
    const scan = applyG6CommandLocal(p, 'capacity.legacy.scan', {}, actor, NOW)
    const item = scan.result.productLineMigrations.find(
      (m: { finishedProductId: string }) => m.finishedProductId === FP,
    )
    expect(item.validProductionLineIds).toEqual(['1', '2'])
    expect(item.validPackagingLineIds).toEqual(['pack'])

    const apply1 = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'split legacy validLineIds',
        items: [
          {
            kind: 'product_line_mapping',
            finishedProductId: FP,
            validProductionLineIds: item.validProductionLineIds,
            validPackagingLineIds: item.validPackagingLineIds,
          },
        ],
      },
      actor,
      NOW,
    )
    expect(apply1.ok).toBe(true)
    expect(apply1.masterData.finishedProducts[0].validProductionLineIds).toEqual(['1', '2'])
    expect(apply1.masterData.finishedProducts[0].validPackagingLineIds).toEqual(['pack'])

    p.domains.masterData = apply1.masterData
    p.domains.capacity = apply1.capacity
    const apply2 = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'idempotent remap',
        items: [
          {
            kind: 'product_line_mapping',
            finishedProductId: FP,
            validProductionLineIds: ['1', '2'],
            validPackagingLineIds: ['pack'],
          },
        ],
      },
      actor,
      NOW,
    )
    expect(apply2.ok).toBe(true)
    expect(apply2.masterData.finishedProducts[0].validProductionLineIds).toEqual(['1', '2'])
  })
})

describe('G6.2 CAS / cross-domain preservation', () => {
  it('capacity.run preserves siblings; legacy.apply can update masterData without wiping capacity', () => {
    const p = basePayload()
    p.domains.warehouse = { documents: [{ id: 'keep-wh' }] }
    p.domains.sales = { orders: [{ id: 'keep-so' }] }
    p.domains.masterData.finishedProducts = [
      { id: FP, active: true, validLineIds: ['1', 'pack'] },
    ]
    const apply = applyG6CommandLocal(
      p,
      'capacity.legacy.apply',
      {
        reason: 'map lines',
        items: [
          {
            kind: 'product_line_mapping',
            finishedProductId: FP,
            validProductionLineIds: ['1'],
            validPackagingLineIds: ['pack'],
          },
        ],
      },
      actor,
      NOW,
    )
    expect(apply.ok).toBe(true)
    expect(p.domains.warehouse.documents[0].id).toBe('keep-wh')
    expect(p.domains.sales.orders[0].id).toBe('keep-so')
    expect(apply.capacity.norms.length).toBe(2)
    p.domains.masterData = apply.masterData
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
    const run = applyG6CommandLocal(p, 'capacity.run', { asOfDate: DATE }, actor, NOW, 3)
    expect(run.ok).toBe(true)
    expect(run.capacity.runs.length).toBe(1)
  })
})

/** R3.1C — an m² WIP item needs an exact G2 placement and authoritative ACK. */
import { describe, expect, it } from 'vitest'
import { applyItemUpsert } from '../server/fst/_g5SalesProcurementService.mjs'
import { validateG5MasterdataItemUpsertAck } from '@/lib/planner/g5ServerClient'

const ACTOR = { uid: 'warehouse-1', email: 'warehouse@example.test' }
const NOW = '2026-09-10T12:00:00.000Z'

function masterData() {
  return {
    items: [],
    finishedProducts: [],
    suppliers: [],
    customers: [],
    packagingBoms: [],
    auditLog: [],
  }
}

function warehouse() {
  return {
    categories: [{ id: 'category-wip', name: 'WIP', active: true }],
    locations: [{ id: 'warehouse-wip', name: 'WIP warehouse', active: true }],
  }
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-wip',
    code: 'WIP-000001',
    name: 'Celloplex 160 line WIP',
    baseUnit: 'm2',
    categoryId: 'category-wip',
    warehouseId: 'warehouse-wip',
    active: true,
    ...overrides,
  }
}

function expectZeroWrite(
  cmd: Record<string, unknown>,
  wh: Record<string, unknown>,
  error: string,
) {
  const source = masterData()
  const before = JSON.stringify(source)
  const result = applyItemUpsert(source, cmd, ACTOR, NOW, {
    strict: true,
    warehouse: wh,
  })
  expect(result).toMatchObject({ ok: false, error })
  expect(JSON.stringify(source)).toBe(before)
}

describe('R3.1C WIP master-data item authority', () => {
  it('creates a distinct active m² item only at an exact active category/location', () => {
    const result = applyItemUpsert(masterData(), command(), ACTOR, NOW, {
      strict: true,
      warehouse: warehouse(),
    })

    expect(result).toMatchObject({
      ok: true,
      result: {
        id: 'item-wip',
        code: 'WIP-000001',
        item: {
          id: 'item-wip',
          code: 'WIP-000001',
          name: 'Celloplex 160 line WIP',
          baseUnit: 'm2',
          categoryId: 'category-wip',
          warehouseId: 'warehouse-wip',
          active: true,
        },
      },
    })
  })

  it('rejects absent, unknown, inactive or ambiguous placement with zero mutation', () => {
    expectZeroWrite(
      command({ categoryId: undefined }),
      warehouse(),
      'masterdata_item_category_required',
    )
    expectZeroWrite(
      command({ warehouseId: 'missing' }),
      warehouse(),
      'masterdata_item_warehouse_unavailable',
    )
    expectZeroWrite(
      command(),
      {
        ...warehouse(),
        categories: [{ id: 'category-wip', active: false }],
      },
      'masterdata_item_category_unavailable',
    )
    expectZeroWrite(
      command(),
      {
        ...warehouse(),
        locations: [
          { id: 'warehouse-wip', active: true },
          { id: 'warehouse-wip', active: true },
        ],
      },
      'masterdata_item_warehouse_ambiguous',
    )
    expectZeroWrite(
      command({ active: false }),
      warehouse(),
      'masterdata_item_active_required',
    )
  })

  it('requires a monotonic revision and one exact active returned item before mirror', () => {
    const item = command()
    const ack = {
      id: item.id as string,
      code: item.code as string,
      item,
      criticalRevision: 8,
      masterData: { items: [item] },
    }
    const expected = {
      id: item.id as string,
      code: item.code as string,
      name: item.name as string,
      baseUnit: item.baseUnit as string,
      categoryId: item.categoryId as string,
      warehouseId: item.warehouseId as string,
    }

    expect(validateG5MasterdataItemUpsertAck(ack, 7, expected)).toEqual({
      ok: true,
      criticalRevision: 8,
    })
    expect(
      validateG5MasterdataItemUpsertAck({ ...ack, criticalRevision: 7 }, 7, expected),
    ).toMatchObject({ ok: false, error: 'masterdata_item_ack_mismatch' })
    expect(
      validateG5MasterdataItemUpsertAck(
        { ...ack, masterData: { items: [item, { ...item }] } },
        7,
        expected,
      ),
    ).toMatchObject({ ok: false, error: 'masterdata_item_ack_mismatch' })
    expect(
      validateG5MasterdataItemUpsertAck(
        { ...ack, item: { ...item, warehouseId: 'stale-warehouse' } },
        7,
        expected,
      ),
    ).toMatchObject({ ok: false, error: 'masterdata_item_ack_mismatch' })
    expect(
      validateG5MasterdataItemUpsertAck(
        { ...ack, masterData: { items: [{ ...item, active: false }] } },
        7,
        expected,
      ),
    ).toMatchObject({ ok: false, error: 'masterdata_item_ack_mismatch' })
  })

  it('accepts exactly one canonical server-assigned code when the UI requests autocode', () => {
    const generated = command({ code: 'FC-000001' })
    const ack = {
      id: generated.id as string,
      code: generated.code as string,
      item: generated,
      criticalRevision: 8,
      masterData: { items: [generated] },
    }
    const expected = {
      id: generated.id as string,
      code: '',
      name: generated.name as string,
      baseUnit: generated.baseUnit as string,
      categoryId: generated.categoryId as string,
      warehouseId: generated.warehouseId as string,
    }

    expect(validateG5MasterdataItemUpsertAck(ack, 7, expected)).toEqual({
      ok: true,
      criticalRevision: 8,
    })
  })

  it('rejects forged, empty or inconsistent server autocode acknowledgements', () => {
    const generated = command({ code: 'FC-000001' })
    const ack = {
      id: generated.id as string,
      code: generated.code as string,
      item: generated,
      criticalRevision: 8,
      masterData: { items: [generated] },
    }
    const expected = {
      id: generated.id as string,
      code: '',
      name: generated.name as string,
      baseUnit: generated.baseUnit as string,
      categoryId: generated.categoryId as string,
      warehouseId: generated.warehouseId as string,
    }
    const rejected = (candidate: typeof ack) =>
      expect(validateG5MasterdataItemUpsertAck(candidate, 7, expected)).toMatchObject({
        ok: false,
        error: 'masterdata_item_ack_mismatch',
      })

    rejected({
      ...ack,
      code: '',
      item: { ...generated, code: '' },
      masterData: { items: [{ ...generated, code: '' }] },
    })
    rejected({
      ...ack,
      code: 'WIP-000001',
      item: { ...generated, code: 'WIP-000001' },
      masterData: { items: [{ ...generated, code: 'WIP-000001' }] },
    })
    rejected({ ...ack, item: { ...generated, code: 'FC-000002' } })
    rejected({
      ...ack,
      masterData: { items: [{ ...generated, code: 'FC-000002' }] },
    })
  })
})

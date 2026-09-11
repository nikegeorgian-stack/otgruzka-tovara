import { describe, expect, it } from 'vitest'
import {
  LINE_BINDING_ACCOUNTING_DUPLICATE,
  LINE_BINDING_ACCOUNTING_INACTIVE,
  LINE_BINDING_ACCOUNTING_MISSING,
  LINE_BINDING_DUPLICATE,
  LINE_BINDING_LOCATION_DUPLICATE,
  LINE_BINDING_LOCATION_MISSING,
  LINE_BINDING_LOCATION_REQUIRED,
  LINE_BINDING_NOT_CONFIGURED,
  LINE_BINDING_WAREHOUSE_DUPLICATE,
  LINE_BINDING_WAREHOUSE_MISSING,
  LINE_BINDING_WAREHOUSE_REQUIRED,
  LINE_ID_REQUIRED,
  LINE_READINESS_EPSILON,
  SCRAP_ACCOUNTING_DUPLICATE,
  SCRAP_ACCOUNTING_INACTIVE,
  SCRAP_ACCOUNTING_MISSING,
  SCRAP_LINE_ROUTE_REQUIRED,
  SCRAP_LOCATION_DUPLICATE,
  SCRAP_LOCATION_EQUALS_LINE,
  SCRAP_LOCATION_MISSING,
  SCRAP_LOCATION_REQUIRED,
  SCRAP_WASTE_QUANTITY_INVALID,
  resolveProductionLineBinding,
  resolveScrapReadiness,
} from '../src/lib/production/lineReadinessCore.mjs'

const lineWarehouse = { id: 'wh-line', name: 'Line warehouse' }
const lineLocation = { id: 'loc-line', name: 'Line location' }
const scrapLocation = { id: 'loc-scrap', name: 'Scrap location' }

function lineInput(overrides: Record<string, unknown> = {}) {
  return {
    productionLineBindings: [
      {
        id: 'binding-line-1',
        lineId: '1',
        productionWarehouseId: lineWarehouse.id,
        productionLocationId: lineLocation.id,
      },
    ],
    locations: [lineWarehouse, lineLocation, scrapLocation],
    accountingByWarehouse: [
      { id: lineWarehouse.id, warehouseId: lineWarehouse.id, status: 'active' },
    ],
    ...overrides,
  }
}

function scrapInput(overrides: Record<string, unknown> = {}) {
  return {
    scrapLocationId: scrapLocation.id,
    locations: [lineWarehouse, lineLocation, scrapLocation],
    accountingByWarehouse: [
      { id: scrapLocation.id, warehouseId: scrapLocation.id, status: 'active' },
    ],
    productionWarehouseId: lineWarehouse.id,
    productionLocationId: lineLocation.id,
    wasteLines: [{ itemId: 'item-1', quantity: 0.25 }],
    ...overrides,
  }
}

describe('resolveProductionLineBinding', () => {
  it('returns the stable warehouse and location ids for exactly one canonical row', () => {
    expect(resolveProductionLineBinding(lineInput(), ' 1 ')).toEqual({
      ok: true,
      productionWarehouseId: lineWarehouse.id,
      productionLocationId: lineLocation.id,
    })
  })

  it('uses a legacy id match only when the row lineId is blank', () => {
    const legacy = lineInput({
      productionLineBindings: [
        {
          id: '1',
          lineId: ' ',
          productionWarehouseId: lineWarehouse.id,
          productionLocationId: lineLocation.id,
        },
      ],
    })
    expect(resolveProductionLineBinding(legacy, '1').ok).toBe(true)

    const unrelated = lineInput({
      productionLineBindings: [
        {
          id: '1',
          lineId: '2',
          productionWarehouseId: lineWarehouse.id,
          productionLocationId: lineLocation.id,
        },
      ],
    })
    expect(resolveProductionLineBinding(unrelated, '1')).toEqual({
      ok: false,
      error: LINE_BINDING_NOT_CONFIGURED,
    })
  })

  it('rejects a missing line id and ambiguous canonical/legacy rows', () => {
    expect(resolveProductionLineBinding(lineInput(), ' ')).toEqual({
      ok: false,
      error: LINE_ID_REQUIRED,
    })

    const first = lineInput().productionLineBindings[0]
    expect(
      resolveProductionLineBinding(
        lineInput({
          productionLineBindings: [
            first,
            {
              id: '1',
              lineId: '',
              productionWarehouseId: lineWarehouse.id,
              productionLocationId: lineLocation.id,
            },
          ],
        }),
        '1',
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_DUPLICATE })
  })

  it.each([
    [
      { productionWarehouseId: '', productionLocationId: lineLocation.id },
      LINE_BINDING_WAREHOUSE_REQUIRED,
    ],
    [
      { productionWarehouseId: lineWarehouse.id, productionLocationId: '' },
      LINE_BINDING_LOCATION_REQUIRED,
    ],
  ])('rejects an incomplete binding %#', (bindingPatch, error) => {
    const binding = {
      ...lineInput().productionLineBindings[0],
      ...bindingPatch,
    }
    expect(
      resolveProductionLineBinding(
        lineInput({ productionLineBindings: [binding] }),
        '1',
      ),
    ).toEqual({ ok: false, error })
  })

  it.each([
    [[lineLocation, scrapLocation], LINE_BINDING_WAREHOUSE_MISSING],
    [[lineWarehouse, scrapLocation], LINE_BINDING_LOCATION_MISSING],
    [
      [{ ...lineWarehouse, active: false }, lineLocation, scrapLocation],
      LINE_BINDING_WAREHOUSE_MISSING,
    ],
    [
      [lineWarehouse, { ...lineLocation, active: false }, scrapLocation],
      LINE_BINDING_LOCATION_MISSING,
    ],
    [
      [lineWarehouse, { ...lineWarehouse }, lineLocation, scrapLocation],
      LINE_BINDING_WAREHOUSE_DUPLICATE,
    ],
    [
      [lineWarehouse, lineLocation, { ...lineLocation }, scrapLocation],
      LINE_BINDING_LOCATION_DUPLICATE,
    ],
  ])('rejects missing or ambiguous referenced locations %#', (locations, error) => {
    expect(resolveProductionLineBinding(lineInput({ locations }), '1')).toEqual({
      ok: false,
      error,
    })
  })

  it('requires an existing accounting row to be unique and active', () => {
    expect(
      resolveProductionLineBinding(
        lineInput({
          accountingByWarehouse: [
            { warehouseId: lineWarehouse.id, status: 'reconciling' },
          ],
        }),
        '1',
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_ACCOUNTING_INACTIVE })

    expect(
      resolveProductionLineBinding(
        lineInput({
          accountingByWarehouse: [
            { warehouseId: lineWarehouse.id, status: 'active' },
            { warehouseId: lineWarehouse.id, status: 'active' },
          ],
        }),
        '1',
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_ACCOUNTING_DUPLICATE })

    expect(
      resolveProductionLineBinding(lineInput({ accountingByWarehouse: [] }), '1').ok,
    ).toBe(true)
    expect(
      resolveProductionLineBinding(
        lineInput({ accountingByWarehouse: [] }),
        '1',
        { requireActiveAccounting: true },
      ),
    ).toEqual({ ok: false, error: LINE_BINDING_ACCOUNTING_MISSING })
  })
})

describe('resolveScrapReadiness', () => {
  it('needs no scrap configuration when every valid quantity is epsilon-zero', () => {
    const wasteLines = Object.freeze([
      Object.freeze({ itemId: 'zero', quantity: 0 }),
      Object.freeze({ itemId: 'epsilon', quantity: LINE_READINESS_EPSILON }),
    ])
    const input = Object.freeze({ wasteLines })

    expect(resolveScrapReadiness(input)).toEqual({
      ok: true,
      wasteLines: [],
      scrapLocationId: undefined,
    })
    expect(wasteLines).toHaveLength(2)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01])(
    'rejects invalid quantity %s',
    (quantity) => {
      expect(
        resolveScrapReadiness(scrapInput({ wasteLines: [{ quantity }] })),
      ).toEqual({
        ok: false,
        error: SCRAP_WASTE_QUANTITY_INVALID,
      })
    },
  )

  it('filters epsilon-zero rows and preserves positive row identity without mutation', () => {
    const zero = Object.freeze({ itemId: 'zero', quantity: 0 })
    const positive = Object.freeze({ itemId: 'positive', quantity: 0.5 })
    const wasteLines = Object.freeze([zero, positive])
    const input = Object.freeze(scrapInput({ wasteLines }))

    const result = resolveScrapReadiness(input)
    expect(result).toEqual({
      ok: true,
      wasteLines: [positive],
      scrapLocationId: scrapLocation.id,
    })
    if (result.ok) expect(result.wasteLines[0]).toBe(positive)
    expect(wasteLines).toEqual([zero, positive])
  })

  it('requires the stable line route and scrap id only for positive waste', () => {
    expect(
      resolveScrapReadiness(scrapInput({ productionLocationId: '' })),
    ).toEqual({ ok: false, error: SCRAP_LINE_ROUTE_REQUIRED })
    expect(resolveScrapReadiness(scrapInput({ scrapLocationId: '' }))).toEqual({
      ok: false,
      error: SCRAP_LOCATION_REQUIRED,
    })
  })

  it.each([lineWarehouse.id, lineLocation.id])(
    'rejects scrap location %s because it is part of the line route',
    (scrapLocationId) => {
      expect(resolveScrapReadiness(scrapInput({ scrapLocationId }))).toEqual({
        ok: false,
        error: SCRAP_LOCATION_EQUALS_LINE,
      })
    },
  )

  it('rejects missing and duplicate scrap location ids', () => {
    expect(
      resolveScrapReadiness(scrapInput({ locations: [lineWarehouse, lineLocation] })),
    ).toEqual({ ok: false, error: SCRAP_LOCATION_MISSING })

    expect(
      resolveScrapReadiness(
        scrapInput({
          locations: [lineWarehouse, lineLocation, scrapLocation, { ...scrapLocation }],
        }),
      ),
    ).toEqual({ ok: false, error: SCRAP_LOCATION_DUPLICATE })
  })

  it('requires exactly one active accounting state for positive scrap', () => {
    expect(
      resolveScrapReadiness(scrapInput({ accountingByWarehouse: [] })),
    ).toEqual({ ok: false, error: SCRAP_ACCOUNTING_MISSING })

    expect(
      resolveScrapReadiness(
        scrapInput({
          accountingByWarehouse: [
            { warehouseId: scrapLocation.id, status: 'uninitialized' },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: SCRAP_ACCOUNTING_INACTIVE })

    expect(
      resolveScrapReadiness(
        scrapInput({
          accountingByWarehouse: [
            { warehouseId: scrapLocation.id, status: 'active' },
            { warehouseId: scrapLocation.id, status: 'active' },
          ],
        }),
      ),
    ).toEqual({ ok: false, error: SCRAP_ACCOUNTING_DUPLICATE })
  })
})

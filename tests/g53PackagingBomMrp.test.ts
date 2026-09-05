/**
 * PHASE G5.3 — authoritative versioned packaging BOM + MRP explosion.
 *
 * G4 compatibility note: packaging reports / recipeSnapshot should carry the same
 * approved packagingBomId + version (+ contentHash) when available so printed
 * packaging matches MRP packagingBomRefs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { G5_CAPS, defaultG5Capabilities } from '../server/fst/_g5Capabilities.mjs'
import { packagingRecipeToBomComponents } from '../src/lib/planner/g5PackagingBom'

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

vi.mock('../server/fst/_g1DataConnect.mjs', () => ({
  getG1DataConnect: vi.fn(() => ({ mocked: true })),
  getFstPrincipalAccessByUidStore: (...args: unknown[]) => calls.getPrincipal(...args),
  getFstCriticalStore: (...args: unknown[]) => calls.getCritical(...args),
  getFstCommandReceipt: (...args: unknown[]) => calls.getReceipt(...args),
  upsertFstCriticalStore: (...args: unknown[]) => calls.upsertCritical(...args),
  updateFstCriticalStoreCas: (...args: unknown[]) => calls.updateCas(...args),
  insertFstCommandReceipt: (...args: unknown[]) => calls.insertReceipt(...args),
  upsertFstPrincipalAccess: (...args: unknown[]) => calls.upsertPrincipal(...args),
}))

vi.mock('../server/fst/_adminAuth.mjs', () => ({
  FST_ADMIN_EMAILS: new Set(['admin@fibercell.net']),
  initFirebaseAdmin: vi.fn(),
}))

const STORE = 'fibercell-main'
const actor = { uid: 'u1', email: 'u1@x', claims: {} }
const ALL_CAPS = defaultG5Capabilities(
  Object.fromEntries(Object.values(G5_CAPS).map((k) => [k, true])),
)

const WH = 'wh-main'
const LINE_WH = 'wh-line-1'
const LOC = 'loc-1'
const FG_ID = 'fp-1'
const CUST_ID = 'cust-1'
const SUP_ID = 'sup-1'
const DATE = '2026-09-04'

const ITEM_PALLET = 'item-pallet'
const ITEM_BOX = 'item-box'
const ITEM_FILM = 'item-film'
const ITEM_CORE = 'item-core'
const ITEM_TAPE = 'item-tape'
const ITEM_LABEL = 'item-label'
const ITEM_CORNER = 'item-corner'

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
function payload(): any {
  return JSON.parse(String(dcState.critical!.payloadJson))
}

async function g5() {
  return import('../server/fst/_g5SalesProcurementService.mjs')
}

async function cmd(
  svc: { executeG5Command: (input: Record<string, unknown>) => Promise<Record<string, unknown>> },
  commandType: string,
  command: Record<string, unknown> = {},
  idempotencyKey = `${commandType}-${Math.random().toString(36).slice(2, 8)}`,
) {
  return svc.executeG5Command({
    actor,
    storeId: STORE,
    idempotencyKey,
    commandType,
    command,
  })
}

async function bootstrap(opts?: { withBom?: boolean }) {
  grant(ALL_CAPS)
  const svc = await g5()
  for (const [type, key] of [
    ['masterdata.domain.activate', 'md-act'],
    ['sales.domain.activate', 'sp-act'],
    ['procurement.domain.activate', 'pr-act'],
  ] as const) {
    expect((await cmd(svc, type, { reason: 'g53' }, key)).ok).toBe(true)
  }
  const h = await import('../server/fst/_g1CriticalHelpers.mjs')
  let p = payload()
  p = h.markWarehouseDomainActive(p, 'u1')
  p = h.markProductionDomainActive(p, 'u1')
  p.domains.warehouse.locations = [
    { id: LOC, warehouseId: WH },
    { id: 'loc-line', warehouseId: LINE_WH },
  ]
  p.domains.warehouse.productionLineBindings = [{ warehouseId: LINE_WH, lineId: '1' }]
  p.domains.warehouse.movements = []
  p.domains.warehouse.documents = []
  p.domains.production.orders = []
  dcState.critical!.payloadJson = h.serializeCriticalPayload(p)
  dcState.critical!.fingerprint = h.fingerprintCriticalPayload(dcState.critical!.payloadJson)

  for (const [id, code, name] of [
    [ITEM_PALLET, 'PAL-1', 'Pallet'],
    [ITEM_BOX, 'BOX-1', 'Box'],
    [ITEM_FILM, 'FILM-1', 'Film'],
    [ITEM_CORE, 'CORE-1', 'Core'],
    [ITEM_TAPE, 'TAPE-1', 'Tape'],
    [ITEM_LABEL, 'LBL-1', 'Label'],
    [ITEM_CORNER, 'CRN-1', 'Corner'],
  ] as const) {
    expect(
      (
        await cmd(
          svc,
          'masterdata.item.upsert',
          {
            id,
            code,
            name,
            baseUnit: 'pcs',
            moq: 1,
            defaultSupplierId: SUP_ID,
          },
          `md-item-${id}`,
        )
      ).ok,
    ).toBe(true)
  }

  expect(
    (
      await cmd(
        svc,
        'masterdata.product.upsert',
        { id: FG_ID, code: 'FP-1', name: 'Panel', packagingBomId: 'bom-v1' },
        'md-fp',
      )
    ).ok,
  ).toBe(true)
  expect(
    (await cmd(svc, 'masterdata.customer.upsert', { id: CUST_ID, code: 'C1', name: 'Acme' }, 'md-c'))
      .ok,
  ).toBe(true)
  expect(
    (
      await cmd(
        svc,
        'masterdata.supplier.upsert',
        {
          id: SUP_ID,
          code: 'S1',
          name: 'Sup',
          suppliedItemIds: [
            ITEM_PALLET,
            ITEM_BOX,
            ITEM_FILM,
            ITEM_CORE,
            ITEM_TAPE,
            ITEM_LABEL,
            ITEM_CORNER,
          ],
        },
        'md-s',
      )
    ).ok,
  ).toBe(true)

  if (opts?.withBom !== false) {
    await upsertAndApproveMultiBom(svc, 'bom-v1')
  }

  return svc
}

async function upsertAndApproveMultiBom(
  svc: Awaited<ReturnType<typeof g5>>,
  bomId: string,
  extra: Record<string, unknown> = {},
) {
  const components = [
    { itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' },
    { itemId: ITEM_BOX, quantity: 2, unit: 'pcs' },
    { itemId: ITEM_FILM, quantity: 3, unit: 'pcs', wasteFactor: 0.1 },
    { warehouseItemId: ITEM_CORE, quantity: 1, unit: 'pcs', conversionFactor: 2 },
    { itemId: ITEM_TAPE, quantity: 4, unit: 'pcs' },
    { itemId: ITEM_LABEL, quantity: 5, unit: 'pcs' },
    { itemId: ITEM_CORNER, quantity: 8, unit: 'pcs' },
  ]
  expect(
    (
      await cmd(
        svc,
        'masterdata.bom.upsert',
        {
          id: bomId,
          finishedProductId: FG_ID,
          baseOutputQty: 1,
          components,
          ...extra,
        },
        `bom-up-${bomId}-${Math.random().toString(36).slice(2, 6)}`,
      )
    ).ok,
  ).toBe(true)
  const ap = await cmd(
    svc,
    'masterdata.bom.approve',
    { id: bomId },
    `bom-ap-${bomId}-${Math.random().toString(36).slice(2, 6)}`,
  )
  expect(ap.ok).toBe(true)
  return ap
}

async function confirmSales(
  svc: Awaited<ReturnType<typeof g5>>,
  qty = 10,
  soId = 'so-1',
) {
  await cmd(
    svc,
    'sales.order.draft.save',
    {
      id: soId,
      customerId: CUST_ID,
      lines: [
        {
          lineId: 'sol-1',
          finishedProductId: FG_ID,
          quantity: qty,
          unit: 'm2',
          requestedShipDate: DATE,
        },
      ],
    },
    `so-d-${soId}`,
  )
  expect((await cmd(svc, 'sales.order.confirm', { id: soId }, `so-c-${soId}`)).ok).toBe(true)
}

describe('G5.3 packaging BOM versioning + MRP', () => {
  it('explodes multiple packaging components (pallet/box/film/cores/tape/labels/corners)', async () => {
    const svc = await bootstrap()
    await confirmSales(svc, 10)
    const run = await cmd(svc, 'planning.mrp.run', { asOfDate: DATE }, 'mrp-multi')
    expect(run.ok).toBe(true)

    const planningRun = payload().domains.planning.planningRuns.find(
      (r: { id: string }) => r.id === run.planningRunId,
    )
    const bomEvents = (planningRun?.demandEvents ?? []).filter(
      (e: { kind: string }) => e.kind === 'packaging_bom',
    )
    const byItem = Object.fromEntries(bomEvents.map((e: { itemId: string; qty: number }) => [e.itemId, e.qty]))

    // baseOutputQty=1, fgDemand=10
    expect(byItem[ITEM_PALLET]).toBe(10) // 1*10
    expect(byItem[ITEM_BOX]).toBe(20) // 2*10
    expect(byItem[ITEM_FILM]).toBe(33) // 3*10*(1+0.1)=33
    expect(byItem[ITEM_CORE]).toBe(20) // 1*10*2 conversion
    expect(byItem[ITEM_TAPE]).toBe(40)
    expect(byItem[ITEM_LABEL]).toBe(50)
    expect(byItem[ITEM_CORNER]).toBe(80)

    // pallet/box are normal components — present in shortage path, not special-cased
    expect(byItem[ITEM_PALLET]).toBeGreaterThan(0)
    expect(byItem[ITEM_BOX]).toBeGreaterThan(0)

    const refs = planningRun?.packagingBomRefs ?? []
    expect(refs.length).toBe(1)
    expect(refs[0].finishedProductId).toBe(FG_ID)
    expect(refs[0].packagingBomId).toBe('bom-v1')
    expect(refs[0].version).toBe(1)
    expect(refs[0].contentHash).toBeTruthy()

    const approved = payload().domains.masterData.packagingBoms.find(
      (b: { id: string }) => b.id === 'bom-v1',
    )
    expect(approved.status).toBe('approved')
    expect(refs[0].contentHash).toBe(approved.contentHash)
    expect(refs[0].version).toBe(approved.version)
  })

  it('selects approved BOM by effective date window; ignores draft', async () => {
    const svc = await bootstrap({ withBom: false })

    // Approved BOM effective only from 2026-10-01
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-future',
            finishedProductId: FG_ID,
            effectiveFrom: '2026-10-01',
            components: [{ itemId: ITEM_FILM, quantity: 1, unit: 'pcs' }],
          },
          'bom-fut',
        )
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'masterdata.bom.approve', { id: 'bom-future' }, 'bom-fut-ap')).ok).toBe(
      true,
    )

    // Draft BOM that would apply today — must be ignored
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-draft',
            finishedProductId: FG_ID,
            effectiveFrom: '2026-01-01',
            components: [{ itemId: ITEM_BOX, quantity: 99, unit: 'pcs' }],
          },
          'bom-dr',
        )
      ).ok,
    ).toBe(true)
    expect(payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-draft').status).toBe(
      'draft',
    )

    await confirmSales(svc, 5)
    const runToday = await cmd(svc, 'planning.mrp.run', { asOfDate: '2026-09-04' }, 'mrp-today')
    expect(runToday.ok).toBe(true)
    expect(runToday.masterDataErrorCount).toBeGreaterThan(0)
    const todayEvents = (
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === runToday.planningRunId)
        ?.demandEvents ?? []
    ).filter((e: { kind: string }) => e.kind === 'packaging_bom')
    expect(todayEvents.length).toBe(0)

    const runOct = await cmd(svc, 'planning.mrp.run', { asOfDate: '2026-10-05' }, 'mrp-oct')
    expect(runOct.ok).toBe(true)
    const octEvents = (
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === runOct.planningRunId)
        ?.demandEvents ?? []
    ).filter((e: { kind: string }) => e.kind === 'packaging_bom')
    expect(octEvents.some((e: { itemId: string }) => e.itemId === ITEM_FILM)).toBe(true)
    expect(octEvents.every((e: { itemId: string }) => e.itemId !== ITEM_BOX)).toBe(true)
  })

  it('approved BOM is immutable (upsert fails with bom_immutable)', async () => {
    const svc = await bootstrap()
    const again = await cmd(
      svc,
      'masterdata.bom.upsert',
      {
        id: 'bom-v1',
        finishedProductId: FG_ID,
        components: [{ itemId: ITEM_FILM, quantity: 99, unit: 'pcs' }],
      },
      'bom-mut',
    )
    expect(again.ok).toBe(false)
    expect(again.error).toBe('bom_immutable')
  })

  it('applies conversionFactor and wasteFactor in need formula', async () => {
    const svc = await bootstrap({ withBom: false })
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-cf',
            finishedProductId: FG_ID,
            baseOutputQty: 2,
            components: [
              { itemId: ITEM_FILM, quantity: 3, unit: 'pcs', conversionFactor: 1.5, wasteFactor: 0.2 },
            ],
          },
          'bom-cf-up',
        )
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'masterdata.bom.approve', { id: 'bom-cf' }, 'bom-cf-ap')).ok).toBe(true)

    await confirmSales(svc, 10)
    // need = 3 * (10/2) * 1.5 * (1+0.2) = 3 * 5 * 1.5 * 1.2 = 27
    const run = await cmd(svc, 'planning.mrp.run', { asOfDate: DATE }, 'mrp-cf')
    expect(run.ok).toBe(true)
    const ev = (
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === run.planningRunId)
        ?.demandEvents ?? []
    ).find((e: { kind: string; itemId: string }) => e.kind === 'packaging_bom' && e.itemId === ITEM_FILM)
    expect(ev?.qty).toBe(27)
  })

  it('missing approved BOM / broken mapping → masterDataErrors and no PO draft for that path', async () => {
    const svc = await bootstrap({ withBom: false })
    await confirmSales(svc, 8, 'so-miss')

    const run = await cmd(svc, 'planning.mrp.run', { asOfDate: DATE }, 'mrp-miss')
    expect(run.ok).toBe(true)
    expect(run.failClosed).toBe(true)
    expect(run.masterDataErrorCount).toBeGreaterThan(0)

    const shortages = (payload().domains.planning.shortages ?? []).filter(
      (s: { status: string; planningRunId: string }) =>
        s.status === 'open' && s.planningRunId === run.planningRunId,
    )
    // No packaging component shortages without approved BOM
    expect(shortages.every((s: { itemId: string }) => !s.itemId.startsWith('item-'))).toBe(true)
    expect(shortages.length).toBe(0)

    const drafts = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: run.planningRunId },
      'po-miss',
    )
    expect(drafts.ok).toBe(true)
    expect((drafts.draftIds as string[] | undefined)?.length ?? 0).toBe(0)

    // Incomplete components: approved BOM with missing item → no shortages for that product
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-bad',
            finishedProductId: FG_ID,
            components: [
              { itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' },
              { itemId: 'item-does-not-exist', quantity: 1, unit: 'pcs' },
            ],
          },
          'bom-bad-up',
        )
      ).ok,
    ).toBe(false)
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-partial',
            finishedProductId: FG_ID,
            components: [{ itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' }],
          },
          'bom-partial-up',
        )
      ).ok,
    ).toBe(true)
    expect((await cmd(svc, 'masterdata.bom.approve', { id: 'bom-partial' }, 'bom-partial-ap')).ok).toBe(
      true,
    )

    // Corrupt component unit after approve via direct payload edit
    const h = await import('../server/fst/_g1CriticalHelpers.mjs')
    const p = payload()
    const bom = p.domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-partial')
    bom.components.push({ itemId: ITEM_BOX, quantity: 1, unit: '' })
    dcState.critical!.payloadJson = h.serializeCriticalPayload(p)

    await confirmSales(svc, 4, 'so-partial')
    const run2 = await cmd(svc, 'planning.mrp.run', { asOfDate: DATE }, 'mrp-partial')
    expect(run2.masterDataErrorCount).toBeGreaterThan(0)
    const packEv = (
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === run2.planningRunId)
        ?.demandEvents ?? []
    ).filter((e: { kind: string; salesOrderId?: string }) => e.kind === 'packaging_bom' && e.salesOrderId === 'so-partial')
    expect(packEv.length).toBe(0)
  })

  it('marks planning run stale when BOM version/contentHash changes', async () => {
    const svc = await bootstrap()
    await confirmSales(svc, 6)
    const run = await cmd(svc, 'planning.mrp.run', { asOfDate: DATE }, 'mrp-stale-1')
    expect(run.ok).toBe(true)
    const runId = run.planningRunId as string
    expect(
      payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === runId)?.stale,
    ).toBe(false)

    // New version draft → approve (retires prior, bumps version)
    expect(
      (
        await cmd(
          svc,
          'masterdata.bom.upsert',
          {
            id: 'bom-v2',
            finishedProductId: FG_ID,
            components: [
              { itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' },
              { itemId: ITEM_FILM, quantity: 10, unit: 'pcs' },
            ],
          },
          'bom-v2-up',
        )
      ).ok,
    ).toBe(true)
    const ap = await cmd(svc, 'masterdata.bom.approve', { id: 'bom-v2' }, 'bom-v2-ap')
    expect(ap.ok).toBe(true)
    expect(ap.version).toBe(2)

    const staleRun = payload().domains.planning.planningRuns.find((r: { id: string }) => r.id === runId)
    expect(staleRun.stale).toBe(true)
    expect(staleRun.staleReason).toBe('packaging_bom_changed')

    const gen = await cmd(
      svc,
      'procurement.generateDraftsFromMrp',
      { planningRunId: runId },
      'po-stale',
    )
    expect(gen.ok).toBe(false)
    expect(gen.error).toBe('planning_run_stale')
  })

  it('maps recipe stack into components without pallet/box hardcode-only path', () => {
    const components = packagingRecipeToBomComponents({
      id: 'r1',
      code: 'RU-1',
      name: 'Stack',
      palletItemId: ITEM_PALLET,
      boxItemId: ITEM_BOX,
      stack: ['pallet', 'box', 'pallet'],
      rollsPerBox: 12,
      active: true,
      createdAt: DATE,
      updatedAt: DATE,
    })
    expect(components).toEqual([
      { itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' },
      { itemId: ITEM_BOX, quantity: 12, unit: 'pcs' },
      { itemId: ITEM_PALLET, quantity: 1, unit: 'pcs' },
    ])
  })

  it('archive/retire sets status retired', async () => {
    const svc = await bootstrap()
    const arch = await cmd(svc, 'masterdata.bom.archive', { id: 'bom-v1' }, 'bom-arch')
    expect(arch.ok).toBe(true)
    const bom = payload().domains.masterData.packagingBoms.find((b: { id: string }) => b.id === 'bom-v1')
    expect(bom.status).toBe('retired')
    expect(bom.archived).toBe(true)
  })
})

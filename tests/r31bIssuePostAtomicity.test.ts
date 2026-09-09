/**
 * R3.1B — warehouse production_issue post atomicity / draft status truth.
 * False-success: UI showed Проведён while critical stayed draft because
 * normalizeWarehouse coerced draft → posted on soft hydrate.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { normalizeWarehouse } from '@/lib/warehouse/init'
import { resolveAuthoritativeWarehouseOverlay } from '@/lib/warehouse/g1ServerClient'
import {
  postExistingWarehouseDocument,
  saveWarehouseDocumentDraft,
} from '@/lib/warehouse/documents'
import { computeItemBalance } from '@/lib/warehouse/stock'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import type { WarehouseStore, WarehouseDocument } from '@/lib/warehouse/types'

function baseWh(docs: WarehouseDocument[] = [], movements: WarehouseStore['movements'] = []): WarehouseStore {
  const n = normalizeWarehouse({
    locations: [{ id: 'w1', name: 'Основной', sortOrder: 0, kind: 'raw' }],
    categories: [{ id: 'c1', name: 'EDU', sortOrder: 0 }],
    items: [
      {
        id: 'mesh',
        internalCode: 'FC-MESH',
        name: 'EDU mesh',
        categoryId: 'c1',
        warehouseId: 'w1',
        unit: 'рул',
        active: true,
        sortOrder: 0,
      },
      {
        id: 'impreg',
        internalCode: 'FC-IMPREG',
        name: 'EDU impreg',
        categoryId: 'c1',
        warehouseId: 'w1',
        unit: 'кг',
        active: true,
        sortOrder: 1,
      },
    ],
    movements,
    documents: docs,
    auditLog: [],
  })
  return withActiveWarehouses(n, ['w1'])
}

function draftIssue(partial?: Partial<WarehouseDocument>): WarehouseDocument {
  return {
    id: '2c6bd04d-81b0-40e2-969e-d9abaaf06ba5',
    number: 'РС-1BC8F872-2026-007',
    type: 'issue',
    purpose: 'production_issue',
    warehouseId: 'w1',
    date: '2026-09-09',
    status: 'draft',
    lines: [
      { id: 'l1', itemId: 'mesh', quantity: 2, unit: 'рул' },
      { id: 'l2', itemId: 'impreg', quantity: 3.2, unit: 'кг' },
    ],
    createdAt: '2026-09-09T09:00:00.000Z',
    ...partial,
  } as WarehouseDocument
}

describe('R3.1B normalizeWarehouse preserves draft (РС-007 false-success root)', () => {
  it('keeps explicit draft status on soft hydrate', () => {
    const raw = {
      locations: [{ id: 'w1', name: 'Основной', sortOrder: 0, kind: 'raw' as const }],
      categories: [{ id: 'c1', name: 'EDU', sortOrder: 0 }],
      items: [
        {
          id: 'mesh',
          name: 'mesh',
          categoryId: 'c1',
          warehouseId: 'w1',
          unit: 'рул',
          active: true,
          sortOrder: 0,
        },
      ],
      movements: [],
      documents: [
        {
          id: 'rs-007',
          number: 'РС-1BC8F872-2026-007',
          type: 'issue' as const,
          purpose: 'production_issue' as const,
          warehouseId: 'w1',
          date: '2026-09-09',
          status: 'draft' as const,
          lines: [{ id: 'l1', itemId: 'mesh', quantity: 1, unit: 'рул' }],
          createdAt: '2026-09-09T09:00:00.000Z',
        },
      ],
      auditLog: [],
    }
    const n = normalizeWarehouse(raw)
    expect(n.documents[0]!.status).toBe('draft')
  })

  it('keeps cancelled; defaults missing status to posted for legacy rows', () => {
    const n = normalizeWarehouse({
      locations: [{ id: 'w1', name: 'Основной', sortOrder: 0, kind: 'raw' }],
      categories: [{ id: 'c1', name: 'EDU', sortOrder: 0 }],
      items: [
        {
          id: 'mesh',
          name: 'mesh',
          categoryId: 'c1',
          warehouseId: 'w1',
          unit: 'рул',
          active: true,
          sortOrder: 0,
        },
      ],
      movements: [],
      documents: [
        {
          id: 'a',
          number: 'A',
          type: 'receipt',
          warehouseId: 'w1',
          date: '2026-09-01',
          status: 'cancelled',
          lines: [{ id: 'l1', itemId: 'mesh', quantity: 1, unit: 'рул' }],
          createdAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'b',
          number: 'B',
          type: 'receipt',
          warehouseId: 'w1',
          date: '2026-09-02',
          // legacy: no status field
          lines: [{ id: 'l1', itemId: 'mesh', quantity: 1, unit: 'рул' }],
          createdAt: '2026-09-02T00:00:00.000Z',
        } as WarehouseDocument,
      ],
      auditLog: [],
    })
    expect(n.documents.find((d) => d.id === 'a')!.status).toBe('cancelled')
    expect(n.documents.find((d) => d.id === 'b')!.status).toBe('posted')
  })
})

describe('R3.1B critical draft overrides stale local posted', () => {
  it('overlay prefers critical draft over soft posted same id', () => {
    const localPosted = baseWh([
      {
        ...draftIssue(),
        status: 'posted',
        postedAt: '2026-09-09T10:00:00.000Z',
      },
    ])
    const criticalDraft = {
      ...localPosted,
      documents: [draftIssue()],
      movements: [],
    }
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: localPosted,
      criticalWarehouse: criticalDraft,
      criticalRevision: 32,
      warehouseActive: true,
    })
    expect(out.source).toBe('fst_critical_store')
    const doc = out.warehouse.documents.find((d) => d.id === draftIssue().id)
    expect(doc?.status).toBe('draft')
    expect(out.warehouse.movements).toHaveLength(0)
  })

  it('after soft coerce bug path, overlay still restores draft when critical says draft', () => {
    // Simulate pre-fix soft hydrate that coerced draft→posted, then overlay applies
    const coercedSoft = baseWh([{ ...draftIssue(), status: 'posted' }])
    expect(coercedSoft.documents[0]!.status).toBe('posted')
    const critical = { ...coercedSoft, documents: [draftIssue()], movements: [] }
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: coercedSoft,
      criticalWarehouse: critical,
      criticalRevision: 32,
      warehouseActive: true,
    })
    expect(out.warehouse.documents[0]!.status).toBe('draft')
  })
})

describe('R3.1B soft postExisting atomicity (desktop path)', () => {
  it('reject when already not draft — no extra movements', () => {
    let store = baseWh(
      [],
      [
        {
          id: 'm-open',
          type: 'receipt',
          itemId: 'mesh',
          warehouseId: 'w1',
          quantity: 10,
          date: '2026-09-08',
          createdAt: '2026-09-08T00:00:00.000Z',
        },
        {
          id: 'm-open2',
          type: 'receipt',
          itemId: 'impreg',
          warehouseId: 'w1',
          quantity: 100,
          date: '2026-09-08',
          createdAt: '2026-09-08T00:00:00.000Z',
        },
      ],
    )
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'issue',
      purpose: 'other',
      number: 'РС-R31B-TEST',
      warehouseId: 'w1',
      date: '2026-09-09',
      lines: [
        { itemId: 'mesh', quantity: 2, unit: 'рул' },
        { itemId: 'impreg', quantity: 3.2, unit: 'кг' },
      ],
    })
    expect(draft.result.ok).toBe(true)
    if (!draft.result.ok) return
    store = draft.store
    const id = draft.result.documentId
    const posted = postExistingWarehouseDocument(store, id, { actorId: 'u1' })
    if (!posted.result.ok) {
      expect.fail(`postExisting failed: ${posted.result.error} ${JSON.stringify(posted.result.fieldErrors)}`)
    }
    expect(posted.result.ok).toBe(true)
    store = posted.store
    const movCount = store.movements.length
    const balMesh = computeItemBalance('mesh', store.movements, 'w1').balance
    const again = postExistingWarehouseDocument(store, id, { actorId: 'u1' })
    expect(again.result.ok).toBe(false)
    expect(again.store.movements).toHaveLength(movCount)
    expect(computeItemBalance('mesh', again.store.movements, 'w1').balance).toBe(balMesh)
  })

  it('successful post creates one movement per line and exact balance delta', () => {
    let store = baseWh(
      [],
      [
        {
          id: 'm1',
          type: 'receipt',
          itemId: 'mesh',
          warehouseId: 'w1',
          quantity: 10,
          date: '2026-09-08',
          createdAt: '2026-09-08T00:00:00.000Z',
        },
        {
          id: 'm2',
          type: 'receipt',
          itemId: 'impreg',
          warehouseId: 'w1',
          quantity: 100,
          date: '2026-09-08',
          createdAt: '2026-09-08T00:00:00.000Z',
        },
      ],
    )
    const draft = saveWarehouseDocumentDraft(store, {
      type: 'issue',
      purpose: 'other',
      number: 'РС-R31B-TEST-2',
      warehouseId: 'w1',
      date: '2026-09-09',
      lines: [
        { itemId: 'mesh', quantity: 2, unit: 'рул' },
        { itemId: 'impreg', quantity: 3.2, unit: 'кг' },
      ],
      comment: 'REHEARSAL-CELLOPLEX-160-20260909-B',
    })
    expect(draft.result.ok).toBe(true)
    if (!draft.result.ok) return
    store = draft.store
    const id = draft.result.documentId
    const beforeMesh = computeItemBalance('mesh', store.movements, 'w1').balance
    const beforeImpreg = computeItemBalance('impreg', store.movements, 'w1').balance
    const posted = postExistingWarehouseDocument(store, id, { actorId: 'u1' })
    if (!posted.result.ok) {
      expect.fail(`postExisting failed: ${posted.result.error} ${JSON.stringify(posted.result.fieldErrors)}`)
    }
    store = posted.store
    const doc = store.documents.find((d) => d.id === id)!
    expect(doc.status).toBe('posted')
    const issueMovs = store.movements.filter((m) => m.documentId === id)
    expect(issueMovs).toHaveLength(2)
    expect(computeItemBalance('mesh', store.movements, 'w1').balance).toBe(beforeMesh - 2)
    expect(computeItemBalance('impreg', store.movements, 'w1').balance).toBeCloseTo(
      beforeImpreg - 3.2,
      5,
    )
  })
})

describe('R3.1B G2 active forbids soft postExisting fallback', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    vi.doUnmock('@/lib/warehouse/g2ServerClient')
    vi.doUnmock('@/lib/warehouse/g1ServerClient')
    vi.unstubAllGlobals()
  })

  it('when G2 path active, soft postExistingWarehouseDocument is not used by slice', async () => {
    vi.doMock('@/lib/warehouse/g2ServerClient', async () => {
      const actual = await vi.importActual<typeof import('@/lib/warehouse/g2ServerClient')>(
        '@/lib/warehouse/g2ServerClient',
      )
      return {
        ...actual,
        isG2WebAuthoritativePath: () => true,
        g2WarehouseCommand: vi.fn(async () => ({
          ok: false,
          error: 'revision_conflict',
          message: 'CAS conflict',
        })),
      }
    })
    // Also mock g1 path alias used by isG2
    vi.doMock('@/lib/warehouse/g1ServerClient', async () => {
      const actual = await vi.importActual<typeof import('@/lib/warehouse/g1ServerClient')>(
        '@/lib/warehouse/g1ServerClient',
      )
      return {
        ...actual,
        isG1WebAuthoritativePath: () => true,
      }
    })

    const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
    let store = {
      version: 6,
      warehouse: baseWh([draftIssue()]),
    } as never
    const setStore = (fn: (s: typeof store) => typeof store) => {
      store = fn(store)
    }
    const slice = createWarehouseSlice({
      setStore: setStore as never,
      getStore: () => store as never,
      getActor: () => ({ id: 'u1', name: 'test' }),
    })
    const before = structuredClone(store.warehouse)
    const result = await slice.postExistingWarehouseDoc(draftIssue().id, {
      actorId: 'u1',
      actorName: 'test',
    })
    expect(result.ok).toBe(false)
    expect(store.warehouse.documents.find((d) => d.id === draftIssue().id)?.status).toBe('draft')
    expect(store.warehouse.movements).toEqual(before.movements)
  })
})

describe('R3.1B unrelated draft receipt ПР-010 must stay untouched by overlay of other docs', () => {
  it('overlay replaces full critical document set; keep ПР-010 draft when present in critical', () => {
    const pr010: WarehouseDocument = {
      id: 'c2e445c7-d18f-47cf-b3a2-55fb5bf62772',
      number: 'ПР-1BC8F872-2026-010',
      type: 'receipt',
      purpose: 'purchase',
      warehouseId: 'w1',
      date: '2026-09-09',
      status: 'draft',
      lines: [
        { id: 'a', itemId: 'mesh', quantity: 1, unit: 'рул' },
        { id: 'b', itemId: 'impreg', quantity: 1, unit: 'кг' },
      ],
      createdAt: '2026-09-09T08:00:00.000Z',
    } as WarehouseDocument
    const local = baseWh([{ ...draftIssue(), status: 'posted' }, { ...pr010, status: 'posted' }])
    const critical = baseWh([draftIssue(), pr010])
    const out = resolveAuthoritativeWarehouseOverlay({
      legacyWarehouse: local,
      criticalWarehouse: critical,
      criticalRevision: 32,
      warehouseActive: true,
    })
    const kept = out.warehouse.documents.find((d) => d.id === pr010.id)
    expect(kept?.status).toBe('draft')
    expect(kept?.number).toBe('ПР-1BC8F872-2026-010')
  })
})

describe('R3.1B soft posted must not beat critical draft after overlay apply', () => {
  it('applyCriticalDomainOverlays keeps draft when soft snapshot is posted', async () => {
    const { applyCriticalDomainOverlays } = await import('@/lib/cloud/applyCriticalDomainOverlays')
    const softPosted = baseWh([
      {
        ...draftIssue(),
        status: 'posted',
        postedAt: '2026-09-09T10:00:00.000Z',
      },
    ])
    const criticalDraft = {
      ...softPosted,
      documents: [draftIssue()],
      movements: [],
    }
    const fakeLocal = {
      warehouse: softPosted,
      production: {},
    } as unknown as import('@/lib/types').AppStore
    const next = await applyCriticalDomainOverlays(fakeLocal, {
      warehouse: criticalDraft,
      revision: 32,
      warehouseActive: true,
      productionActive: false,
      packagingQcActive: false,
    })
    const doc = next.warehouse.documents.find((d) => d.id === draftIssue().id)
    expect(doc?.status).toBe('draft')
  })
})

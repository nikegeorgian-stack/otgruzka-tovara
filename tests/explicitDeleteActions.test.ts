import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import type { AppStore } from '@/lib/types'
import {
  beginBulkStoreOverwrite,
  clearBulkStoreOverwrite,
} from '@/lib/cloud/bulkStoreOverwrite'
import { conservativeMergeForSave } from '@/lib/cloud/conservativeMerge'
import {
  cloudDirtyTracker,
  nextOperationId,
  resetCloudDirtyTracker,
} from '@/lib/cloud/dirtyOperations'
import { diffStoreToOperations } from '@/lib/cloud/storeDiff'
import { applyTrackedStoreUpdate } from '@/store/storeApi'
import type { StoreSliceDeps } from '@/store/storeApi'
import { createHrSlice } from '@/store/slices/hrSlice'
import { createCandidatesSlice } from '@/store/slices/candidatesSlice'
import { createSalesSlice } from '@/store/slices/salesSlice'
import { createProcurementSlice } from '@/store/slices/procurementSlice'
import { createWarehouseSlice } from '@/store/slices/warehouseSlice'
import { createProductionSlice } from '@/store/slices/productionSlice'
import { createDirectoriesSlice } from '@/store/slices/directoriesSlice'
import { createOtcSlice } from '@/store/slices/otcSlice'
import { createTechnologistQcSlice } from '@/store/slices/technologistQcSlice'
import { createFinanceSlice } from '@/store/slices/financeSlice'
import { createWorkwearSlice } from '@/store/slices/workwearSlice'
import { createItOfficeSlice } from '@/store/slices/itOfficeSlice'
import { createEngineerLogSlice } from '@/store/slices/engineerLogSlice'
import { createWastewaterSlice } from '@/store/slices/wastewaterSlice'
import { createOrgChartSlice } from '@/store/slices/orgChartSlice'
import { createAccessSlice } from '@/store/slices/accessSlice'
import { createDefaultTasksStore } from '@/lib/tasks/init'
import { createTasksSlice } from '@/store/slices/tasksSlice'

function emptyStore(): AppStore {
  return {
    version: 6,
    employees: [
      { id: 'e1', fullName: 'Alice', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
    ],
    months: {
      '2026-09': { year: 2026, month: 9, rows: [], plan: {}, fact: {} },
    },
    brigades: [],
    access: {
      users: [
        { id: 'u-del', login: 'del@test.local', roleId: 'manager', active: true, displayName: 'Del' },
        { id: 'admin', login: 'admin@test.local', roleId: 'sysadmin', active: true, displayName: 'Admin' },
      ],
      roles: [],
      userGroups: [{ id: 'g1', name: 'Group', userIds: [] }],
    },
    auditLog: [],
    settings: { signatures: {} },
    candidates: [{ id: 'c1', fullName: 'Cand' }],
    warehouse: {
      items: [
        { id: 'w2', name: 'Deletable', unit: 'kg' },
        { id: 'w1', name: 'Item', unit: 'kg' },
      ],
      documents: [
        {
          id: 'wd1',
          type: 'receipt',
          status: 'draft',
          lines: [],
          number: '1',
          createdAt: '2026-01-01',
        },
      ],
      movements: [{ id: 'wm1', itemId: 'w1', qty: 1, at: '2026-01-01', kind: 'in', type: 'receipt' }],
      categories: [{ id: 'wc1', name: 'Cat' }],
      locations: [{ id: 'wl1', name: 'Loc' }],
      loadingShipments: [{ id: 'ls1', status: 'draft', lines: [], createdAt: '2026-01-01' }],
      auditLog: [],
    },
    sales: { orders: [{ id: 'so1', customer: 'C', lines: [], history: [] }], reservations: [], allocations: [] },
    procurement: {
      orders: [{ id: 'po1', lines: [], milestones: [], legs: [] }],
      categories: [{ id: 'pc1', name: 'PC' }],
      routePoints: [{ id: 'rp1', name: 'RP' }],
    },
    tasks: (() => {
      const base = createDefaultTasksStore()
      const boardId = base.boards[0]!.id
      const columnId = base.columns[0]!.id
      return {
        ...base,
        tasks: [
          {
            id: 't1',
            boardId,
            columnId,
            title: 'Task',
            attachmentIds: ['ta1'],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ],
        attachments: [{ id: 'ta1', taskId: 't1', fileName: 'f.pdf', uploadedAt: '2026-01-01' }],
      }
    })(),
    production: {
      requests: [{ id: 'pr1', productName: 'P', qty: 1, status: 'draft', createdAt: '2026-01-01' }],
      planner: { orders: [{ id: 'po-pl1', productName: 'P', qty: 1, status: 'draft' }] },
    },
    finance: {
      advances: [{ id: 'fa1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', amount: 100 }],
      adjustments: [{ id: 'fj1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', kind: 'bonus', amount: 50, reason: 'r' }],
      payouts: [{ id: 'fp1', employeeId: 'e1', month: '2026-09', date: '2026-09-01', amount: 200, method: 'cash' }],
      advanceDocuments: [{ id: 'fad1', number: 'AV-1', month: '2026-09', date: '2026-09-01', method: 'cash', status: 'draft', lines: [] }],
      payoutDocuments: [{ id: 'fpd1', number: 'VP-1', month: '2026-09', date: '2026-09-01', method: 'cash', status: 'draft', lines: [] }],
      advanceAccruals: [{ id: 'faa1', number: 'NA-1', month: '2026-09', status: 'draft', lines: [] }],
    },
    otc: {
      norms: [{ id: 'on1', name: 'N' }],
      labTests: [{ id: 'ol1', name: 'L' }],
      alkaliSeries: [{ id: 'oa1', name: 'A' }],
      sorting: [{ id: 'os1', name: 'S' }],
      defects: [{ id: 'od1', name: 'D' }],
    },
    technologistQc: {
      eadCalculations: [{ id: 'te1', date: '2026-01-01' }],
      eadControls: [{ id: 'tc1', date: '2026-01-01' }],
      incomingControls: [{ id: 'ti1', date: '2026-01-01' }],
      impregnationQc: [{ id: 'tp1', date: '2026-01-01' }],
      roomClimateLog: [{ id: 'tr1', date: '2026-01-01' }],
      shiftHandoffs: [{ id: 'ts1', date: '2026-01-01' }],
    },
    workwear: { issuances: [{ id: 'wi1', employeeId: 'e1', itemId: 'x', qty: 1, issuedAt: '2026-01-01' }] },
    itOffice: {
      assets: [{ id: 'ia1', name: 'PC', category: 'hw', status: 'active' }],
      acts: [{ id: 'iact1', status: 'draft', lines: [], createdAt: '2026-01-01' }],
      maintenance: [{ id: 'im1', assetId: 'ia1', date: '2026-01-01', kind: 'repair' }],
    },
    engineerLog: { entries: [{ id: 'el1', date: '2026-01-01', text: 'x' }] },
    wastewater: { cubes: [{ id: 'ww1', number: 1, status: 'empty', createdAt: '2026-01-01' }] },
    orgChart: {
      nodes: [{ id: 'oc1', nameFull: 'CEO', nameShort: 'CEO', layoutX: 100, layoutY: 100 }],
    },
    counterparties: { items: [{ id: 'cp1', name: 'CP', kind: 'customer' }] },
    finishedProducts: { items: [{ id: 'fp-item1', name: 'FP' }] },
    packagingRecipes: {
      items: [{ id: 'pk1', name: 'PK' }],
      boxes: [{ id: 'bx1', name: 'BX' }],
    },
    formulations: { recipes: [{ id: 'fr1', name: 'FR', lines: [] }] },
    trash: { employees: [], months: [], candidates: [] },
    protocols: {},
    meals: {},
    nightShifts: {},
    timesheetEntries: {},
    attendance: {},
    shiftTemplates: [],
    hrStructuralUnits: [{ id: 'su1', name: 'Unit' }],
    hrPositions: [{ id: 'hp1', title: 'Pos' }],
  } as unknown as AppStore
}

function makeHarness(initial: AppStore) {
  let store = initial
  const deps: StoreSliceDeps = {
    setStore: (fn) => {
      store = typeof fn === 'function' ? fn(store) : fn
    },
    getStore: () => store,
    getActor: () => ({ id: 'actor1', name: 'Tester', roleId: 'sysadmin' }),
  }
  return { deps, getStore: () => store }
}

type DeleteCase = {
  name: string
  domain: string
  entityId: string
  run: (deps: StoreSliceDeps) => void
}

const DELETE_ACTION_CASES: DeleteCase[] = [
  {
    name: 'removeEmployee',
    domain: 'employees',
    entityId: 'e1',
    run: (d) => createHrSlice(d).removeEmployee('e1'),
  },
  {
    name: 'removeHrPosition',
    domain: 'hrPositions',
    entityId: 'hp1',
    run: (d) => createHrSlice(d).removeHrPosition('hp1'),
  },
  {
    name: 'removeHrStructuralUnit',
    domain: 'hrStructuralUnits',
    entityId: 'su1',
    run: (d) => createHrSlice(d).removeHrStructuralUnit('su1'),
  },
  {
    name: 'removeCandidate',
    domain: 'candidates',
    entityId: 'c1',
    run: (d) => createCandidatesSlice(d).removeCandidate('c1'),
  },
  {
    name: 'removeSalesOrder',
    domain: 'sales.orders',
    entityId: 'so1',
    run: (d) => createSalesSlice(d).removeSalesOrder('so1'),
  },
  {
    name: 'removePurchaseOrder',
    domain: 'procurement.orders',
    entityId: 'po1',
    run: (d) => createProcurementSlice(d).removePurchaseOrder('po1'),
  },
  {
    name: 'removeProcurementCategory',
    domain: 'procurement.categories',
    entityId: 'pc1',
    run: (d) => createProcurementSlice(d).removeProcurementCategory('pc1'),
  },
  {
    name: 'removeRoutePoint',
    domain: 'procurement.routePoints',
    entityId: 'rp1',
    run: (d) => createProcurementSlice(d).removeRoutePoint('rp1'),
  },
  {
    name: 'removeWarehouseItem',
    domain: 'warehouse.items',
    entityId: 'w2',
    run: (d) => createWarehouseSlice(d).removeWarehouseItem('w2'),
  },
  {
    name: 'removeWarehouseCategory',
    domain: 'warehouse.categories',
    entityId: 'wc1',
    run: (d) => createWarehouseSlice(d).removeWarehouseCategory('wc1'),
  },
  {
    name: 'removeWarehouseLocation',
    domain: 'warehouse.locations',
    entityId: 'wl1',
    run: (d) => createWarehouseSlice(d).removeWarehouseLocation('wl1'),
  },
  {
    name: 'deleteStockMovement',
    domain: 'warehouse.movements',
    entityId: 'wm1',
    run: (d) => createWarehouseSlice(d).deleteStockMovement('wm1'),
  },
  {
    name: 'removeWarehouseDraft',
    domain: 'warehouse.documents',
    entityId: 'wd1',
    run: (d) => createWarehouseSlice(d).removeWarehouseDraft('wd1'),
  },
  {
    name: 'removeLoadingShipment',
    domain: 'warehouse.loadingShipments',
    entityId: 'ls1',
    run: (d) => createWarehouseSlice(d).removeLoadingShipment('ls1'),
  },
  {
    name: 'removeProductionOrder',
    domain: 'production.planner.orders',
    entityId: 'po-pl1',
    run: (d) => createProductionSlice(d).removeProductionOrder('po-pl1'),
  },
  {
    name: 'removeProductionRequest',
    domain: 'production.requests',
    entityId: 'pr1',
    run: (d) => createProductionSlice(d).removeProductionRequest('pr1'),
  },
  {
    name: 'removeCounterparty',
    domain: 'counterparties.items',
    entityId: 'cp1',
    run: (d) => createDirectoriesSlice(d).removeCounterparty('cp1'),
  },
  {
    name: 'removeFinishedProduct',
    domain: 'finishedProducts.items',
    entityId: 'fp-item1',
    run: (d) => createDirectoriesSlice(d).removeFinishedProduct('fp-item1'),
  },
  {
    name: 'removeBoxRecipe',
    domain: 'packagingRecipes.boxes',
    entityId: 'bx1',
    run: (d) => createDirectoriesSlice(d).removeBoxRecipe('bx1'),
  },
  {
    name: 'removePackagingRecipe',
    domain: 'packagingRecipes.items',
    entityId: 'pk1',
    run: (d) => createDirectoriesSlice(d).removePackagingRecipe('pk1'),
  },
  {
    name: 'removeFormulationRecipe',
    domain: 'formulations.recipes',
    entityId: 'fr1',
    run: (d) => createDirectoriesSlice(d).removeFormulationRecipe('fr1'),
  },
  {
    name: 'removeOtcNorm',
    domain: 'otc.norms',
    entityId: 'on1',
    run: (d) => createOtcSlice(d).removeOtcNorm('on1'),
  },
  {
    name: 'removeOtcLabTest',
    domain: 'otc.labTests',
    entityId: 'ol1',
    run: (d) => createOtcSlice(d).removeOtcLabTest('ol1'),
  },
  {
    name: 'removeOtcAlkaliSeries',
    domain: 'otc.alkaliSeries',
    entityId: 'oa1',
    run: (d) => createOtcSlice(d).removeOtcAlkaliSeries('oa1'),
  },
  {
    name: 'removeOtcSorting',
    domain: 'otc.sorting',
    entityId: 'os1',
    run: (d) => createOtcSlice(d).removeOtcSorting('os1'),
  },
  {
    name: 'removeOtcDefect',
    domain: 'otc.defects',
    entityId: 'od1',
    run: (d) => createOtcSlice(d).removeOtcDefect('od1'),
  },
  {
    name: 'removeEadCalculation',
    domain: 'technologistQc.eadCalculations',
    entityId: 'te1',
    run: (d) => createTechnologistQcSlice(d).removeEadCalculation('te1'),
  },
  {
    name: 'removeEadControl',
    domain: 'technologistQc.eadControls',
    entityId: 'tc1',
    run: (d) => createTechnologistQcSlice(d).removeEadControl('tc1'),
  },
  {
    name: 'removeIncomingControl',
    domain: 'technologistQc.incomingControls',
    entityId: 'ti1',
    run: (d) => createTechnologistQcSlice(d).removeIncomingControl('ti1'),
  },
  {
    name: 'removeImpregnationQc',
    domain: 'technologistQc.impregnationQc',
    entityId: 'tp1',
    run: (d) => createTechnologistQcSlice(d).removeImpregnationQc('tp1'),
  },
  {
    name: 'removeRoomClimateReading',
    domain: 'technologistQc.roomClimateLog',
    entityId: 'tr1',
    run: (d) => createTechnologistQcSlice(d).removeRoomClimateReading('tr1'),
  },
  {
    name: 'removeShiftHandoff',
    domain: 'technologistQc.shiftHandoffs',
    entityId: 'ts1',
    run: (d) => createTechnologistQcSlice(d).removeShiftHandoff('ts1'),
  },
  {
    name: 'deleteAdvanceDocumentDraft',
    domain: 'finance.advanceDocuments',
    entityId: 'fad1',
    run: (d) => createFinanceSlice(d).deleteAdvanceDocumentDraft('fad1'),
  },
  {
    name: 'deletePayoutDocumentDraft',
    domain: 'finance.payoutDocuments',
    entityId: 'fpd1',
    run: (d) => createFinanceSlice(d).deletePayoutDocumentDraft('fpd1'),
  },
  {
    name: 'removeAdvance',
    domain: 'finance.advances',
    entityId: 'fa1',
    run: (d) => createFinanceSlice(d).removeAdvance('fa1'),
  },
  {
    name: 'removeAdjustment',
    domain: 'finance.adjustments',
    entityId: 'fj1',
    run: (d) => createFinanceSlice(d).removeAdjustment('fj1'),
  },
  {
    name: 'removePayout',
    domain: 'finance.payouts',
    entityId: 'fp1',
    run: (d) => createFinanceSlice(d).removePayout('fp1'),
  },
  {
    name: 'deleteAdvanceAccrualDraft',
    domain: 'finance.advanceAccruals',
    entityId: 'faa1',
    run: (d) => createFinanceSlice(d).deleteAdvanceAccrualDraft('faa1'),
  },
  {
    name: 'removeWorkwearIssuance',
    domain: 'workwear.issuances',
    entityId: 'wi1',
    run: (d) => createWorkwearSlice(d).removeWorkwearIssuance('wi1'),
  },
  {
    name: 'removeItAsset',
    domain: 'itOffice.assets',
    entityId: 'ia1',
    run: (d) => createItOfficeSlice(d).removeItAsset('ia1'),
  },
  {
    name: 'removeItHandoverActDraft',
    domain: 'itOffice.acts',
    entityId: 'iact1',
    run: (d) => createItOfficeSlice(d).removeItHandoverActDraft('iact1'),
  },
  {
    name: 'removeItMaintenance',
    domain: 'itOffice.maintenance',
    entityId: 'im1',
    run: (d) => createItOfficeSlice(d).removeItMaintenance('im1'),
  },
  {
    name: 'removeEngineerLogEntry',
    domain: 'engineerLog.entries',
    entityId: 'el1',
    run: (d) => createEngineerLogSlice(d).removeEngineerLogEntry('el1'),
  },
  {
    name: 'removeWastewaterCube',
    domain: 'wastewater.cubes',
    entityId: 'ww1',
    run: (d) => createWastewaterSlice(d).removeWastewaterCube('ww1'),
  },
  {
    name: 'removeOrgChartNode',
    domain: 'orgChart.nodes',
    entityId: 'oc1',
    run: (d) => createOrgChartSlice(d).removeOrgChartNode('oc1'),
  },
  {
    name: 'removeUserGroup',
    domain: 'access.userGroups',
    entityId: 'g1',
    run: (d) => createAccessSlice(d).removeUserGroup('g1'),
  },
  {
    name: 'removeTaskAttachmentMeta',
    domain: 'tasks.attachments',
    entityId: 'ta1',
    run: (d) => createTasksSlice(d).removeTaskAttachmentMeta('t1', 'ta1'),
  },
]

beforeEach(() => {
  vi.stubEnv('VITE_FST_WEB', 'true')
  resetCloudDirtyTracker()
  cloudDirtyTracker.setBaseRevision(5)
  cloudDirtyTracker.setBaselineStore(emptyStore())
})

afterEach(() => {
  vi.unstubAllEnvs()
  clearBulkStoreOverwrite()
})

describe('slice delete actions → explicit operations', () => {
  it.each(DELETE_ACTION_CASES)(
    '$name creates exactly one explicit delete op',
    ({ domain, entityId, run }) => {
      const { deps } = makeHarness(emptyStore())
      run(deps)
      const pending = cloudDirtyTracker.getPending()
      expect(pending).toHaveLength(1)
      expect(pending[0]?.type).toBe('delete')
      expect(pending[0]?.explicit).toBe(true)
      expect(pending[0]?.domain).toBe(domain)
      expect(pending[0]?.entityId).toBe(entityId)
      expect(pending[0]?.baseRevision).toBe(5)
      expect(pending[0]?.origin).toBe('user')
      expect(pending[0]?.operationId).toBeTruthy()
    },
  )

  it('removeWebUser enqueues pending-deletion update and outbox (no immediate delete)', () => {
    const initial = emptyStore()
    const { deps, getStore } = makeHarness(initial)
    void createAccessSlice(deps).removeWebUser({
      id: 'u-del',
      login: 'del@test.local',
      inStore: true,
    })
    applyTrackedStoreUpdate(initial, getStore(), 'user')
    const pending = cloudDirtyTracker.getPending()
    expect(pending.some((op) => op.domain === 'access.users' && op.type === 'update')).toBe(true)
    expect(pending.some((op) => op.domain === 'externalEffects.outbox' && op.type === 'create')).toBe(
      true,
    )
    expect(pending.some((op) => op.type === 'delete')).toBe(false)
  })

  it('non-web removeWebUser does not mutate store or enqueue outbox', async () => {
    vi.stubEnv('VITE_FST_WEB', 'false')
    const initial = emptyStore()
    const { deps, getStore } = makeHarness(initial)
    await expect(
      createAccessSlice(deps).removeWebUser({
        id: 'u-del',
        login: 'del@test.local',
        inStore: true,
      }),
    ).rejects.toThrow('external_deletion_web_only')
    expect(getStore().access.users.find((u) => u.id === 'u-del')?.pendingDeletion).toBeFalsy()
    expect(getStore().access.users.find((u) => u.id === 'u-del')?.active).toBe(true)
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('non-web beginTaskAttachmentDelete does not mutate', () => {
    vi.stubEnv('VITE_FST_WEB', 'false')
    const initial = emptyStore()
    const { deps, getStore } = makeHarness(initial)
    expect(() => createTasksSlice(deps).beginTaskAttachmentDelete('t1', 'ta1')).toThrow(
      'external_deletion_web_only',
    )
    expect(getStore().tasks?.attachments.find((a) => a.id === 'ta1')?.pendingDeletion).toBeFalsy()
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })
})

describe('non-delete paths must not create explicit delete', () => {
  it('diff without UI delete does not enqueue delete', () => {
    const baseline = emptyStore()
    const local = {
      ...baseline,
      employees: baseline.employees.filter((e) => e.id !== 'e1'),
    }
    const ops = diffStoreToOperations(baseline, local, 5, 'user')
    expect(ops.every((op) => op.type !== 'delete')).toBe(true)
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('hydration does not create delete', () => {
    const a = emptyStore()
    const b = { ...a, settings: { ...a.settings, theme: 'dark' } }
    applyTrackedStoreUpdate(a, b, 'hydration')
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('system mutation does not create delete', () => {
    const a = emptyStore()
    const b = { ...a, employees: [...a.employees] }
    applyTrackedStoreUpdate(a, b, 'system')
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
  })

  it('bulk import preview does not create delete', () => {
    beginBulkStoreOverwrite('import')
    const a = emptyStore()
    const b = { ...a, employees: [] }
    applyTrackedStoreUpdate(a, b, 'user')
    expect(cloudDirtyTracker.getPending()).toHaveLength(0)
    clearBulkStoreOverwrite()
  })
})

describe('explicit delete merge safety', () => {
  it('stale tab cannot delete entity created later in cloud', () => {
    const baseline = emptyStore()
    const remote = {
      ...baseline,
      employees: [
        ...baseline.employees,
        { id: 'e-new', fullName: 'New', active: true, schedule: '5/2 8ч', shiftMode: 'day' },
      ],
    }
    const local = baseline
    const deleteOp = {
      operationId: nextOperationId(),
      type: 'delete' as const,
      domain: 'employees',
      entityId: 'e-new',
      fields: ['*'],
      baseRevision: 5,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
    }
    const { store, conflicts } = conservativeMergeForSave(baseline, remote, local, [deleteOp])
    expect(conflicts.length).toBeGreaterThan(0)
    expect(store.employees.some((e) => e.id === 'e-new')).toBe(true)
  })

  it('pending delete survives pull when not yet acknowledged', () => {
    const deleteOp = {
      operationId: 'op-del-e1',
      type: 'delete' as const,
      domain: 'employees',
      entityId: 'e1',
      fields: ['*'],
      baseRevision: 5,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
    }
    cloudDirtyTracker.enqueue([deleteOp])
    cloudDirtyTracker.setBaseRevision(8)
    expect(cloudDirtyTracker.getPending()).toHaveLength(1)
    expect(cloudDirtyTracker.getPending()[0]?.operationId).toBe('op-del-e1')
  })

  it('successful delete acknowledges matching operation id only', () => {
    const op1 = {
      operationId: 'op-del-1',
      type: 'delete' as const,
      domain: 'employees',
      entityId: 'e1',
      fields: ['*'],
      baseRevision: 5,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
    }
    const op2 = {
      operationId: 'op-del-2',
      type: 'delete' as const,
      domain: 'candidates',
      entityId: 'c1',
      fields: ['*'],
      baseRevision: 5,
      origin: 'user' as const,
      at: new Date().toISOString(),
      explicit: true,
    }
    cloudDirtyTracker.enqueue([op1, op2])
    cloudDirtyTracker.acknowledgePersisted(['op-del-1'])
    const remaining = cloudDirtyTracker.getPending()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.operationId).toBe('op-del-2')
  })
})

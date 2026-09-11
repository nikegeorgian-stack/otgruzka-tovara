import { describe, expect, it } from 'vitest'
import type { AccessStore, AppUser } from '@/lib/access/types'
import {
  approveRecipeVersion,
  buildNormSnapshotFromVersion,
  canApproveRecipeVersion,
  canEditRecipeDraft,
  captureLegacyNormSnapshot,
  createDraftRecipeVersion,
  getApprovedRecipeVersion,
  isLegacyUnapprovedRecipe,
  LEGACY_CAPTURE_REASON_REQUIRED,
  RECIPE_IMMUTABLE,
  RECIPE_APPROVE_FORBIDDEN,
  updateDraftRecipeVersion,
  type FormulationRecipeVersion,
  type RecipeNormSnapshot,
} from '@/lib/formulations/recipeApproval'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import {
  confirmShiftReportCorrection,
  confirmProductionShiftReport as confirmProductionShiftReportImpl,
  canConfirmShiftReport,
  canCorrectShiftReport,
  canCreateShiftReport,
  computeNormQtyForOutput,
  deviationPct,
  isShiftReportImmutable,
  type ConfirmShiftReportInput,
  type ProductionShiftReport,
  type ShiftMaterialActualLine,
  type ShiftWasteLine,
} from '@/lib/production/shiftReports'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  canManualReallocateReservations,
  confirmProductionOrderReservation,
} from '@/lib/warehouse/productionReservations'
import { computeLineMaterialBalances } from '@/lib/warehouse/productionMaterialHandoff'
import { transferProductionMaterials } from '@/lib/warehouse/productionMaterialHandoff'
import { upsertProductionLineBinding } from '@/lib/warehouse/productionLineLocationConfig'
import { withActiveWarehouses } from '@/lib/warehouse/accountingStatus'
import {
  assertNotShippingWip,
  isItemAvailableAsFinishedGoods,
} from '@/lib/production/wipShipmentGuard'
import {
  buildShiftReportPrintModel,
  withCorrectsReportNumber,
} from '@/lib/production/shiftReportPrint'
import {
  classifyAtomicGroupAgainstRemote,
  sanitizeAcknowledgeIds,
  stampOpsWithTransactionGroup,
  warehouseTransactionGroupId,
} from '@/lib/cloud/transactionGroups'
import type { DirtyOperation } from '@/lib/cloud/dirtyOperations'
import {
  createMemoryDurableJournalAdapter,
  dirtyOpToJournalRecord,
  journalRecordToDirtyOp,
  shouldPersistOperationToJournal,
} from '@/lib/cloud/durableJournal'
import type { AppStore } from '@/lib/types'
import type { WarehouseItem, WarehouseLocation, WarehouseStore } from '@/lib/warehouse/types'
import { postWarehouseDocument } from '@/lib/warehouse/documents'

const masterUser: AppUser = {
  id: 'wm-1',
  login: 'wm',
  displayName: 'Workshop Master',
  roleId: 'workshop_master',
  passwordHash: 'x',
  passwordSalt: 'y',
  active: true,
}

const technologistUser: AppUser = {
  id: 'tech-1',
  login: 'tech',
  displayName: 'Technologist',
  roleId: 'technologist',
  passwordHash: 'x',
  passwordSalt: 'y',
  active: true,
}

const directorUser: AppUser = {
  id: 'dir-1',
  login: 'dir',
  displayName: 'Director',
  roleId: 'operations_director',
  passwordHash: 'x',
  passwordSalt: 'y',
  active: true,
}

const sysadminUser: AppUser = {
  id: 'sa-1',
  login: 'sa',
  displayName: 'Sysadmin',
  roleId: 'sysadmin',
  passwordHash: 'x',
  passwordSalt: 'y',
  active: true,
}

const warehouseKeeperUser: AppUser = {
  id: 'wk-1',
  login: 'wk',
  displayName: 'Warehouse Keeper',
  roleId: 'warehouse_keeper',
  passwordHash: 'x',
  passwordSalt: 'y',
  active: true,
}

const appScope = {
  brigades: [],
  brigadiers: {},
  employees: [],
}

const orderRegistry = new Map<string, ProductionOrder>()

function registerOrder(order: ProductionOrder): void {
  orderRegistry.set(order.id, order)
}

function confirmProductionShiftReport(
  production: ProductionStore,
  warehouse: WarehouseStore,
  input:
    | ConfirmShiftReportInput
    | (ConfirmShiftReportInput['report'] & {
        actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
        access?: AccessStore | null
        appScope?: typeof appScope
        productionOrder?: ProductionOrder
        idempotencyKey?: string
        emergencyReason?: string
        transactionGroupId?: string
      }),
): ReturnType<typeof confirmProductionShiftReportImpl> {
  if (input && typeof input === 'object' && 'report' in input && 'productionOrder' in input) {
    return confirmProductionShiftReportImpl(production, warehouse, input as ConfirmShiftReportInput)
  }

  const report = input as ConfirmShiftReportInput['report'] & {
    actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
    access?: AccessStore | null
    appScope?: typeof appScope
    productionOrder?: ProductionOrder
    emergencyReason?: string
    idempotencyKey?: string
    transactionGroupId?: string
  }
  const productionOrder =
    report.productionOrder ??
    orderRegistry.get(report.productionOrderId) ??
    sampleOrder(buildApprovedSnapshot().snapshot, { id: report.productionOrderId })
  return confirmProductionShiftReportImpl(production, warehouse, {
    report,
    productionOrder,
    actor:
      report.actor ??
      ({ id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId } as const),
    access: report.access,
    appScope: report.appScope ?? appScope,
    idempotencyKey: report.idempotencyKey,
    transactionGroupId: report.transactionGroupId,
    emergencyReason: report.emergencyReason,
  })
}

function emptyWarehouse(): WarehouseStore {
  const raw: WarehouseLocation = {
    id: 'wh-raw',
    name: 'Raw',
    sortOrder: 1,
    kind: 'raw',
  }
  const line1: WarehouseLocation = {
    id: 'wh-line1',
    name: 'Line 1',
    sortOrder: 2,
    kind: 'wip',
  }
  const pack: WarehouseLocation = {
    id: 'wh-pack',
    name: 'Pack',
    sortOrder: 3,
    kind: 'packaging',
  }
  const scrap: WarehouseLocation = {
    id: 'wh-scrap',
    name: 'Scrap',
    sortOrder: 4,
    kind: 'other',
  }

  const rawItem: WarehouseItem = {
    id: 'item-rm',
    internalCode: 'RM-1',
    name: 'Raw material',
    categoryId: 'cat-1',
    warehouseId: raw.id,
    unit: 'kg',
    active: true,
    sortOrder: 1,
  }
  const semiFinishedItem: WarehouseItem = {
    id: 'item-sf',
    internalCode: 'SF-1',
    name: 'Semi-finished',
    categoryId: 'cat-2',
    warehouseId: pack.id,
    unit: 'm2',
    active: true,
    sortOrder: 2,
  }

  let store: WarehouseStore = {
    locations: [raw, line1, pack, scrap],
    categories: [
      { id: 'cat-1', name: 'Raw', sortOrder: 1 },
      { id: 'cat-2', name: 'Semi-finished', sortOrder: 2 },
    ],
    items: [rawItem, semiFinishedItem],
    movements: [],
    documents: [],
    auditLog: [],
    nextInternalCode: 10,
    invoiceRegistry: [],
    materialShortages: [],
    productionLineBindings: [],
    scrapLocationId: scrap.id,
  }

  store = withActiveWarehouses(store, [raw.id, line1.id, pack.id, scrap.id])
  store = upsertProductionLineBinding(store, {
    lineId: '1',
    productionWarehouseId: line1.id,
    productionLocationId: line1.id,
  })
  store = upsertProductionLineBinding(store, {
    lineId: 'pack',
    productionWarehouseId: pack.id,
    productionLocationId: pack.id,
  })
  return store
}

function stockReceipt(
  store: WarehouseStore,
  qty: number,
  opts?: { batchNo?: string; expiryDate?: string; createdAt?: string; warehouseId?: string },
): WarehouseStore {
  const now = opts?.createdAt ?? '2026-09-01T10:00:00.000Z'
  const warehouseId = opts?.warehouseId ?? 'wh-raw'
  const out = transferAwareReceipt(store, qty, warehouseId, now, opts?.batchNo, opts?.expiryDate)
  return out
}

function transferAwareReceipt(
  store: WarehouseStore,
  qty: number,
  warehouseId: string,
  postedAt: string,
  batchNo?: string,
  expiryDate?: string,
): WarehouseStore {
  return postWarehouseDocument(store, {
    type: 'receipt',
    number: `RCV-TEST-${store.documents.length + 1}`,
    date: '2026-09-01',
    warehouseId,
    purpose: 'purchase',
    counterparty: 'Supplier',
    lines: [
      {
        itemId: 'item-rm',
        quantity: qty,
        batchNo,
        expiryDate,
      },
    ],
    status: 'posted',
    postedAt,
    skipFieldValidation: false,
  }).store
}

function baseFormulationStore(): FormulationStore {
  return {
    recipes: [
      {
        id: 'recipe-1',
        code: 'R-1',
        name: 'Recipe 1',
        category: 'ratl',
        currency: 'GEL',
        components: [
          {
            id: 'legacy-comp-1',
            name: 'Raw material',
            weightKg: 10,
            warehouseItemId: 'item-rm',
          },
        ],
        active: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      } satisfies FormulationRecipe,
    ],
    pigmentPastes: [],
    nextRecipeCode: 2,
    batchRuns: [],
    recipeVersions: [],
  }
}

function buildApprovedSnapshot(
  normQty = 1,
  tolerancePct = 10,
): { store: FormulationStore; version: FormulationRecipeVersion; snapshot: RecipeNormSnapshot } {
  const draft = createDraftRecipeVersion(baseFormulationStore(), {
    recipeId: 'recipe-1',
    normBase: 'per_m2',
    components: [
      {
        lineId: 'comp-rm',
        warehouseItemId: 'item-rm',
        itemCodeSnapshot: 'RM-1',
        itemNameSnapshot: 'Raw material',
        unitSnapshot: 'kg',
        normQty,
        tolerancePct,
      },
    ],
    actor: { id: 'tech-1', name: 'Technologist' },
  })
  if ('error' in draft) {
    throw new Error(draft.error)
  }
  const approved = approveRecipeVersion(
    draft.store,
    draft.version.id,
    { id: 'dir-1', name: 'Director', roleId: 'operations_director' },
  )
  if ('error' in approved) {
    throw new Error(approved.error)
  }
  return {
    store: approved.store,
    version: approved.version,
    snapshot: buildNormSnapshotFromVersion(approved.version),
  }
}

function buildLegacyRecipeStore(): FormulationStore {
  return {
    recipes: [
      {
        id: 'legacy-recipe',
        code: 'LEG-1',
        name: 'Legacy recipe',
        category: 'ratl',
        currency: 'GEL',
        components: [
          {
            id: 'legacy-comp',
            name: 'Legacy raw',
            weightKg: 8,
            warehouseItemId: 'item-rm',
          },
        ],
        active: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      } satisfies FormulationRecipe,
    ],
    pigmentPastes: [],
    nextRecipeCode: 2,
    batchRuns: [],
    recipeVersions: [],
  }
}

function sampleOrder(
  snapshot: RecipeNormSnapshot,
  overrides?: Partial<ProductionOrder>,
): ProductionOrder {
  return {
    id: 'po-1',
    orderNumber: 'PO-1',
    customer: 'Client',
    productName: 'Product',
    category: 'ratl1',
    totalQtyMp: 1000,
    startDate: '2026-09-10',
    endDate: '2026-09-20',
    lineId: '1',
    priority: 'normal',
    status: 'active',
    planMode: 'even',
    recalcMode: 'auto',
    rawMaterialItemId: 'item-rm',
    semiFinishedItemId: 'item-sf',
    m2PerRoll: 2,
    recipeNormSnapshot: snapshot,
    packagingPlan: {
      recipeName: 'test',
      stackDescription: '',
      rollsPerPallet: 1,
      palletUnits: 1,
      palletsNeeded: 0,
      boxesNeeded: 0,
      topRolls: 0,
      rawRollsEstimated: 20,
    } as ProductionOrder['packagingPlan'],
    dayPlans: [],
    history: [
      {
        id: 'h1',
        at: '2026-09-03T08:00:00.000Z',
        type: 'activated',
        message: 'activated',
      },
    ],
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-03T08:00:00.000Z',
    ...overrides,
  }
}

function transferToLineFixture(opts?: {
  transferQty?: number
  lineBatchNo?: string
  lineExpiryDate?: string
  outputM2?: number
  rollCount?: number
  actualInputQty?: number
  wasteQty?: number
  batchNo?: string
  batchOverrideReason?: string
  inputUnit?: string
  conversionTolerancePct?: number
  conversionDeviationReason?: string
  materialItemId?: string
  wasteLines?: ShiftWasteLine[]
  lineId?: '1'
  reportId?: string
  idempotencyKey?: string
  transactionGroupId?: string
}) {
  const { store: formulationStore, snapshot } = buildApprovedSnapshot(1, opts?.conversionTolerancePct ?? 10)
  void formulationStore

  let warehouse = emptyWarehouse()
  warehouse = stockReceipt(warehouse, 30, {
    batchNo: 'SOON',
    expiryDate: '2026-10-01',
    createdAt: '2026-09-01T09:00:00.000Z',
  })
  warehouse = stockReceipt(warehouse, 30, {
    batchNo: 'LATE',
    expiryDate: '2026-12-01',
    createdAt: '2026-09-01T10:00:00.000Z',
  })

  const order = sampleOrder(snapshot, {
    id: 'po-1',
    orderNumber: 'PO-1',
  })
  registerOrder(order)

  warehouse = confirmProductionOrderReservation(warehouse, order).store
  warehouse = transferProductionMaterials(warehouse, {
    productionOrder: order,
    rawWarehouseId: 'wh-raw',
    lines: [
      {
        itemId: 'item-rm',
        quantity: opts?.transferQty ?? 20,
        batchNo: opts?.lineBatchNo,
        expiryDate: opts?.lineExpiryDate,
        batchOverrideReason: opts?.batchOverrideReason,
        inputUnit: opts?.inputUnit,
      },
    ],
    actor: { id: warehouseKeeperUser.id, name: warehouseKeeperUser.displayName, roleId: 'warehouse_keeper' },
    idempotencyKey: `handoff-${opts?.idempotencyKey ?? 'base'}`,
  }).store

  const normInfo = computeNormQtyForOutput(snapshot, 'item-rm', opts?.outputM2 ?? 10)
  if (!normInfo) {
    throw new Error('missing norm info')
  }
  const actualInputQty = opts?.actualInputQty ?? 10
  const wasteQty = opts?.wasteQty ?? 0
  const line: ShiftMaterialActualLine = {
    lineId: opts?.reportId ?? 'line-1',
    itemId: opts?.materialItemId ?? 'item-rm',
    unitSnapshot: opts?.inputUnit ?? 'kg',
    normQty: normInfo.normQty,
    actualInputQty,
    wasteQty,
    processConsumedQty: actualInputQty - wasteQty,
    deviationQty: actualInputQty - normInfo.normQty,
    deviationPct: deviationPct(actualInputQty, normInfo.normQty),
    tolerancePct: normInfo.tolerancePct,
    batchNo: opts?.batchNo,
    batchOverrideReason: opts?.batchOverrideReason,
  }

  const report: ConfirmShiftReportInput['report'] = {
    productionOrderId: order.id,
    lineId: opts?.lineId ?? '1',
    shiftDate: '2026-09-03',
    shift: 'day',
    recipeNormSnapshot: snapshot,
    productionLocationId: 'wh-line1',
    packagingLocationId: 'wh-pack',
    scrapLocationId: 'wh-scrap',
    materialLines: [line],
    wasteLines:
      opts?.wasteLines ??
      (wasteQty > 0
        ? [
            {
              lineId: `waste-${opts?.reportId ?? '1'}`,
              itemId: 'item-rm',
              quantity: wasteQty,
              unitSnapshot: 'kg',
              reasonCode: 'trim',
              comment: 'trim loss',
            },
          ]
        : []),
    outputM2: opts?.outputM2 ?? 10,
    rollCount: opts?.rollCount ?? 5,
    m2PerRollSnapshot: 2,
    conversionTolerancePct: opts?.conversionTolerancePct ?? 10,
    conversionDeviationReason: opts?.conversionDeviationReason,
    semiFinishedItemId: 'item-sf',
    idempotencyKey: opts?.idempotencyKey ?? 'sr-1',
    transactionGroupId: opts?.transactionGroupId,
    responsibleUserId: masterUser.id,
    responsibleNameSnapshot: masterUser.displayName,
    responsibleRoleSnapshot: masterUser.roleId,
    createdAt: '2026-09-03T11:00:00.000Z',
    updatedAt: '2026-09-03T11:00:00.000Z',
  } as ConfirmShiftReportInput['report']

  const production: ProductionStore = {
    requests: [],
    planner: { orders: [], nextOrderSeq: 1 },
    shiftReports: [],
  }

  return { warehouse, production, order, report, snapshot }
}

function makeRemoteAppStoreWithShiftReport(report: ProductionShiftReport): AppStore {
  return {
    version: 6,
    brigades: [],
    brigadiers: {},
    archivedMonths: [],
    employees: [],
    candidates: [],
    months: {},
    auditLog: [],
    trash: { employees: [], months: [], candidates: [] },
    shiftTemplates: [],
    hrStructuralUnits: [],
    hrPositions: [],
    production: {
      requests: [],
      planner: { orders: [], nextOrderSeq: 1 },
      shiftReports: [report],
    },
    sales: {} as AppStore['sales'],
    aiChat: {} as AppStore['aiChat'],
    counterparties: {} as AppStore['counterparties'],
    finishedProducts: {} as AppStore['finishedProducts'],
    packagingRecipes: {} as AppStore['packagingRecipes'],
    formulations: baseFormulationStore(),
    technologistQc: {} as AppStore['technologistQc'],
    otc: {} as AppStore['otc'],
    wastewater: {} as AppStore['wastewater'],
    engineerLog: {} as AppStore['engineerLog'],
    warehouse: emptyWarehouse(),
    workwear: {} as AppStore['workwear'],
    itOffice: {} as AppStore['itOffice'],
    procurement: {} as AppStore['procurement'],
    access: {
      users: [],
      roleViews: {
        sysadmin: [],
        warehouse_keeper: [],
        hr: [],
        hr_inspector: [],
        operations_director: [],
        workshop_master: [],
        procurement_manager: [],
        chief_engineer: [],
        technologist: [],
        otc: [],
        mixer: [],
        finance: [],
        employee: [],
        it_specialist: [],
        sales_dispatcher: [],
        office_manager: [],
        timeclock: [],
        cook: [],
        secretary: [],
      },
    } as AccessStore,
    settings: {
      responsible: '',
      site: '',
      locale: 'en',
    },
  }
}

describe('PHASE P1B production shift report', () => {
  it('1: planner reallocation ACL', () => {
    const access = {
      userAllowReservationReallocation: ['planner-1'],
      roleAllowReservationReallocation: { chief_engineer: true },
    } as AccessStore

    expect(
      canManualReallocateReservations(
        { id: 'dir-1', roleId: 'operations_director', active: true },
        access,
        { reason: '' },
      ),
    ).toBe(true)
    expect(
      canManualReallocateReservations(
        { id: 'planner-1', roleId: 'employee', active: true },
        access,
      ),
    ).toBe(true)
    expect(
      canManualReallocateReservations(
        { id: 'sa-1', roleId: 'sysadmin', active: true },
        access,
      ),
    ).toBe(false)
    expect(
      canManualReallocateReservations(
        { id: 'sa-1', roleId: 'sysadmin', active: true },
        access,
        { reason: 'emergency' },
      ),
    ).toBe(true)
    expect(
      canManualReallocateReservations(
        { id: 'wk-1', roleId: 'warehouse_keeper', active: true },
        access,
        { reason: 'x' },
      ),
    ).toBe(false)
    expect(
      canManualReallocateReservations(
        { id: 'wm-1', roleId: 'workshop_master', active: true },
        access,
        { reason: 'x' },
      ),
    ).toBe(false)
    expect(
      canManualReallocateReservations(
        { id: 'ce-1', roleId: 'chief_engineer', active: true },
        access,
      ),
    ).toBe(false)
    expect(
      canManualReallocateReservations(
        { id: 'ce-1', roleId: 'chief_engineer', active: true },
        access,
        { reason: 'shift need' },
      ),
    ).toBe(true)
  })

  it('2: draft recipe editable', () => {
    expect(canEditRecipeDraft(technologistUser)).toBe(true)
    const draftResult = createDraftRecipeVersion(baseFormulationStore(), {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 1,
          tolerancePct: 10,
        },
      ],
      actor: { id: technologistUser.id, name: technologistUser.displayName },
    })
    if ('error' in draftResult) {
      throw new Error(draftResult.error)
    }
    const updated = updateDraftRecipeVersion(draftResult.store, draftResult.version.id, {
      batchSize: 2,
    })
    expect('error' in updated).toBe(false)
    if ('error' in updated) {
      throw new Error(updated.error)
    }
    expect(updated.version.batchSize).toBe(2)
    expect(updated.version.contentHash).not.toBe(draftResult.version.contentHash)
  })

  it('3: approved recipe immutable', () => {
    const draftResult = createDraftRecipeVersion(baseFormulationStore(), {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 1,
          tolerancePct: 10,
        },
      ],
      actor: { id: technologistUser.id, name: technologistUser.displayName },
    })
    if ('error' in draftResult) {
      throw new Error(draftResult.error)
    }
    const approved = approveRecipeVersion(
      draftResult.store,
      draftResult.version.id,
      { id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId },
    )
    if ('error' in approved) {
      throw new Error(approved.error)
    }
    expect(updateDraftRecipeVersion(approved.store, approved.version.id, { note: 'x' })).toEqual({
      error: RECIPE_IMMUTABLE,
    })
  })

  it('4: approval ACL', () => {
    const draftResult = createDraftRecipeVersion(baseFormulationStore(), {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 1,
          tolerancePct: 10,
        },
      ],
      actor: { id: technologistUser.id, name: technologistUser.displayName },
    })
    if ('error' in draftResult) {
      throw new Error(draftResult.error)
    }
    expect(canApproveRecipeVersion(technologistUser)).toBe(false)
    expect(canApproveRecipeVersion(technologistUser, {} as AccessStore)).toBe(false)
    expect(
      canApproveRecipeVersion(technologistUser, {
        roleAllowRecipeApproval: { technologist: true },
      } as AccessStore),
    ).toBe(true)
    expect(canApproveRecipeVersion(directorUser)).toBe(true)
    expect(canApproveRecipeVersion(sysadminUser)).toBe(false)
    expect(canApproveRecipeVersion(sysadminUser, undefined, { reason: 'emergency' })).toBe(true)
    expect(
      approveRecipeVersion(
        draftResult.store,
        draftResult.version.id,
        { id: technologistUser.id, name: technologistUser.displayName, roleId: technologistUser.roleId },
      ),
    ).toEqual({ error: RECIPE_APPROVE_FORBIDDEN })

    const technologistApproved = approveRecipeVersion(
      draftResult.store,
      draftResult.version.id,
      { id: technologistUser.id, name: technologistUser.displayName, roleId: technologistUser.roleId },
      { roleAllowRecipeApproval: { technologist: true } } as AccessStore,
    )
    expect('error' in technologistApproved).toBe(false)
    if ('error' in technologistApproved) {
      throw new Error(technologistApproved.error)
    }
    expect(technologistApproved.version.status).toBe('approved')
    expect(technologistApproved.auditDetail).toContain('Approve recipe version')

    const directorDraft = createDraftRecipeVersion(baseFormulationStore(), {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 1,
          tolerancePct: 10,
        },
      ],
      actor: { id: directorUser.id, name: directorUser.displayName },
    })
    if ('error' in directorDraft) throw new Error(directorDraft.error)
    const directorApproved = approveRecipeVersion(
      directorDraft.store,
      directorDraft.version.id,
      { id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId },
    )
    expect('error' in directorApproved).toBe(false)

    const sysadminDraft = createDraftRecipeVersion(baseFormulationStore(), {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 1,
          tolerancePct: 10,
        },
      ],
      actor: { id: sysadminUser.id, name: sysadminUser.displayName },
    })
    if ('error' in sysadminDraft) {
      throw new Error(sysadminDraft.error)
    }
    expect(
      approveRecipeVersion(
        sysadminDraft.store,
        sysadminDraft.version.id,
        { id: sysadminUser.id, name: sysadminUser.displayName, roleId: sysadminUser.roleId },
      ),
    ).toEqual({ error: RECIPE_APPROVE_FORBIDDEN })
    const sysadminApproved = approveRecipeVersion(
      sysadminDraft.store,
      sysadminDraft.version.id,
      { id: sysadminUser.id, name: sysadminUser.displayName, roleId: sysadminUser.roleId },
      undefined,
      { reason: 'emergency approval' },
    )
    expect('error' in sysadminApproved).toBe(false)
    if ('error' in sysadminApproved) throw new Error(sysadminApproved.error)
    expect(sysadminApproved.auditDetail).toContain('Emergency approve')
    expect(sysadminApproved.auditDetail).toContain('emergency approval')
  })

  it('5: order snapshot unchanged after live recipe change', () => {
    const initial = buildApprovedSnapshot(1, 10)
    const order = sampleOrder(initial.snapshot)
    const before = computeNormQtyForOutput(order.recipeNormSnapshot!, 'item-rm', 10)!

    const draft2 = createDraftRecipeVersion(initial.store, {
      recipeId: 'recipe-1',
      normBase: 'per_m2',
      components: [
        {
          lineId: 'comp-rm',
          warehouseItemId: 'item-rm',
          itemCodeSnapshot: 'RM-1',
          itemNameSnapshot: 'Raw material',
          unitSnapshot: 'kg',
          normQty: 3,
          tolerancePct: 10,
        },
      ],
      actor: { id: technologistUser.id, name: technologistUser.displayName },
    })
    if ('error' in draft2) {
      throw new Error(draft2.error)
    }
    const approved2 = approveRecipeVersion(
      draft2.store,
      draft2.version.id,
      { id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId },
    )
    if ('error' in approved2) {
      throw new Error(approved2.error)
    }

    expect(order.recipeNormSnapshot?.recipeVersionId).toBe(initial.version.id)
    expect(order.recipeNormSnapshot?.contentHash).toBe(initial.snapshot.contentHash)
    expect(getApprovedRecipeVersion(approved2.store, 'recipe-1')?.id).toBe(approved2.version.id)
    expect(computeNormQtyForOutput(order.recipeNormSnapshot!, 'item-rm', 10)).toEqual(before)
  })

  it('6: legacy recipe not auto-approved', () => {
    const legacyStore = buildLegacyRecipeStore()
    expect(isLegacyUnapprovedRecipe(legacyStore, 'legacy-recipe')).toBe(true)
    expect(getApprovedRecipeVersion(legacyStore, 'legacy-recipe')).toBeUndefined()
    expect(
      captureLegacyNormSnapshot(
        legacyStore.recipes[0]!,
        { id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId },
        '',
      ),
    ).toEqual({ error: LEGACY_CAPTURE_REASON_REQUIRED })
  })

  it('7: master only assigned line', () => {
    const access = {
      workshopMasterProductionLines: { [masterUser.id]: ['1'] },
    } as AccessStore
    expect(
      canConfirmShiftReport(appScope, masterUser, '1', access),
    ).toBe(true)
    expect(
      canConfirmShiftReport(appScope, masterUser, '2', access),
    ).toBe(false)
    expect(
      canConfirmShiftReport(appScope, masterUser, 'pack', access),
    ).toBe(false)
  })

  it('8: warehouse keeper cannot change production fact', () => {
    const access = {
      workshopMasterProductionLines: { [masterUser.id]: ['1'] },
    } as AccessStore
    expect(canCreateShiftReport(warehouseKeeperUser)).toBe(false)
    expect(canConfirmShiftReport(appScope, warehouseKeeperUser, '1', access)).toBe(false)
    expect(canCorrectShiftReport(warehouseKeeperUser)).toBe(false)
    const fixture = transferToLineFixture()
    const keeperBlocked = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...fixture.report,
      actor: {
        id: warehouseKeeperUser.id,
        name: warehouseKeeperUser.displayName,
        roleId: warehouseKeeperUser.roleId,
      },
      idempotencyKey: 'keeper-fail',
    })
    expect(keeperBlocked.result.ok).toBe(false)
    expect(keeperBlocked.result.error).toBe('production.shift.errForbidden')
  })

  it('9: norm calculation from snapshot', () => {
    const { snapshot } = buildApprovedSnapshot(2, 15)
    const norm = computeNormQtyForOutput(snapshot, 'item-rm', 10)
    expect(norm).toEqual({
      normQty: 20,
      tolerancePct: 15,
      unitSnapshot: 'kg',
    })
  })

  it('10: deviation within tolerance', () => {
    const fixture = transferToLineFixture({ actualInputQty: 11, outputM2: 10, rollCount: 5 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 11,
          wasteQty: 0,
          processConsumedQty: 11,
          deviationQty: 0,
          deviationPct: 10,
          tolerancePct: 10,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'within-tolerance',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    expect(out.result.report?.materialLines[0]?.deviationReason).toBeUndefined()
  })

  it('11: deviation over tolerance requires reason', () => {
    const fixture = transferToLineFixture({ actualInputQty: 12, outputM2: 10, rollCount: 5 })
    const bad = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 12,
          wasteQty: 0,
          processConsumedQty: 12,
          deviationQty: 2,
          deviationPct: 20,
          tolerancePct: 10,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'over-tolerance',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe('production.shift.errDeviationReason')

    const ok = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 12,
          wasteQty: 0,
          processConsumedQty: 12,
          deviationQty: 2,
          deviationPct: 20,
          tolerancePct: 10,
          deviationReason: 'operator check',
        },
      ],
      wasteLines: [],
      idempotencyKey: 'over-tolerance-ok',
    })
    expect(ok.result.ok).toBe(true)
  })

  it('12: incompatible UoM blocks', () => {
    const fixture = transferToLineFixture({ inputUnit: 'l', actualInputQty: 10 })
    const bad = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          unitSnapshot: 'l',
          actualInputQty: 10,
          wasteQty: 0,
          processConsumedQty: 10,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'uom-block',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe('warehouse.reserve.errUnitMismatch')
  })

  it('13: FEFO and FIFO at line', () => {
    let warehouse = emptyWarehouse()
    warehouse = stockReceipt(warehouse, 5, {
      batchNo: 'SOON',
      expiryDate: '2026-10-01',
      createdAt: '2026-09-01T10:00:00.000Z',
    })
    warehouse = stockReceipt(warehouse, 5, {
      batchNo: 'LATE',
      expiryDate: '2026-12-01',
      createdAt: '2026-09-01T09:00:00.000Z',
    })
    const { snapshot } = buildApprovedSnapshot(1, 10)
    const order = sampleOrder(snapshot, { id: 'po-fefo', orderNumber: 'PO-FEFO' })
    registerOrder(order)
    warehouse = confirmProductionOrderReservation(warehouse, order).store
    warehouse = transferProductionMaterials(warehouse, {
      productionOrder: order,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 10 }],
      actor: { id: warehouseKeeperUser.id, name: warehouseKeeperUser.displayName, roleId: 'warehouse_keeper' },
      idempotencyKey: 'fefo-line',
    }).store

    const fefoFixture = {
      production: { requests: [], planner: { orders: [], nextOrderSeq: 1 }, shiftReports: [] } as ProductionStore,
      warehouse,
      order,
      report: {
        productionOrderId: order.id,
        lineId: '1',
        shiftDate: '2026-09-03',
        shift: 'day',
        recipeNormSnapshot: snapshot,
        productionLocationId: 'wh-line1',
        packagingLocationId: 'wh-pack',
        scrapLocationId: 'wh-scrap',
        materialLines: [
          {
            lineId: 'fefo',
            itemId: 'item-rm',
            unitSnapshot: 'kg',
            normQty: 10,
            actualInputQty: 10,
            wasteQty: 0,
            processConsumedQty: 10,
            deviationQty: 0,
            deviationPct: 0,
            tolerancePct: 10,
          } satisfies ShiftMaterialActualLine,
        ],
        wasteLines: [],
        outputM2: 10,
        rollCount: 5,
        m2PerRollSnapshot: 2,
        conversionTolerancePct: 10,
        semiFinishedItemId: 'item-sf',
        idempotencyKey: 'fefo-report',
        responsibleUserId: masterUser.id,
        responsibleNameSnapshot: masterUser.displayName,
        responsibleRoleSnapshot: masterUser.roleId,
        createdAt: '2026-09-03T11:00:00.000Z',
        updatedAt: '2026-09-03T11:00:00.000Z',
      } as ConfirmShiftReportInput['report'],
    }

    const fefo = confirmProductionShiftReport(fefoFixture.production, fefoFixture.warehouse, fefoFixture.report)
    expect(fefo.result.ok).toBe(true)
    expect(fefo.result.report?.materialLines[0]?.batchNo).toBe(
      computeLineMaterialBalances(fefo.warehouse, {
        productionOrderId: fefoFixture.order.id,
        productionWarehouseId: 'wh-line1',
        productionLocationId: 'wh-line1',
        lineId: '1',
        itemId: 'item-rm',
      })[0]?.batchNo,
    )

    let fifoWarehouse = emptyWarehouse()
    fifoWarehouse = stockReceipt(fifoWarehouse, 5, {
      batchNo: 'OLD',
      createdAt: '2026-01-01T10:00:00.000Z',
    })
    fifoWarehouse = stockReceipt(fifoWarehouse, 5, {
      batchNo: 'NEW',
      createdAt: '2026-06-01T10:00:00.000Z',
    })
    const { snapshot: fifoSnapshot } = buildApprovedSnapshot(1, 10)
    const fifoOrder = sampleOrder(fifoSnapshot, { id: 'po-fifo', orderNumber: 'PO-FIFO' })
    registerOrder(fifoOrder)
    fifoWarehouse = confirmProductionOrderReservation(fifoWarehouse, fifoOrder).store
    fifoWarehouse = transferProductionMaterials(fifoWarehouse, {
      productionOrder: fifoOrder,
      rawWarehouseId: 'wh-raw',
      lines: [{ itemId: 'item-rm', quantity: 10 }],
      actor: { id: warehouseKeeperUser.id, name: warehouseKeeperUser.displayName, roleId: 'warehouse_keeper' },
      idempotencyKey: 'fifo-line',
    }).store
    const fifo = confirmProductionShiftReport(
      { requests: [], planner: { orders: [], nextOrderSeq: 1 }, shiftReports: [] },
      fifoWarehouse,
      {
        productionOrderId: fifoOrder.id,
        lineId: '1',
        shiftDate: '2026-09-03',
        shift: 'day',
        recipeNormSnapshot: fifoSnapshot,
        productionLocationId: 'wh-line1',
        packagingLocationId: 'wh-pack',
        scrapLocationId: 'wh-scrap',
        materialLines: [
          {
            lineId: 'fifo',
            itemId: 'item-rm',
            unitSnapshot: 'kg',
            normQty: 10,
            actualInputQty: 10,
            wasteQty: 0,
            processConsumedQty: 10,
            deviationQty: 0,
            deviationPct: 0,
            tolerancePct: 10,
          } satisfies ShiftMaterialActualLine,
        ],
        wasteLines: [],
        outputM2: 10,
        rollCount: 5,
        m2PerRollSnapshot: 2,
        conversionTolerancePct: 10,
        semiFinishedItemId: 'item-sf',
        idempotencyKey: 'fifo-report',
        responsibleUserId: masterUser.id,
        responsibleNameSnapshot: masterUser.displayName,
        responsibleRoleSnapshot: masterUser.roleId,
        createdAt: '2026-09-03T11:00:00.000Z',
        updatedAt: '2026-09-03T11:00:00.000Z',
      } as ConfirmShiftReportInput['report'],
    )
    expect(fifo.result.ok).toBe(true)
    expect(fifo.result.report?.materialLines[0]?.batchNo).toBe(
      computeLineMaterialBalances(fifo.warehouse, {
        productionOrderId: fifoOrder.id,
        productionWarehouseId: 'wh-line1',
        productionLocationId: 'wh-line1',
        lineId: '1',
        itemId: 'item-rm',
      })[0]?.batchNo,
    )
  })

  it('14: manual lot override requires reason', () => {
    const fixture = transferToLineFixture({ batchNo: 'MANUAL', actualInputQty: 10, outputM2: 10 })
    const bad = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          batchNo: 'MANUAL',
          batchOverrideReason: undefined,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'manual-lot',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe('warehouse.reserve.errBatchOverrideReason')

    const ok = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          batchNo: 'MANUAL',
          batchOverrideReason: 'QC hold release',
        },
      ],
      wasteLines: [],
      idempotencyKey: 'manual-lot-ok',
    })
    expect(ok.result.ok).toBe(true)
  })

  it('15: insufficient at-line stock leaves stores unchanged', () => {
    const fixture = transferToLineFixture({ transferQty: 2, actualInputQty: 10, outputM2: 10 })
    const productionBefore = JSON.parse(JSON.stringify(fixture.production)) as ProductionStore
    const warehouseBefore = JSON.parse(JSON.stringify(fixture.warehouse)) as WarehouseStore
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 10,
          processConsumedQty: 5,
          wasteQty: 0,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'insufficient-line',
    })
    expect(out.result.ok).toBe(false)
    expect(out.result.error).toBe('production.shift.errInsufficientAtLine')
    expect(out.production).toEqual(productionBefore)
    expect(out.warehouse).toEqual(warehouseBefore)
  })

  it('16: confirmation is idempotent', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const first = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'idem-confirm',
    })
    expect(first.result.ok).toBe(true)
    if (!first.result.ok) {
      throw new Error(first.result.error)
    }
    const second = confirmProductionShiftReport(first.production, first.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'idem-confirm',
    })
    expect(second.result.ok).toBe(true)
    expect(second.result.idempotent).toBe(true)
    expect(second.production.shiftReports?.length).toBe(first.production.shiftReports?.length)
    expect(second.warehouse.documents.length).toBe(first.warehouse.documents.length)
  })

  it('17: consumption movement has document line order report batch', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10, wasteQty: 0 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'consumption-meta',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    const consumption = out.warehouse.documents.find((d) => d.purpose === 'production_consumption')
    expect(consumption).toBeTruthy()
    expect(consumption?.lines[0]?.lineId).toBeTruthy()
    expect(consumption?.productionOrderId).toBe(fixture.order.id)
    expect(consumption?.shiftReportId).toBe(out.result.report?.id)
    expect(consumption?.lines[0]?.batchNo).toBe('SOON')
    const movement = out.warehouse.movements.find((m) => m.documentId === consumption?.id)
    expect(movement?.productionOrderId).toBe(fixture.order.id)
    expect(movement?.shiftReportId).toBe(out.result.report?.id)
    expect(movement?.transactionGroupId).toBe(out.result.report?.transactionGroupId)
  })

  it('18: WIP receipt uses stable item ID and m2', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      outputM2: 10,
      idempotencyKey: 'wip-item',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    const wip = out.warehouse.documents.find((d) => d.purpose === 'production_wip_receipt')
    expect(wip?.warehouseId).toBe('wh-pack')
    expect(wip?.lines[0]?.itemId).toBe('item-sf')
    expect(wip?.lines[0]?.unitSnapshot).toBe('m2')
    expect(wip?.lines[0]?.quantity).toBe(10)
  })

  it('19: rolls conversion validation', () => {
    const fixture = transferToLineFixture({
      actualInputQty: 8,
      outputM2: 8,
      rollCount: 5,
      conversionTolerancePct: 5,
    })
    const bad = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      outputM2: 8,
      rollCount: 5,
      idempotencyKey: 'rolls-conversion',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe('production.shift.errConversion')

    const ok = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      outputM2: 8,
      rollCount: 5,
      conversionDeviationReason: 'measured deviation accepted',
      idempotencyKey: 'rolls-conversion-ok',
    })
    expect(ok.result.ok).toBe(true)
  })

  it('20: WIP not available as finished goods or shipment', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'wip-availability',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    expect(isItemAvailableAsFinishedGoods(out.warehouse, 'item-sf', 'wh-pack')).toBe(false)
    expect(assertNotShippingWip(out.warehouse, 'item-sf', 'wh-pack')).toEqual({
      ok: false,
      error: 'production.shift.errWipNotShippable',
    })
  })

  it('21: waste transfer does not double-write consumption', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, wasteQty: 2, outputM2: 10 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 10,
          wasteQty: 2,
          processConsumedQty: 8,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
        },
      ],
      wasteLines: [
        {
          lineId: 'w1',
          itemId: 'item-rm',
          quantity: 2,
          unitSnapshot: 'kg',
          reasonCode: 'trim',
          comment: 'scrap transfer',
        },
      ],
      idempotencyKey: 'no-double-write',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    const consumption = out.warehouse.documents.find((d) => d.purpose === 'production_consumption')
    const wasteIssue = out.warehouse.documents.find(
      (d) => d.purpose === 'production_waste_transfer' && d.docRole === 'production_waste_issue',
    )
    expect(consumption?.lines[0]?.quantity).toBe(8)
    expect(wasteIssue?.lines[0]?.quantity).toBe(2)
    expect((consumption?.lines[0]?.quantity ?? 0) + (wasteIssue?.lines[0]?.quantity ?? 0)).toBe(10)
    expect(out.result.report?.materialLines[0]?.processConsumedQty).toBe(8)
  })

  it('22: waste reason required', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, wasteQty: 2, outputM2: 10 })
    const bad = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 10,
          wasteQty: 2,
          processConsumedQty: 8,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
        },
      ],
      wasteLines: [
        {
          lineId: 'w1',
          itemId: 'item-rm',
          quantity: 2,
          unitSnapshot: 'kg',
          reasonCode: '',
          comment: '',
        },
      ],
      idempotencyKey: 'waste-reason',
    })
    expect(bad.result.ok).toBe(false)
    expect(bad.result.error).toBe('production.shift.errWasteReason')
  })

  it('23: remaining material stays assigned to order and line', () => {
    const fixture = transferToLineFixture({ actualInputQty: 9, wasteQty: 1, outputM2: 10 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 9,
          wasteQty: 1,
          processConsumedQty: 8,
          deviationQty: -1,
          deviationPct: -10,
          tolerancePct: 10,
        },
      ],
      wasteLines: [
        {
          lineId: 'w1',
          itemId: 'item-rm',
          quantity: 1,
          unitSnapshot: 'kg',
          reasonCode: 'trim',
          comment: 'line remainder',
        },
      ],
      idempotencyKey: 'remaining-assigned',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    const rows = computeLineMaterialBalances(out.warehouse, {
      productionOrderId: fixture.order.id,
      productionWarehouseId: 'wh-line1',
      productionLocationId: 'wh-line1',
      lineId: '1',
      itemId: 'item-rm',
    })
    expect(rows[0]?.productionOrderId).toBe(fixture.order.id)
    expect(rows[0]?.lineId).toBe('1')
    expect(rows[0]?.remainingQty).toBe(2)
    expect(rows[0]?.batchNo).toBe('SOON')
  })

  it('24: confirmed report immutable', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const out = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'immutable-check',
    })
    expect(out.result.ok).toBe(true)
    if (!out.result.ok) {
      throw new Error(out.result.error)
    }
    expect(isShiftReportImmutable(out.result.report!)).toBe(true)
  })

  it('25: correction creates addendum and reversal docs', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, wasteQty: 0, outputM2: 10 })
    const original = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 10,
          wasteQty: 0,
          processConsumedQty: 10,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
        },
      ],
      wasteLines: [],
      idempotencyKey: 'corr-original',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'original',
      }),
    })
    expect(original.result.ok).toBe(true)
    if (!original.result.ok) {
      throw new Error(original.result.error)
    }
    const corrected = confirmShiftReportCorrection(original.production, original.warehouse, {
      report: {
        ...original.result.report!,
        id: undefined,
        number: undefined,
      } as ConfirmShiftReportInput['report'],
      productionOrder: fixture.order,
      actor: { id: directorUser.id, name: directorUser.displayName, roleId: directorUser.roleId },
      appScope,
      idempotencyKey: 'corr-second',
      originalReportId: original.result.report!.id,
      correctionReason: 'recount and adjustment',
    })
    expect(corrected.result.ok).toBe(true)
    if (!corrected.result.ok) {
      throw new Error(corrected.result.error)
    }
    expect(corrected.production.shiftReports?.length).toBe(2)
    expect(corrected.result.report?.correctsReportId).toBe(original.result.report!.id)
    expect(corrected.result.report?.correctionReason).toBe('recount and adjustment')
    expect(
      corrected.warehouse.documents.some((d) => d.reversesDocumentId === original.result.report?.consumptionDocumentId),
    ).toBe(true)
    expect(
      corrected.warehouse.documents.some((d) => d.basisType === 'production_shift_report_correction'),
    ).toBe(true)
  })

  it('26: whole confirmation atomic locally', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, wasteQty: 2, outputM2: 10 })
    const productionBefore = JSON.parse(JSON.stringify(fixture.production)) as ProductionStore
    const warehouseBefore = JSON.parse(JSON.stringify(fixture.warehouse)) as WarehouseStore
    const failed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      outputM2: 0,
      rollCount: 0,
      wasteLines: [
        {
          lineId: 'w1',
          itemId: 'item-rm',
          quantity: 2,
          unitSnapshot: 'kg',
          reasonCode: 'trim',
          comment: 'atomic fail',
        },
      ],
      materialLines: [
        {
          ...fixture.report.materialLines[0]!,
          actualInputQty: 10,
          wasteQty: 2,
          processConsumedQty: 8,
          deviationQty: 0,
          deviationPct: 0,
          tolerancePct: 10,
        },
      ],
      idempotencyKey: 'atomic-fail',
    })
    expect(failed.result.ok).toBe(false)
    expect(failed.production).toEqual(productionBefore)
    expect(failed.warehouse).toEqual(warehouseBefore)
  })

  it('27: cloud conflict rejects whole group', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const confirmed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'cloud-conflict-base',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'group-27',
      }),
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) {
      throw new Error(confirmed.result.error)
    }

    const currentReport = confirmed.result.report!
    const nextReport = {
      ...currentReport,
      outputM2: currentReport.outputM2,
      rollCount: currentReport.rollCount,
    } satisfies ProductionShiftReport

    const prevStore: AppStore = makeRemoteAppStoreWithShiftReport(currentReport)
    const nextStore: AppStore = makeRemoteAppStoreWithShiftReport(nextReport)
    const groupId = warehouseTransactionGroupId({
      kind: 'production_shift_report',
      sourceId: fixture.order.id,
      revision: 'group-27',
    })
    const ops = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op-report-1',
          type: 'update',
          domain: 'production.shiftReports',
          entityId: currentReport.id,
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op-doc-1',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-1',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
      ] satisfies DirtyOperation[],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_shift_report',
        atomic: true,
      },
      nextStore,
      prevStore,
    )

    const remoteConflict: AppStore = {
      ...prevStore,
      production: {
        ...prevStore.production,
        shiftReports: [
          {
            ...currentReport,
            number: 'REMOTE-DIFFERENT',
          },
        ],
      },
    }
    expect(classifyAtomicGroupAgainstRemote(ops, remoteConflict)).toBe('conflict')
  })

  it('28: subset ack fail-closed', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const confirmed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'ack-fail-closed',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'group-28',
      }),
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) {
      throw new Error(confirmed.result.error)
    }
    const currentReport = confirmed.result.report!
    const groupId = warehouseTransactionGroupId({
      kind: 'production_shift_report',
      sourceId: fixture.order.id,
      revision: 'group-28',
    })
    const ops = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op-a',
          type: 'update',
          domain: 'production.shiftReports',
          entityId: currentReport.id,
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op-b',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-b',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
      ] satisfies DirtyOperation[],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_shift_report',
        atomic: true,
      },
      makeRemoteAppStoreWithShiftReport(currentReport),
      makeRemoteAppStoreWithShiftReport(currentReport),
    )

    const ack = sanitizeAcknowledgeIds(ops, ['op-a'])
    expect(ack.safeIds).toEqual([])
    expect(ack.blockedGroupIds).toContain(groupId)
  })

  it('29: durable journal preserves complete group', async () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const confirmed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'journal-group',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'group-29',
      }),
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) {
      throw new Error(confirmed.result.error)
    }
    const currentReport = confirmed.result.report!
    const groupId = warehouseTransactionGroupId({
      kind: 'production_shift_report',
      sourceId: fixture.order.id,
      revision: 'group-29',
    })
    const ops = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op-j1',
          type: 'update',
          domain: 'production.shiftReports',
          entityId: currentReport.id,
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op-j2',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-j2',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
      ] satisfies DirtyOperation[],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_shift_report',
        transactionGroupLabel: 'shift report',
        atomic: true,
      },
      makeRemoteAppStoreWithShiftReport(currentReport),
      makeRemoteAppStoreWithShiftReport(currentReport),
    )

    expect(shouldPersistOperationToJournal(ops[0]!)).toBe(true)

    const adapter = createMemoryDurableJournalAdapter()
    const scopeKey = 'project::uid::store::v6'
    await adapter.upsert(dirtyOpToJournalRecord(ops[0]!, scopeKey, 'pending'))
    await adapter.upsert(dirtyOpToJournalRecord(ops[1]!, scopeKey, 'pending'))

    const records = await adapter.list(scopeKey)
    expect(records).toHaveLength(2)
    expect(records.every((r) => r.transactionGroupId === groupId)).toBe(true)
    expect(records.every((r) => r.transactionGroupKind === 'production_shift_report')).toBe(true)
    expect(records.every((r) => r.atomic === true)).toBe(true)
    expect(journalRecordToDirtyOp(records[0]!).transactionGroupId).toBe(groupId)
  })

  it('30: diff excludes employees months and timesheets', () => {
    const fixture = transferToLineFixture({ actualInputQty: 10, outputM2: 10 })
    const confirmed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'diff-scope',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'group-30',
      }),
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) {
      throw new Error(confirmed.result.error)
    }
    const currentReport = confirmed.result.report!
    const groupId = warehouseTransactionGroupId({
      kind: 'production_shift_report',
      sourceId: fixture.order.id,
      revision: 'group-30',
    })
    const ops = stampOpsWithTransactionGroup(
      [
        {
          operationId: 'op-d1',
          type: 'update',
          domain: 'production.shiftReports',
          entityId: currentReport.id,
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
        {
          operationId: 'op-d2',
          type: 'create',
          domain: 'warehouse.documents',
          entityId: 'doc-d2',
          fields: ['*'],
          baseRevision: 1,
          origin: 'user',
        },
      ] satisfies DirtyOperation[],
      {
        transactionGroupId: groupId,
        transactionGroupKind: 'production_shift_report',
        atomic: true,
      },
      makeRemoteAppStoreWithShiftReport(currentReport),
      makeRemoteAppStoreWithShiftReport(currentReport),
    )
    const domains = new Set(ops.map((op) => op.domain))
    expect(domains.has('production.shiftReports')).toBe(true)
    expect(domains.has('warehouse.documents')).toBe(true)
    expect(domains.has('employees')).toBe(false)
    expect(domains.has('months')).toBe(false)
    expect(domains.has('timesheetEntries')).toBe(false)
  })

  it('31: shift report print model uses snapshots and document numbers', () => {
    const fixture = transferToLineFixture({
      actualInputQty: 10,
      wasteQty: 1,
      outputM2: 10,
      rollCount: 5,
    })
    const confirmed = confirmProductionShiftReport(fixture.production, fixture.warehouse, {
      ...(fixture.report as ConfirmShiftReportInput['report']),
      idempotencyKey: 'print-model',
      transactionGroupId: warehouseTransactionGroupId({
        kind: 'production_shift_report',
        sourceId: fixture.order.id,
        revision: 'print',
      }),
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok || !confirmed.result.report) {
      throw new Error(confirmed.result.error ?? 'confirm failed')
    }
    const report = confirmed.result.report
    const model = withCorrectsReportNumber(
      buildShiftReportPrintModel(report, {
        order: fixture.order,
        warehouse: confirmed.warehouse,
      }),
      [report],
      report.correctsReportId,
    )
    expect(model.number).toBe(report.number)
    expect(model.shiftDate).toBe(report.shiftDate)
    expect(model.lineId).toBe(report.lineId)
    expect(model.productionOrderNumber).toBe(fixture.order.orderNumber)
    expect(model.recipeVersionId).toBe(report.recipeNormSnapshot.recipeVersionId)
    expect(model.recipeContentHash).toBe(report.recipeNormSnapshot.contentHash)
    expect(model.materialLines[0]?.normQty).toBe(report.materialLines[0]?.normQty)
    expect(model.materialLines[0]?.actualInputQty).toBe(10)
    expect(model.outputM2).toBe(10)
    expect(model.rollCount).toBe(5)
    expect(model.semiFinishedItemId).toBe(report.semiFinishedItemId)
    expect(model.consumptionDocumentNumber).toBeTruthy()
    expect(model.wipReceiptDocumentNumber).toBeTruthy()
    expect(model.wasteDocumentNumbers.length).toBeGreaterThan(0)
    expect(model.electronicSignatures[0]?.at).toBe(report.confirmedAt)
    expect(model.manualSignatureSlots).toEqual(['master', 'warehouse', 'director'])
    expect(model.isCorrection).toBe(false)
  })
})

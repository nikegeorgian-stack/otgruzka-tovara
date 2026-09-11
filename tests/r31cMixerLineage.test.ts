/**
 * R3.1C — mixer output keeps stable task/order/line lineage through G2 warehouse posting.
 */
import { describe, expect, it } from 'vitest'
import {
  batchLineageFromMixTask,
  buildBatchMixConfirmCommand,
  confirmBatchMix,
  createPendingBatchMix,
} from '@/lib/formulations/batch'
import type { FormulationBatchRun, FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { applyBatchMixConfirmCritical } from '../server/fst/_g2BatchMixConfirm.mjs'

const DATE = '2026-09-10'
const WAREHOUSE_ID = 'wh-main'
const TASK_ID = 'mix-task-c'
const ORDER_ID = 'production-order-c'
const LINE_ID = 'line-1'

type LineageRecord = {
  batchRunId?: string
  batchNo?: string
  mixTaskId?: string
  productionOrderId?: string
  productionLineId?: string
}

function recipe(): FormulationRecipe {
  return {
    id: 'recipe-c',
    code: 'РП-0003',
    name: 'Celloplex 160',
    category: '160',
    currency: 'GEL',
    active: true,
    components: [
      {
        id: 'component-1',
        name: 'Component 1',
        weightKg: 10,
        warehouseItemId: 'item-input',
      },
    ],
    outputWarehouseItemId: 'item-impregnation',
    totalBatchKg: 10,
    createdAt: `${DATE}T00:00:00.000Z`,
    updatedAt: `${DATE}T00:00:00.000Z`,
  }
}

function warehouse(): WarehouseStore {
  return {
    locations: [
      { id: WAREHOUSE_ID, name: 'Основной', sortOrder: 1 },
      { id: 'line-wh', name: 'Склад линии', sortOrder: 2 },
      { id: 'line-loc', name: 'Линия 1', sortOrder: 3 },
    ],
    categories: [],
    items: [
      {
        id: 'item-input',
        internalCode: 'FC-000001',
        name: 'Component 1',
        categoryId: '',
        warehouseId: WAREHOUSE_ID,
        unit: 'кг',
        active: true,
        sortOrder: 1,
      },
      {
        id: 'item-impregnation',
        internalCode: 'FC-000002',
        name: 'Celloplex impregnation',
        categoryId: '',
        warehouseId: WAREHOUSE_ID,
        unit: 'кг',
        active: true,
        sortOrder: 2,
      },
    ],
    documents: [],
    invoiceRegistry: [],
    movements: [
      {
        id: 'seed-input',
        itemId: 'item-input',
        warehouseId: WAREHOUSE_ID,
        type: 'receipt',
        quantity: 10,
        date: DATE,
        createdAt: `${DATE}T00:00:00.000Z`,
      },
    ],
    auditLog: [],
    nextInternalCode: 3,
    accountingByWarehouse: [
      { id: 'accounting-main', warehouseId: WAREHOUSE_ID, status: 'active' },
      { id: 'accounting-line', warehouseId: 'line-wh', status: 'active' },
    ],
    productionLineBindings: [
      {
        lineId: LINE_ID,
        productionWarehouseId: 'line-wh',
        productionLocationId: 'line-loc',
      },
    ],
  }
}

function formulations(): FormulationStore {
  return {
    recipes: [recipe()],
    pigmentPastes: [],
    nextRecipeCode: 4,
    batchRuns: [],
  }
}

function createLinkedPending() {
  const lineage = batchLineageFromMixTask({
    id: TASK_ID,
    sourceOrderId: ORDER_ID,
    lineId: LINE_ID,
  })
  return createPendingBatchMix(formulations(), warehouse(), {
    recipeId: 'recipe-c',
    targetVolumeL: 10,
    warehouseId: WAREHOUSE_ID,
    mixedAt: DATE,
    mixedBy: 'mixer-1',
    mixedByName: 'Mixer',
    ...lineage,
  })
}

function expectLineage(record: LineageRecord, batchRunId: string) {
  expect(record).toEqual(
    expect.objectContaining({
      batchRunId,
      mixTaskId: TASK_ID,
      productionOrderId: ORDER_ID,
      productionLineId: LINE_ID,
    }),
  )
}

describe('R3.1C mixer lineage', () => {
  it('copies exact selected-task IDs into the pending run and G2 command', () => {
    expect(batchLineageFromMixTask(null)).toEqual({})
    expect(
      batchLineageFromMixTask({ id: TASK_ID, sourceOrderId: ORDER_ID, lineId: LINE_ID }),
    ).toEqual({
      mixTaskId: TASK_ID,
      productionOrderId: ORDER_ID,
      productionLineId: LINE_ID,
    })

    const pending = createLinkedPending()
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return

    const run = pending.result.run
    expect(run).toEqual(
      expect.objectContaining({
        mixTaskId: TASK_ID,
        productionOrderId: ORDER_ID,
        productionLineId: LINE_ID,
      }),
    )

    const command = buildBatchMixConfirmCommand(run, recipe())
    expect(command.documentNumber).toBe(run.documentNumber)
    expect(command.recipeId).toBe('recipe-c')
    expectLineage(command, run.id)
    expect(command.issueLines).not.toHaveLength(0)
    for (const line of command.issueLines) expectLineage(line, run.id)
    expect(command.receiptLines).toHaveLength(1)
    expectLineage(command.receiptLines[0]!, run.id)
    expect(command.receiptLines[0]!.batchNo).toBe(run.documentNumber)
  })

  it('stamps local receipt and all mixer movements while preserving source-lot semantics', () => {
    const pending = createLinkedPending()
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return
    const run = pending.result.run

    const confirmed = confirmBatchMix(pending.formulations, pending.warehouse, {
      runId: run.id,
      keeperId: 'keeper-1',
      keeperName: 'Keeper',
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) return

    const issue = confirmed.warehouse.documents.find((d) => d.docRole === 'batch_issue')
    const receipt = confirmed.warehouse.documents.find((d) => d.docRole === 'batch_receipt')
    expect(issue).toBeDefined()
    expect(receipt).toBeDefined()
    expectLineage(issue as LineageRecord, run.id)
    expectLineage(receipt as LineageRecord, run.id)
    expect((receipt as LineageRecord).batchNo).toBe(run.documentNumber)
    expectLineage(receipt!.lines[0] as LineageRecord, run.id)
    expect(receipt!.lines[0]!.batchNo).toBe(run.documentNumber)

    const mixerMovements = confirmed.warehouse.movements.filter(
      (movement) => movement.documentId === issue!.id || movement.documentId === receipt!.id,
    )
    expect(mixerMovements).toHaveLength(2)
    for (const movement of mixerMovements) expectLineage(movement as LineageRecord, run.id)
    const issueMovement = mixerMovements.find((movement) => movement.documentId === issue!.id)
    const receiptMovement = mixerMovements.find((movement) => movement.documentId === receipt!.id)
    expect(issueMovement?.batchNo).not.toBe(run.documentNumber)
    expect(receiptMovement?.batchNo).toBe(run.documentNumber)
  })

  it('stamps authoritative G2 documents, lines and movements and replays idempotently', () => {
    const pending = createLinkedPending()
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return
    const run = pending.result.run
    const command = buildBatchMixConfirmCommand(run, recipe())
    command.receiptLines[0]!.batchNo = 'client-supplied-wrong-batch'
    const now = `${DATE}T12:00:00.000Z`

    const first = applyBatchMixConfirmCritical(
      pending.warehouse,
      command,
      { uid: 'keeper-1', email: 'keeper@example.test' },
      now,
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const issue = first.warehouse.documents.find((d) => d.id === first.result.issueDocumentId)
    const receipt = first.warehouse.documents.find((d) => d.id === first.result.receiptDocumentId)
    expect(issue).toBeDefined()
    expect(receipt).toBeDefined()
    if (!issue || !receipt) return
    expectLineage(issue as LineageRecord, run.id)
    expectLineage(receipt as LineageRecord, run.id)
    expect((receipt as LineageRecord).batchNo).toBe(run.documentNumber)
    expectLineage(issue.lines[0] as LineageRecord, run.id)
    expectLineage(receipt.lines[0] as LineageRecord, run.id)
    expect(receipt.lines[0].batchNo).toBe(run.documentNumber)

    const mixerMovements = first.warehouse.movements.filter(
      (movement) => movement.documentId === issue.id || movement.documentId === receipt.id,
    )
    expect(mixerMovements).toHaveLength(2)
    for (const movement of mixerMovements) expectLineage(movement, run.id)
    expect(
      mixerMovements.find((movement) => movement.documentId === issue.id)?.batchNo,
    ).not.toBe(run.documentNumber)
    expect(
      mixerMovements.find((movement) => movement.documentId === receipt.id)?.batchNo,
    ).toBe(run.documentNumber)

    const replay = applyBatchMixConfirmCritical(
      first.warehouse,
      command,
      { uid: 'keeper-1', email: 'keeper@example.test' },
      now,
    )
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.result.idempotentHint).toBe(true)
    expect(replay.result.documentIds).toEqual(first.result.documentIds)
    expect(replay.warehouse.documents).toHaveLength(first.warehouse.documents.length)
    expect(replay.warehouse.movements).toHaveLength(first.warehouse.movements.length)
  })

  it('keeps free mixes compatible while assigning their canonical output batch', () => {
    const pending = createPendingBatchMix(formulations(), warehouse(), {
      recipeId: 'recipe-c',
      targetVolumeL: 10,
      warehouseId: WAREHOUSE_ID,
      mixedAt: DATE,
      mixedBy: 'mixer-1',
      mixedByName: 'Mixer',
    })
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return

    const run: FormulationBatchRun = pending.result.run
    expect(run.mixTaskId).toBeUndefined()
    expect(run.productionOrderId).toBeUndefined()
    expect(run.productionLineId).toBeUndefined()

    const command = buildBatchMixConfirmCommand(run)
    expect(command.mixTaskId).toBeUndefined()
    expect(command.productionOrderId).toBeUndefined()
    expect(command.productionLineId).toBeUndefined()
    expect(command.receiptLines[0]?.batchNo).toBe(run.documentNumber)
  })
})

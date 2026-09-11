import type { Locale } from '@/i18n/types'
import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { postWarehouseDocumentsAtomic } from '@/lib/warehouse/documents'
import { computeAllBalances, validateIssueLines } from '@/lib/warehouse/stock'
import { warehouseIdempotencyKey } from '@/lib/warehouse/stockSafety'
import { resolveProductionLineLocation } from '@/lib/warehouse/productionLineLocationConfig'
import type { WarehouseStore } from '@/lib/warehouse/types'
import {
  componentConsumeKg,
  isFormulationWaterComponent,
  recipeTotalBatchKg,
} from './calc'
import { formulationColorLabel } from './types'
import {
  allocateFormulationInternalCode,
  parseFormulationInternalCodeNum,
} from './init'
import { syncFormulationRecipeWarehouse, formulationRecipeDisplayName } from './warehouseSync'
import { batchMixCommandFingerprint } from './batchMixFingerprint.mjs'
import type {
  FormulationBatchLine,
  FormulationBatchRun,
  FormulationMixTask,
  FormulationRecipe,
  FormulationStore,
} from './types'

export type ScaledBatchPlan = {
  recipe: FormulationRecipe
  targetVolumeL: number
  baseVolumeL: number
  scaleFactor: number
  lines: FormulationBatchLine[]
  outputKg: number
  /** Достаточно остатков без ухода в минус */
  stockOk: boolean
  /** Можно провести замес (остатки OK или разрешён минус без блокирующих ошибок) */
  mixAllowed: boolean
  /** Нехватка по складу — предупреждение при разрешённом минусе */
  stockShortages: string[]
  /** Блокирующие проблемы (нет привязки, нет выхода и т.д.) */
  blockingShortages: string[]
  /** Все сообщения для обратной совместимости */
  shortages: string[]
}

export type PlanFormulationBatchOptions = {
  allowNegativeStock?: boolean
}

export type PostBatchMixOptions = {
  allowNegativeStock?: boolean
}

export type PostBatchMixInput = {
  recipeId: string
  targetVolumeL: number
  warehouseId: string
  mixedAt: string
  mixedBy: string
  mixedByName: string
  /** Optional for a free mix; otherwise copied from the selected mixer task. */
  mixTaskId?: string
  productionOrderId?: string
  productionLineId?: string
  shiftBrigade?: string
  shiftNote?: string
  comment?: string
}

/** Exact stable lineage copied from a selected task; a free mix has no lineage. */
export function batchLineageFromMixTask(
  task: Pick<FormulationMixTask, 'id' | 'sourceOrderId' | 'lineId'> | null | undefined,
): Pick<PostBatchMixInput, 'mixTaskId' | 'productionOrderId' | 'productionLineId'> {
  if (!task) return {}
  return {
    mixTaskId: task.id,
    ...(task.sourceOrderId ? { productionOrderId: task.sourceOrderId } : {}),
    ...(task.lineId ? { productionLineId: task.lineId } : {}),
  }
}

export type PostBatchMixResult =
  | { ok: true; run: FormulationBatchRun }
  | { ok: false; error: string }

function nextBatchNumber(runs: FormulationBatchRun[], date: string): string {
  const compact = date.replace(/-/g, '')
  const prefix = `ЗМ-${compact}-`
  const sameDay = runs.filter((r) => r.documentNumber.startsWith(prefix))
  const maxSeq = sameDay.reduce((max, r) => {
    const n = parseInt(r.documentNumber.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

/** Масштабирование рецепта на целевой объём куба (л) */
export function planFormulationBatch(
  recipe: FormulationRecipe,
  warehouse: WarehouseStore,
  targetVolumeL: number,
  warehouseId?: string,
  options?: PlanFormulationBatchOptions,
): ScaledBatchPlan {
  const allowNegativeStock = options?.allowNegativeStock === true
  const baseVolumeL = recipeTotalBatchKg(recipe) || 1000
  const scaleFactor =
    targetVolumeL > 0 && baseVolumeL > 0 ? targetVolumeL / baseVolumeL : 1

  const lines: FormulationBatchLine[] = []
  const blockingShortages: string[] = []
  const stockShortages: string[] = []

  for (const c of recipe.components) {
    const baseKg = componentConsumeKg(c)
    if (baseKg <= 0) continue
    // R2.9I: water with warehouseItemId is issued like other components;
    // unbound process water stays off the warehouse plan.
    if (isFormulationWaterComponent(c) && !c.warehouseItemId) continue
    const consumeKg = Math.round(baseKg * scaleFactor * 1000) / 1000
    if (!c.warehouseItemId) {
      blockingShortages.push(`${c.name}: не привязан к складу`)
      continue
    }
    lines.push({
      componentId: c.id,
      name: c.name,
      warehouseItemId: c.warehouseItemId,
      consumeKg,
    })
  }

  const balances = computeAllBalances(warehouse, warehouseId)
  for (const line of lines) {
    const avail = balances.get(line.warehouseItemId)?.available ?? 0
    if (avail < line.consumeKg - 1e-6) {
      stockShortages.push(
        `${line.name}: нужно ${line.consumeKg} кг, на складе ${Math.round(avail * 1000) / 1000} кг`,
      )
    }
  }

  for (const c of recipe.components) {
    if (isFormulationWaterComponent(c) && !c.warehouseItemId) continue
    const consume = componentConsumeKg(c)
    if (consume > 0 && !c.warehouseItemId) {
      blockingShortages.push(`${c.name}: нет позиции склада`)
    }
  }

  if (!recipe.outputWarehouseItemId) {
    blockingShortages.push('Готовая пропитка не связана со складом — сохраните рецепт')
  }

  if (!(targetVolumeL > 0)) {
    blockingShortages.push('Укажите объём партии в литрах (больше 0)')
  }

  const outputKg = Math.round(targetVolumeL * 1000) / 1000
  const stockOk = stockShortages.length === 0
  const mixAllowed =
    blockingShortages.length === 0 &&
    lines.length > 0 &&
    (stockOk || allowNegativeStock)

  return {
    recipe,
    targetVolumeL,
    baseVolumeL,
    scaleFactor,
    lines,
    outputKg,
    stockOk,
    mixAllowed,
    stockShortages,
    blockingShortages,
    shortages: [...blockingShortages, ...stockShortages],
  }
}

export type ConfirmBatchInput = {
  runId: string
  keeperId?: string
  keeperName?: string
}

/**
 * Замес куба: создаёт ЗАЯВКУ на подтверждение кладовщиком.
 * Склад НЕ меняется (балансы не трогаются) до подтверждения — только
 * проверяется выполнимость и фиксируется снимок плана + внутренний код.
 */
export function createPendingBatchMix(
  formulations: FormulationStore,
  warehouse: WarehouseStore,
  input: PostBatchMixInput,
  locale: Locale = 'ru',
  options?: PostBatchMixOptions,
): { formulations: FormulationStore; warehouse: WarehouseStore; result: PostBatchMixResult } {
  const allowNegativeStock = options?.allowNegativeStock === true
  const recipe = formulations.recipes.find((r) => r.id === input.recipeId && r.active)
  if (!recipe) {
    return { formulations, warehouse, result: { ok: false, error: 'recipe_not_found' } }
  }

  // Привязка готовой пропитки к складской позиции (создаём определение позиции,
  // балансы при этом не меняются).
  let syncedRecipe = recipe
  let wh = warehouse
  if (!recipe.outputWarehouseItemId) {
    const synced = syncFormulationRecipeWarehouse(recipe, wh, locale)
    syncedRecipe = synced.recipe
    wh = {
      ...wh,
      items: wh.items.some((i) => i.id === synced.outputItem.id)
        ? wh.items.map((i) => (i.id === synced.outputItem.id ? synced.outputItem : i))
        : [...wh.items, synced.outputItem],
    }
  }

  const plan = planFormulationBatch(syncedRecipe, wh, input.targetVolumeL, input.warehouseId, {
    allowNegativeStock,
  })
  if (!plan.mixAllowed) {
    const err = plan.blockingShortages[0] ?? plan.stockShortages[0] ?? 'insufficient_stock'
    return { formulations, warehouse: wh, result: { ok: false, error: err } }
  }

  const outputId = syncedRecipe.outputWarehouseItemId!
  const docNo = nextBatchNumber(formulations.batchRuns ?? [], input.mixedAt)
  const batchRunId = crypto.randomUUID()
  const internalCode = allocateFormulationInternalCode({ ...formulations, batchRuns: formulations.batchRuns ?? [] })

  const colorLabel = syncedRecipe.colorVariant
    ? formulationColorLabel(syncedRecipe.colorVariant, locale)
    : undefined

  const run: FormulationBatchRun = {
    id: batchRunId,
    documentNumber: docNo,
    ...(input.mixTaskId ? { mixTaskId: input.mixTaskId } : {}),
    ...(input.productionOrderId ? { productionOrderId: input.productionOrderId } : {}),
    ...(input.productionLineId ? { productionLineId: input.productionLineId } : {}),
    internalCode,
    status: 'pending',
    recipeId: syncedRecipe.id,
    recipeCode: syncedRecipe.code,
    recipeName: syncedRecipe.name,
    variantCode: syncedRecipe.variantCode,
    colorVariant: syncedRecipe.colorVariant,
    grammageGsm: syncedRecipe.grammageGsm,
    targetVolumeL: input.targetVolumeL,
    scaleFactor: plan.scaleFactor,
    lines: plan.lines,
    outputWarehouseItemId: outputId,
    outputKg: plan.outputKg,
    warehouseId: input.warehouseId,
    mixedAt: input.mixedAt,
    mixedBy: input.mixedBy,
    mixedByName: input.mixedByName,
    shiftBrigade: input.shiftBrigade,
    shiftNote: input.shiftNote,
    comment: input.comment,
    labelSnapshot: {
      productTitle: formulationRecipeDisplayName(syncedRecipe),
      labelText: syncedRecipe.labelText,
      colorLabel,
      grammageGsm: syncedRecipe.grammageGsm,
      variantCode: syncedRecipe.variantCode,
    },
    createdAt: new Date().toISOString(),
  }

  wh = appendWarehouseAudit(wh, {
    action: 'batch_mix',
    detail: `Заявка на замес ${docNo} · ${syncedRecipe.code} · куб ${input.targetVolumeL} л · ожидает подтверждения кладовщиком`,
    batchRunId,
    actorId: input.mixedBy,
    actorName: input.mixedByName,
  })

  const recipes = formulations.recipes.map((r) =>
    r.id === syncedRecipe.id ? syncedRecipe : r,
  )

  const nextInternalCode = parseFormulationInternalCodeNum(internalCode) + 1

  return {
    formulations: {
      ...formulations,
      recipes,
      batchRuns: [...(formulations.batchRuns ?? []), run],
      nextInternalCode,
    },
    warehouse: wh,
    result: { ok: true, run },
  }
}

/**
 * Кладовщик ПОДТВЕРЖДАЕТ замес: проводит списание сырья и приход готовой
 * пропитки на склад. Только теперь меняются балансы.
 */
export function confirmBatchMix(
  formulations: FormulationStore,
  warehouse: WarehouseStore,
  input: ConfirmBatchInput,
  options?: PostBatchMixOptions,
): { formulations: FormulationStore; warehouse: WarehouseStore; result: PostBatchMixResult } {
  void options // W0: allowNegativeStock ignored — stock safety is mandatory in post core.
  const run = (formulations.batchRuns ?? []).find((r) => r.id === input.runId)
  if (!run) {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_found' } }
  }
  if ((run.status ?? 'confirmed') !== 'pending') {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_pending' } }
  }

  const hasAnyLineage = Boolean(
    run.mixTaskId || run.productionOrderId || run.productionLineId,
  )
  let receiptWarehouseId = run.warehouseId
  let receiptLocationId: string | undefined
  if (hasAnyLineage) {
    if (!run.mixTaskId || !run.productionOrderId || !run.productionLineId) {
      return { formulations, warehouse, result: { ok: false, error: 'mixer_lineage_incomplete' } }
    }
    const route = resolveProductionLineLocation(warehouse, run.productionLineId)
    if (!route.ok) {
      return { formulations, warehouse, result: { ok: false, error: route.error } }
    }
    receiptWarehouseId = route.productionWarehouseId
    receiptLocationId = route.productionLocationId
  }

  const lineage = {
    batchRunId: run.id,
    ...(run.mixTaskId ? { mixTaskId: run.mixTaskId } : {}),
    ...(run.productionOrderId ? { productionOrderId: run.productionOrderId } : {}),
    ...(run.productionLineId ? { productionLineId: run.productionLineId } : {}),
  }
  const issueLines = run.lines.map((l) => ({
    itemId: l.warehouseItemId,
    quantity: l.consumeKg,
    ...lineage,
  }))
  const receiptLines = [
    {
      itemId: run.outputWarehouseItemId,
      quantity: run.outputKg,
      batchNo: run.documentNumber,
      ...(receiptLocationId ? { locationId: receiptLocationId } : {}),
      ...lineage,
    },
  ]

  const balances = computeAllBalances(warehouse, run.warehouseId)
  const check = validateIssueLines(warehouse.items, balances, issueLines)
  if (!check.ok) {
    const msg = check.shortages.map((s) => `${s.name}: ${s.requested} / ${s.available}`).join('; ')
    return { formulations, warehouse, result: { ok: false, error: msg || 'insufficient_stock' } }
  }

  const issueNo = `${run.documentNumber}-Р`
  const receiptNo = `${run.documentNumber}-П`
  const mixComment = [
    `Замес куб · ${run.recipeCode}`,
    `${run.targetVolumeL} л`,
    run.shiftBrigade,
    run.mixedByName,
  ]
    .filter(Boolean)
    .join(' · ')

  const atomic = postWarehouseDocumentsAtomic(warehouse, [
    {
      type: 'issue',
      number: issueNo,
      date: run.mixedAt,
      warehouseId: run.warehouseId,
      brigade: run.shiftBrigade,
      comment: `Накладная списания · ${mixComment}`,
      lines: issueLines,
      batchRunId: run.id,
      mixTaskId: run.mixTaskId,
      productionOrderId: run.productionOrderId,
      productionLineId: run.productionLineId,
      docRole: 'batch_issue',
      skipAudit: true,
      skipFieldValidation: true,
      idempotencyKey: warehouseIdempotencyKey({
        source: 'batchRun',
        sourceId: run.id,
        role: 'batch_issue',
        warehouseId: run.warehouseId,
      }),
    },
    {
      type: 'receipt',
      number: receiptNo,
      date: run.mixedAt,
      warehouseId: receiptWarehouseId,
      brigade: run.shiftBrigade,
      comment: `Оприходование пропитки · ${mixComment} · код ${run.internalCode ?? '—'}`,
      lines: receiptLines,
      batchRunId: run.id,
      mixTaskId: run.mixTaskId,
      productionOrderId: run.productionOrderId,
      productionLineId: run.productionLineId,
      docRole: 'batch_receipt',
      skipAudit: true,
      skipFieldValidation: true,
      idempotencyKey: warehouseIdempotencyKey({
        source: 'batchRun',
        sourceId: run.id,
        role: 'batch_receipt',
        warehouseId: receiptWarehouseId,
      }),
    },
  ])

  if (!atomic.result.ok) {
    return {
      formulations,
      warehouse,
      result: {
        ok: false,
        error: atomic.result.error === 'warehouse.doc.errInsufficientStock'
          ? 'insufficient_stock'
          : atomic.result.error,
      },
    }
  }

  const issueDocId = atomic.result.documentIds[0]!
  const receiptDocId = atomic.result.documentIds[1]!

  const batchDocumentIds = new Set([issueDocId, receiptDocId])
  const linkedWarehouse: WarehouseStore = {
    ...atomic.store,
    documents: atomic.store.documents.map((document) =>
      document.id === receiptDocId
        ? {
            ...document,
            batchNo: run.documentNumber,
          }
        : document,
    ),
    movements: atomic.store.movements.map((movement) =>
      movement.documentId && batchDocumentIds.has(movement.documentId)
        ? {
            ...movement,
            batchRunId: run.id,
            ...(run.mixTaskId ? { mixTaskId: run.mixTaskId } : {}),
            ...(run.productionOrderId ? { productionOrderId: run.productionOrderId } : {}),
            ...(run.productionLineId ? { productionLineId: run.productionLineId } : {}),
          }
        : movement,
    ),
  }

  const wh = appendWarehouseAudit(linkedWarehouse, {
    action: 'batch_mix',
    detail: `Подтверждён замес ${run.documentNumber} · списание ${issueNo} · приход ${receiptNo}${input.keeperName ? ` · кладовщик ${input.keeperName}` : ''}`,
    batchRunId: run.id,
    actorId: input.keeperId,
    actorName: input.keeperName,
  })

  const confirmedRun: FormulationBatchRun = {
    ...run,
    status: 'confirmed',
    issueDocumentId: issueDocId,
    receiptDocumentId: receiptDocId,
    confirmedAt: new Date().toISOString(),
    confirmedBy: input.keeperId,
    confirmedByName: input.keeperName,
  }

  return {
    formulations: {
      ...formulations,
      batchRuns: (formulations.batchRuns ?? []).map((r) => (r.id === run.id ? confirmedRun : r)),
    },
    warehouse: wh,
    result: { ok: true, run: confirmedRun },
  }
}

/** Payload for G2 `warehouse.batchMix.confirm` (critical CAS). */
export function buildBatchMixConfirmCommand(
  run: FormulationBatchRun,
  recipe?: FormulationRecipe | null,
): {
  batchRunId: string
  recipeId: string
  documentNumber: string
  warehouseId: string
  date: string
  issueNumber: string
  receiptNumber: string
  mixTaskId?: string
  productionOrderId?: string
  productionLineId?: string
  issueLines: Array<{
    itemId: string
    quantity: number
    batchRunId: string
    recipeId: string
    mixTaskId?: string
    productionOrderId?: string
    productionLineId?: string
  }>
  receiptLines: Array<{
    itemId: string
    quantity: number
    batchNo: string
    batchRunId: string
    recipeId: string
    mixTaskId?: string
    productionOrderId?: string
    productionLineId?: string
  }>
  comment: string
} {
  const lineage = {
    batchRunId: run.id,
    recipeId: run.recipeId,
    ...(run.mixTaskId ? { mixTaskId: run.mixTaskId } : {}),
    ...(run.productionOrderId ? { productionOrderId: run.productionOrderId } : {}),
    ...(run.productionLineId ? { productionLineId: run.productionLineId } : {}),
  }
  const mixComment = [
    `Замес куб · ${run.recipeCode}`,
    `${run.targetVolumeL} л`,
    run.shiftBrigade,
    run.mixedByName,
  ]
    .filter(Boolean)
    .join(' · ')
  const issueLines = run.lines.map((l) => ({
    itemId: l.warehouseItemId,
    quantity: l.consumeKg,
    ...lineage,
  }))
  // Orphan / legacy pending runs may omit linked warehouse water — append from recipe.
  if (recipe) {
    const scale = run.scaleFactor > 0 ? run.scaleFactor : 1
    for (const c of recipe.components) {
      if (!isFormulationWaterComponent(c) || !c.warehouseItemId) continue
      if (issueLines.some((l) => l.itemId === c.warehouseItemId)) continue
      const qty = Math.round(componentConsumeKg(c) * scale * 1000) / 1000
      if (qty > 0) issueLines.push({ itemId: c.warehouseItemId, quantity: qty, ...lineage })
    }
  }
  return {
    batchRunId: run.id,
    recipeId: run.recipeId,
    documentNumber: run.documentNumber,
    warehouseId: run.warehouseId,
    date: run.mixedAt,
    issueNumber: `${run.documentNumber}-Р`,
    receiptNumber: `${run.documentNumber}-П`,
    ...(run.mixTaskId ? { mixTaskId: run.mixTaskId } : {}),
    ...(run.productionOrderId ? { productionOrderId: run.productionOrderId } : {}),
    ...(run.productionLineId ? { productionLineId: run.productionLineId } : {}),
    issueLines,
    receiptLines: [
      {
        itemId: run.outputWarehouseItemId,
        quantity: run.outputKg,
        batchNo: run.documentNumber,
        ...lineage,
      },
    ],
    comment: mixComment,
  }
}

/** Enrich G2 batch-mix lines with catalogue snapshots for items missing in critical. */
export function withBatchMixCatalogueSnapshots(
  command: ReturnType<typeof buildBatchMixConfirmCommand>,
  warehouseItems: Array<{
    id: string
    name?: string
    unit?: string
    internalCode?: string
    sku?: string
    categoryId?: string
    barcode?: string
    active?: boolean
  }>,
): ReturnType<typeof buildBatchMixConfirmCommand> {
  const byId = new Map(warehouseItems.map((i) => [i.id, i]))
  const stamp = <T extends { itemId: string }>(line: T) => {
    const item = byId.get(line.itemId)
    if (!item) return line
    return {
      ...line,
      itemNameSnapshot: item.name,
      unitSnapshot: item.unit,
      itemCodeSnapshot: item.internalCode,
      skuSnapshot: item.sku,
      categoryIdSnapshot: item.categoryId,
      barcodeSnapshot: item.barcode,
      activeSnapshot: item.active !== false,
    }
  }
  return {
    ...command,
    issueLines: command.issueLines.map(stamp),
    receiptLines: command.receiptLines.map(stamp),
  }
}

type BatchMixAckRecord = Record<string, unknown>

function batchMixAckId(value: unknown): string {
  return String(value ?? '').trim()
}

function aggregateBatchMixAckLines(lines: unknown): Map<string, number> | null {
  if (!Array.isArray(lines) || lines.length === 0) return null
  const out = new Map<string, number>()
  for (const raw of lines) {
    const line = raw as BatchMixAckRecord
    const itemId = batchMixAckId(line.itemId)
    const quantity = Number(line.quantity)
    if (!itemId || !Number.isFinite(quantity) || quantity <= 0) return null
    out.set(itemId, Math.round(((out.get(itemId) ?? 0) + quantity) * 1e6) / 1e6)
  }
  return out
}

function batchMixAckQuantitiesEqual(
  actual: Map<string, number> | null,
  expected: Map<string, number> | null,
): boolean {
  if (!actual || !expected || actual.size !== expected.size) return false
  for (const [itemId, quantity] of expected) {
    const actualQuantity = actual.get(itemId)
    if (actualQuantity == null || Math.abs(actualQuantity - quantity) > 1e-6) return false
  }
  return true
}

function batchMixAckLineageMatches(
  record: BatchMixAckRecord,
  run: FormulationBatchRun,
): boolean {
  return (
    batchMixAckId(record.batchRunId) === run.id &&
    batchMixAckId(record.recipeId) === run.recipeId &&
    batchMixAckId(record.mixTaskId) === batchMixAckId(run.mixTaskId) &&
    batchMixAckId(record.productionOrderId) === batchMixAckId(run.productionOrderId) &&
    batchMixAckId(record.productionLineId) === batchMixAckId(run.productionLineId)
  )
}

/**
 * Validate the complete authoritative G2 acknowledgement before changing a
 * pending local run to confirmed. IDs or a toast alone are not an ack.
 */
export function validateBatchMixAuthoritativeAck(
  run: FormulationBatchRun,
  command: ReturnType<typeof buildBatchMixConfirmCommand>,
  data: unknown,
  previousCriticalRevision = 0,
):
  | { ok: true; issueDocumentId: string; receiptDocumentId: string }
  | { ok: false; error: 'batch_mix_authoritative_ack_invalid' } {
  const ack = (data && typeof data === 'object' ? data : {}) as BatchMixAckRecord
  const criticalRevision = Number(ack.criticalRevision)
  const priorRevision = Math.max(0, Number(previousCriticalRevision) || 0)
  const issueDocumentId = batchMixAckId(ack.issueDocumentId)
  const receiptDocumentId = batchMixAckId(ack.receiptDocumentId)
  if (
    !Number.isInteger(criticalRevision) ||
    criticalRevision <= 0 ||
    criticalRevision < priorRevision ||
    (criticalRevision === priorRevision && ack.idempotent !== true) ||
    !issueDocumentId ||
    !receiptDocumentId ||
    issueDocumentId === receiptDocumentId ||
    batchMixAckId(ack.commandFingerprint) !== batchMixCommandFingerprint(command)
  ) {
    return { ok: false, error: 'batch_mix_authoritative_ack_invalid' }
  }

  const warehouse = (ack.warehouse && typeof ack.warehouse === 'object'
    ? ack.warehouse
    : {}) as BatchMixAckRecord
  const documents = Array.isArray(warehouse.documents)
    ? (warehouse.documents as BatchMixAckRecord[])
    : []
  const movements = Array.isArray(warehouse.movements)
    ? (warehouse.movements as BatchMixAckRecord[])
    : []
  const runDocuments = documents.filter(
    (document) => batchMixAckId(document.batchRunId) === run.id,
  )
  const issueMatches = runDocuments.filter(
    (document) => document.id === issueDocumentId && document.docRole === 'batch_issue',
  )
  const receiptMatches = runDocuments.filter(
    (document) => document.id === receiptDocumentId && document.docRole === 'batch_receipt',
  )
  if (
    runDocuments.length !== 2 ||
    issueMatches.length !== 1 ||
    receiptMatches.length !== 1 ||
    !Array.isArray(ack.documentIds) ||
    ack.documentIds.length !== 2 ||
    new Set(ack.documentIds.map(batchMixAckId)).size !== 2 ||
    !ack.documentIds.map(batchMixAckId).includes(issueDocumentId) ||
    !ack.documentIds.map(batchMixAckId).includes(receiptDocumentId) ||
    ack.status !== 'posted'
  ) {
    return { ok: false, error: 'batch_mix_authoritative_ack_invalid' }
  }
  const issueDocument = issueMatches[0]!
  const receiptDocument = receiptMatches[0]!
  if (
    !batchMixAckLineageMatches(issueDocument, run) ||
    !batchMixAckLineageMatches(receiptDocument, run) ||
    issueDocument.status !== 'posted' ||
    receiptDocument.status !== 'posted' ||
    issueDocument.cancelled === true ||
    receiptDocument.cancelled === true ||
    issueDocument.type !== 'issue' ||
    receiptDocument.type !== 'receipt' ||
    issueDocument.purpose !== 'production' ||
    receiptDocument.purpose !== 'production' ||
    batchMixAckId(issueDocument.number) !== command.issueNumber ||
    batchMixAckId(receiptDocument.number) !== command.receiptNumber ||
    batchMixAckId(issueDocument.date).slice(0, 10) !== command.date.slice(0, 10) ||
    batchMixAckId(receiptDocument.date).slice(0, 10) !== command.date.slice(0, 10) ||
    batchMixAckId(issueDocument.warehouseId) !== command.warehouseId ||
    batchMixAckId(receiptDocument.warehouseId) !== batchMixAckId(ack.receiptWarehouseId) ||
    batchMixAckId(receiptDocument.batchNo) !== command.documentNumber
  ) {
    return { ok: false, error: 'batch_mix_authoritative_ack_invalid' }
  }

  const expectedIssues = aggregateBatchMixAckLines(command.issueLines)
  const documentIssues = aggregateBatchMixAckLines(issueDocument.lines)
  const issueDocumentLines = Array.isArray(issueDocument.lines)
    ? (issueDocument.lines as BatchMixAckRecord[])
    : []
  const receiptCommandLine = command.receiptLines[0]
  const receiptDocumentLines = Array.isArray(receiptDocument.lines)
    ? (receiptDocument.lines as BatchMixAckRecord[])
    : []
  const receiptDocumentLine = receiptDocumentLines[0]
  const issueDocumentLineIds = issueDocumentLines.map((line) => batchMixAckId(line.lineId))
  if (
    !batchMixAckQuantitiesEqual(documentIssues, expectedIssues) ||
    issueDocumentLineIds.some((lineId) => !lineId) ||
    new Set(issueDocumentLineIds).size !== issueDocumentLineIds.length ||
    issueDocumentLines.some((line) => !batchMixAckLineageMatches(line, run)) ||
    command.receiptLines.length !== 1 ||
    receiptDocumentLines.length !== 1 ||
    !receiptCommandLine ||
    !receiptDocumentLine ||
    batchMixAckId(receiptDocumentLine.itemId) !== receiptCommandLine.itemId ||
    !Number.isFinite(Number(receiptDocumentLine.quantity)) ||
    Number(receiptDocumentLine.quantity) <= 0 ||
    Math.abs(Number(receiptDocumentLine.quantity) - receiptCommandLine.quantity) > 1e-6 ||
    !batchMixAckId(receiptDocumentLine.lineId) ||
    batchMixAckId(receiptDocumentLine.batchNo) !== command.documentNumber ||
    batchMixAckId(receiptDocument.batchNo) !== command.documentNumber ||
    !batchMixAckLineageMatches(receiptDocumentLine, run) ||
    (run.productionLineId &&
      batchMixAckId(receiptDocumentLine.locationId) !== batchMixAckId(ack.receiptLocationId))
  ) {
    return { ok: false, error: 'batch_mix_authoritative_ack_invalid' }
  }

  const issueMovements = movements.filter(
    (movement) => movement.documentId === issueDocumentId && movement.type === 'issue',
  )
  const receiptMovements = movements.filter(
    (movement) => movement.documentId === receiptDocumentId && movement.type === 'receipt',
  )
  const runMovements = movements.filter(
    (movement) => batchMixAckId(movement.batchRunId) === run.id,
  )
  const documentMovements = movements.filter(
    (movement) =>
      movement.documentId === issueDocumentId || movement.documentId === receiptDocumentId,
  )
  const unexpectedRunMovements = runMovements.filter(
    (movement) =>
      !(
        (movement.documentId === issueDocumentId && movement.type === 'issue') ||
        (movement.documentId === receiptDocumentId && movement.type === 'receipt')
      ),
  )
  const movementIssues = aggregateBatchMixAckLines(issueMovements)
  const receiptMovement = receiptMovements[0]
  const issueLinesById = new Map(
    issueDocumentLines.map((line) => [batchMixAckId(line.lineId), line] as const),
  )
  const issueMovementQtyByLineId = new Map<string, number>()
  let issueMovementTupleMismatch = false
  for (const movement of issueMovements) {
    const documentLineId = batchMixAckId(movement.documentLineId)
    const documentLine = issueLinesById.get(documentLineId)
    if (
      !documentLine ||
      batchMixAckId(movement.itemId) !== batchMixAckId(documentLine.itemId) ||
      batchMixAckId(movement.warehouseId) !== command.warehouseId ||
      batchMixAckId(movement.date).slice(0, 10) !== command.date.slice(0, 10) ||
      (batchMixAckId(documentLine.batchNo) &&
        batchMixAckId(movement.batchNo) !== batchMixAckId(documentLine.batchNo)) ||
      (batchMixAckId(documentLine.locationId) &&
        batchMixAckId(movement.locationId) !== batchMixAckId(documentLine.locationId))
    ) {
      issueMovementTupleMismatch = true
      break
    }
    issueMovementQtyByLineId.set(
      documentLineId,
      Math.round(
        ((issueMovementQtyByLineId.get(documentLineId) ?? 0) + Number(movement.quantity)) *
          1e6,
      ) / 1e6,
    )
  }
  const issueLineMovementMismatch = issueDocumentLines.some((line) => {
    const lineId = batchMixAckId(line.lineId)
    const moved = issueMovementQtyByLineId.get(lineId)
    return moved == null || Math.abs(moved - Number(line.quantity)) > 1e-6
  })
  if (
    !batchMixAckQuantitiesEqual(movementIssues, expectedIssues) ||
    unexpectedRunMovements.length !== 0 ||
    runMovements.some(
      (movement) =>
        movement.cancelled === true ||
        !Number.isFinite(Number(movement.quantity)) ||
        Number(movement.quantity) <= 0,
    ) ||
    issueMovementTupleMismatch ||
    issueLineMovementMismatch ||
    receiptMovements.length !== 1 ||
    !receiptMovement ||
    runMovements.length !== issueMovements.length + receiptMovements.length ||
    documentMovements.length !== issueMovements.length + receiptMovements.length ||
    [...issueMovements, receiptMovement].some(
      (movement) => !batchMixAckLineageMatches(movement, run),
    ) ||
    batchMixAckId(receiptMovement.itemId) !== receiptCommandLine.itemId ||
    Math.abs(Number(receiptMovement.quantity) - receiptCommandLine.quantity) > 1e-6 ||
    batchMixAckId(receiptMovement.documentLineId) !==
      batchMixAckId(receiptDocumentLine.lineId) ||
    batchMixAckId(receiptMovement.warehouseId) !== batchMixAckId(ack.receiptWarehouseId) ||
    batchMixAckId(receiptMovement.batchNo) !== command.documentNumber ||
    batchMixAckId(receiptMovement.date).slice(0, 10) !== command.date.slice(0, 10) ||
    (run.productionLineId &&
      batchMixAckId(receiptMovement.locationId) !== batchMixAckId(ack.receiptLocationId)) ||
    Number(ack.movementsCount) !== issueMovements.length + receiptMovements.length
  ) {
    return { ok: false, error: 'batch_mix_authoritative_ack_invalid' }
  }

  return { ok: true, issueDocumentId, receiptDocumentId }
}

export type BatchMixWarehouseLedgerState = 'absent' | 'complete' | 'partial'

/** Classify posted batch_issue / batch_receipt pair for a run (orphan recovery guard). */
export function classifyBatchMixWarehouseState(
  warehouse: WarehouseStore,
  batchRunId: string,
): {
  state: BatchMixWarehouseLedgerState
  issueDocumentId?: string
  receiptDocumentId?: string
  issueMovementCount: number
  receiptMovementCount: number
} {
  const issue = (warehouse.documents ?? []).find(
    (d) => d.batchRunId === batchRunId && d.docRole === 'batch_issue' && d.status === 'posted',
  )
  const receipt = (warehouse.documents ?? []).find(
    (d) => d.batchRunId === batchRunId && d.docRole === 'batch_receipt' && d.status === 'posted',
  )
  const issueMovementCount = issue
    ? (warehouse.movements ?? []).filter((m) => m.documentId === issue.id && m.type === 'issue').length
    : 0
  const receiptMovementCount = receipt
    ? (warehouse.movements ?? []).filter((m) => m.documentId === receipt.id && m.type === 'receipt')
        .length
    : 0
  if (issue && receipt && issueMovementCount > 0 && receiptMovementCount > 0) {
    return {
      state: 'complete',
      issueDocumentId: issue.id,
      receiptDocumentId: receipt.id,
      issueMovementCount,
      receiptMovementCount,
    }
  }
  if (issue || receipt || issueMovementCount > 0 || receiptMovementCount > 0) {
    return {
      state: 'partial',
      issueDocumentId: issue?.id,
      receiptDocumentId: receipt?.id,
      issueMovementCount,
      receiptMovementCount,
    }
  }
  return { state: 'absent', issueMovementCount: 0, receiptMovementCount: 0 }
}

/** Attach warehouse doc IDs after authoritative critical post (no local warehouse mutate). */
export function attachBatchMixConfirmedDocs(
  formulations: FormulationStore,
  input: ConfirmBatchInput & {
    issueDocumentId: string
    receiptDocumentId: string
    /** Orphan recovery: run may already be confirmed without ledger docs. */
    allowAlreadyConfirmed?: boolean
  },
): { formulations: FormulationStore; result: PostBatchMixResult } {
  const run = (formulations.batchRuns ?? []).find((r) => r.id === input.runId)
  if (!run) {
    return { formulations, result: { ok: false, error: 'batch_not_found' } }
  }
  const status = run.status ?? 'confirmed'
  if (status === 'pending' || (input.allowAlreadyConfirmed && status === 'confirmed')) {
    const confirmedRun: FormulationBatchRun = {
      ...run,
      status: 'confirmed',
      issueDocumentId: input.issueDocumentId,
      receiptDocumentId: input.receiptDocumentId,
      confirmedAt: run.confirmedAt ?? new Date().toISOString(),
      confirmedBy: input.keeperId ?? run.confirmedBy,
      confirmedByName: input.keeperName ?? run.confirmedByName,
    }
    return {
      formulations: {
        ...formulations,
        batchRuns: (formulations.batchRuns ?? []).map((r) => (r.id === run.id ? confirmedRun : r)),
      },
      result: { ok: true, run: confirmedRun },
    }
  }
  return { formulations, result: { ok: false, error: 'batch_not_pending' } }
}

/** Кладовщик ОТКЛОНЯЕТ заявку на замес (склад не затрагивается). */
export function rejectBatchMix(
  formulations: FormulationStore,
  warehouse: WarehouseStore,
  input: ConfirmBatchInput & { reason?: string },
): { formulations: FormulationStore; warehouse: WarehouseStore; result: PostBatchMixResult } {
  const run = (formulations.batchRuns ?? []).find((r) => r.id === input.runId)
  if (!run) {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_found' } }
  }
  if ((run.status ?? 'confirmed') !== 'pending') {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_pending' } }
  }

  const rejectedRun: FormulationBatchRun = {
    ...run,
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedByName: input.keeperName,
    rejectReason: input.reason?.trim() || undefined,
  }

  const wh = appendWarehouseAudit(warehouse, {
    action: 'batch_mix',
    detail: `Отклонена заявка на замес ${run.documentNumber}${input.reason ? ` · причина: ${input.reason}` : ''}${input.keeperName ? ` · кладовщик ${input.keeperName}` : ''}`,
    batchRunId: run.id,
    actorId: input.keeperId,
    actorName: input.keeperName,
  })

  return {
    formulations: {
      ...formulations,
      batchRuns: (formulations.batchRuns ?? []).map((r) => (r.id === run.id ? rejectedRun : r)),
    },
    warehouse: wh,
    result: { ok: true, run: rejectedRun },
  }
}

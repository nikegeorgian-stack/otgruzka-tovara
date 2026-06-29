import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { postWarehouseDocument } from '@/lib/warehouse/documents'
import { computeAllBalances, validateIssueLines } from '@/lib/warehouse/stock'
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
import type {
  FormulationBatchLine,
  FormulationBatchRun,
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
  shiftBrigade?: string
  shiftNote?: string
  comment?: string
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
    if (isFormulationWaterComponent(c)) continue
    const baseKg = componentConsumeKg(c)
    if (baseKg <= 0) continue
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
    if (isFormulationWaterComponent(c)) continue
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
  locale: 'ru' | 'ka' = 'ru',
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
  const allowNegativeStock = options?.allowNegativeStock === true
  const run = (formulations.batchRuns ?? []).find((r) => r.id === input.runId)
  if (!run) {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_found' } }
  }
  if ((run.status ?? 'confirmed') !== 'pending') {
    return { formulations, warehouse, result: { ok: false, error: 'batch_not_pending' } }
  }

  let wh = warehouse
  const issueLines = run.lines.map((l) => ({ itemId: l.warehouseItemId, quantity: l.consumeKg }))

  if (!allowNegativeStock) {
    const balances = computeAllBalances(wh, run.warehouseId)
    const check = validateIssueLines(wh.items, balances, issueLines)
    if (!check.ok) {
      const msg = check.shortages.map((s) => `${s.name}: ${s.requested} / ${s.available}`).join('; ')
      return { formulations, warehouse: wh, result: { ok: false, error: msg || 'insufficient_stock' } }
    }
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

  wh = postWarehouseDocument(wh, {
    type: 'issue',
    number: issueNo,
    date: run.mixedAt,
    warehouseId: run.warehouseId,
    brigade: run.shiftBrigade,
    comment: `Накладная списания · ${mixComment}`,
    lines: issueLines,
    batchRunId: run.id,
    docRole: 'batch_issue',
    skipAudit: true,
    skipValidation: true,
  }).store
  const issueDoc = wh.documents[wh.documents.length - 1]!

  wh = postWarehouseDocument(wh, {
    type: 'receipt',
    number: receiptNo,
    date: run.mixedAt,
    warehouseId: run.warehouseId,
    brigade: run.shiftBrigade,
    comment: `Оприходование пропитки · ${mixComment} · код ${run.internalCode ?? '—'}`,
    lines: [{ itemId: run.outputWarehouseItemId, quantity: run.outputKg }],
    batchRunId: run.id,
    docRole: 'batch_receipt',
    skipAudit: true,
    skipValidation: true,
  }).store
  const receiptDoc = wh.documents[wh.documents.length - 1]!

  wh = appendWarehouseAudit(wh, {
    action: 'batch_mix',
    detail: `Подтверждён замес ${run.documentNumber} · списание ${issueNo} · приход ${receiptNo}${input.keeperName ? ` · кладовщик ${input.keeperName}` : ''}`,
    batchRunId: run.id,
    actorId: input.keeperId,
    actorName: input.keeperName,
  })

  const confirmedRun: FormulationBatchRun = {
    ...run,
    status: 'confirmed',
    issueDocumentId: issueDoc.id,
    receiptDocumentId: receiptDoc.id,
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

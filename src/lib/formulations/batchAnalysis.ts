import {
  componentConsumeKg,
  isFormulationWaterComponent,
  recipeTotalBatchKg,
} from './calc'
import type {
  FormulationBatchLine,
  FormulationBatchRun,
  FormulationComponent,
  FormulationRecipe,
} from './types'
import { resolveItemUnitPrice } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'

export type NormFactLine = {
  componentId: string
  name: string
  warehouseItemId?: string
  /** Норма по рецепту (масштабированная), кг */
  normKg: number
  /** Факт (замес), кг — null если только план */
  factKg: number | null
  /** fact − norm */
  deltaKg: number | null
  /** (fact − norm) / norm * 100 */
  variancePct: number | null
}

export type BatchCostLine = {
  componentId: string
  name: string
  consumeKg: number
  pricePerKg: number | null
  cost: number | null
}

export type BatchCostSummary = {
  currency: string
  lines: BatchCostLine[]
  totalCost: number | null
  outputKg: number
  costPerKg: number | null
  missingPrices: number
}

export type BatchAnalysis = {
  scaleFactor: number
  baseVolumeL: number
  targetVolumeL: number
  lines: NormFactLine[]
  maxAbsVariancePct: number | null
  cost: BatchCostSummary
}

/** Пороги отклонения факта от нормы, % */
export const VARIANCE_WARN_PCT = 5
export const VARIANCE_CRIT_PCT = 10

export type VarianceLevel = 'ok' | 'warn' | 'crit'

export function varianceLevel(variancePct: number | null | undefined): VarianceLevel | null {
  if (variancePct == null || !Number.isFinite(variancePct)) return null
  const abs = Math.abs(variancePct)
  if (abs >= VARIANCE_CRIT_PCT) return 'crit'
  if (abs >= VARIANCE_WARN_PCT) return 'warn'
  return 'ok'
}

export function varianceLevelClass(level: VarianceLevel | null): string {
  if (level === 'crit') return 'text-red-700 font-semibold'
  if (level === 'warn') return 'text-amber-700 font-medium'
  if (level === 'ok') return 'text-teal-800'
  return ''
}

/** Цена за кг по id складской позиции (средняя из приходов → цена карточки). */
export type PriceLookup = (warehouseItemId: string | undefined) => number | null

export function warehousePriceLookup(warehouse: WarehouseStore): PriceLookup {
  return (warehouseItemId) => {
    if (!warehouseItemId) return null
    return resolveItemUnitPrice(warehouse, warehouseItemId)
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function scaleFactorForVolume(recipe: FormulationRecipe, targetVolumeL: number): number {
  const base = recipeTotalBatchKg(recipe) || 1000
  if (targetVolumeL <= 0 || base <= 0) return 1
  return targetVolumeL / base
}

/** Норма расхода по рецепту на целевой объём (без воды). */
export function buildNormLines(
  recipe: FormulationRecipe,
  targetVolumeL: number,
): NormFactLine[] {
  const scale = scaleFactorForVolume(recipe, targetVolumeL)
  const lines: NormFactLine[] = []
  for (const c of recipe.components) {
    if (isFormulationWaterComponent(c)) continue
    const baseKg = componentConsumeKg(c)
    if (baseKg <= 0) continue
    lines.push({
      componentId: c.id,
      name: c.name,
      warehouseItemId: c.warehouseItemId,
      normKg: round3(baseKg * scale),
      factKg: null,
      deltaKg: null,
      variancePct: null,
    })
  }
  return lines
}

function priceOf(
  c: FormulationComponent | undefined,
  priceLookup?: PriceLookup,
): number | null {
  if (!c) return null
  if (c.pricePerKg != null && Number.isFinite(c.pricePerKg)) return c.pricePerKg
  const base = componentConsumeKg(c)
  if (c.costPerBatch != null && base > 0) return c.costPerBatch / base
  if (priceLookup) {
    const fromWh = priceLookup(c.warehouseItemId)
    if (fromWh != null) return fromWh
  }
  return null
}

export function buildBatchCost(
  recipe: FormulationRecipe,
  lines: FormulationBatchLine[],
  outputKg: number,
  priceLookup?: PriceLookup,
): BatchCostSummary {
  const byId = new Map(recipe.components.map((c) => [c.id, c]))
  const costLines: BatchCostLine[] = []
  let total = 0
  let hasAny = false
  let missingPrices = 0

  for (const line of lines) {
    const c = byId.get(line.componentId)
    let price = priceOf(c, priceLookup)
    if (price == null && priceLookup && line.warehouseItemId) {
      price = priceLookup(line.warehouseItemId)
    }
    const cost = price != null ? round2(price * line.consumeKg) : null
    if (cost != null) {
      total += cost
      hasAny = true
    } else {
      missingPrices++
    }
    costLines.push({
      componentId: line.componentId,
      name: line.name,
      consumeKg: line.consumeKg,
      pricePerKg: price != null ? round2(price) : null,
      cost,
    })
  }

  const totalCost = hasAny ? round2(total) : null
  const costPerKg =
    totalCost != null && outputKg > 0 ? round2(totalCost / outputKg) : null

  return {
    currency: recipe.currency,
    lines: costLines,
    totalCost,
    outputKg,
    costPerKg,
    missingPrices,
  }
}

/** Норма vs факт + себестоимость для плана (ещё без факта) или замеса. */
export function analyzeBatchPlan(
  recipe: FormulationRecipe,
  targetVolumeL: number,
  factLines?: FormulationBatchLine[],
  priceLookup?: PriceLookup,
): BatchAnalysis {
  const baseVolumeL = recipeTotalBatchKg(recipe) || 1000
  const scaleFactor = scaleFactorForVolume(recipe, targetVolumeL)
  const normLines = buildNormLines(recipe, targetVolumeL)
  const factByComponent = new Map((factLines ?? []).map((l) => [l.componentId, l]))

  let maxAbs: number | null = null
  const lines: NormFactLine[] = normLines.map((n) => {
    const fact = factByComponent.get(n.componentId)
    if (!fact) return n
    const factKg = round3(fact.consumeKg)
    const deltaKg = round3(factKg - n.normKg)
    const variancePct =
      n.normKg > 1e-9 ? round2((deltaKg / n.normKg) * 100) : null
    if (variancePct != null) {
      const abs = Math.abs(variancePct)
      maxAbs = maxAbs == null ? abs : Math.max(maxAbs, abs)
    }
    return { ...n, factKg, deltaKg, variancePct }
  })

  if (factLines) {
    for (const f of factLines) {
      if (lines.some((l) => l.componentId === f.componentId)) continue
      lines.push({
        componentId: f.componentId,
        name: f.name,
        warehouseItemId: f.warehouseItemId,
        normKg: 0,
        factKg: round3(f.consumeKg),
        deltaKg: round3(f.consumeKg),
        variancePct: null,
      })
    }
  }

  const costLines =
    factLines ??
    normLines.map((n) => ({
      componentId: n.componentId,
      name: n.name,
      warehouseItemId: n.warehouseItemId ?? '',
      consumeKg: n.normKg,
    }))

  const cost = buildBatchCost(recipe, costLines, targetVolumeL, priceLookup)

  return {
    scaleFactor,
    baseVolumeL,
    targetVolumeL,
    lines,
    maxAbsVariancePct: maxAbs,
    cost,
  }
}

export function analyzeBatchRun(
  recipe: FormulationRecipe,
  run: FormulationBatchRun,
  priceLookup?: PriceLookup,
): BatchAnalysis {
  return analyzeBatchPlan(recipe, run.targetVolumeL, run.lines, priceLookup)
}

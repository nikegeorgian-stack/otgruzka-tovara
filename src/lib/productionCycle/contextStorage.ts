import { safeSessionGet, safeSessionRemove, safeSessionSet } from '@/lib/safeStorage'
import type { ProductionCycleContext } from './types'

export const PRODUCTION_CYCLE_CONTEXT_KEY = 'fst.productionCycle.v1'

/** Fallback for vitest / non-browser (sessionStorage may be missing). */
const memoryFallback = new Map<string, string>()

function readRaw(): string | null {
  const fromSession = safeSessionGet(PRODUCTION_CYCLE_CONTEXT_KEY)
  if (fromSession != null) return fromSession
  return memoryFallback.get(PRODUCTION_CYCLE_CONTEXT_KEY) ?? null
}

function writeRaw(value: string): void {
  const ok = safeSessionSet(PRODUCTION_CYCLE_CONTEXT_KEY, value)
  if (!ok) memoryFallback.set(PRODUCTION_CYCLE_CONTEXT_KEY, value)
  else memoryFallback.delete(PRODUCTION_CYCLE_CONTEXT_KEY)
}

function removeRaw(): void {
  safeSessionRemove(PRODUCTION_CYCLE_CONTEXT_KEY)
  memoryFallback.delete(PRODUCTION_CYCLE_CONTEXT_KEY)
}

export function loadProductionCycleContext(): ProductionCycleContext | null {
  const raw = readRaw()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ProductionCycleContext
    if (!parsed || typeof parsed !== 'object') return null
    const ctx: ProductionCycleContext = {}
    if (typeof parsed.salesOrderId === 'string' && parsed.salesOrderId) ctx.salesOrderId = parsed.salesOrderId
    if (typeof parsed.productionOrderId === 'string' && parsed.productionOrderId) {
      ctx.productionOrderId = parsed.productionOrderId
    }
    if (typeof parsed.lotId === 'string' && parsed.lotId) ctx.lotId = parsed.lotId
    if (typeof parsed.finishedProductId === 'string' && parsed.finishedProductId) {
      ctx.finishedProductId = parsed.finishedProductId
    }
    if (!ctx.salesOrderId && !ctx.productionOrderId && !ctx.lotId && !ctx.finishedProductId) return null
    return ctx
  } catch {
    return null
  }
}

export function saveProductionCycleContext(ctx: ProductionCycleContext): void {
  const clean: ProductionCycleContext = {}
  if (ctx.salesOrderId) clean.salesOrderId = ctx.salesOrderId
  if (ctx.productionOrderId) clean.productionOrderId = ctx.productionOrderId
  if (ctx.lotId) clean.lotId = ctx.lotId
  if (ctx.finishedProductId) clean.finishedProductId = ctx.finishedProductId
  if (!clean.salesOrderId && !clean.productionOrderId && !clean.lotId && !clean.finishedProductId) {
    clearProductionCycleContext()
    return
  }
  writeRaw(JSON.stringify(clean))
}

export function clearProductionCycleContext(): void {
  removeRaw()
}

/** Слияние якорей: новые поля перекрывают старые, пустые не стирают. */
export function mergeProductionCycleContext(
  prev: ProductionCycleContext | null | undefined,
  patch: ProductionCycleContext,
): ProductionCycleContext {
  return {
    salesOrderId: patch.salesOrderId || prev?.salesOrderId,
    productionOrderId: patch.productionOrderId || prev?.productionOrderId,
    lotId: patch.lotId || prev?.lotId,
    finishedProductId: patch.finishedProductId || prev?.finishedProductId,
  }
}

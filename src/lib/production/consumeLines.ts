import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { FormulationRecipe } from '@/lib/formulations/types'
import { inheritPackagingFromProduct } from '@/lib/packaging/inherit'
import { recipeLayerCounts } from '@/lib/packaging/calc'
import type { PackagingRecipeStore } from '@/lib/packaging/types'
import { linkedOrderIdsFromRequest } from '@/lib/planner/generateRequests'
import { estimatedOrderedRolls } from '@/lib/planner/rolls'
import type { ProductionOrder } from '@/lib/planner/types'
import {
  resolveWarehouseIdForItem,
  type DocumentPickerWarehouseEvidence,
} from '@/lib/warehouse/locationKindFilter'
import type { WarehouseItem } from '@/lib/warehouse/types'
import {
  estimateImpregnationConsumeKg,
  resolveFormulationRecipe,
  resolveImpregnationGrammage,
  resolveRollWidthM,
} from './impregnationConsume'
import { summarizeRequest } from './stats'
import type { ProductionRequest } from './types'

export type ProductionConsumeLine = {
  itemId: string
  quantity: number
  warehouseId: string
}

function firstOrder(
  request: ProductionRequest,
  orders: ProductionOrder[],
): ProductionOrder | undefined {
  for (const id of linkedOrderIdsFromRequest(request)) {
    const order = orders.find((o) => o.id === id)
    if (order) return order
  }
  return undefined
}

function itemById(items: WarehouseItem[], id: string | undefined): WarehouseItem | undefined {
  if (!id) return undefined
  return items.find((i) => i.id === id && i.active)
}

function pushLine(
  out: ProductionConsumeLine[],
  item: WarehouseItem | undefined,
  quantity: number,
  evidence?: DocumentPickerWarehouseEvidence,
) {
  if (!item || !(quantity > 0)) return
  const warehouseId = resolveWarehouseIdForItem(item.id, item.warehouseId, evidence)
  if (!warehouseId) return
  out.push({ itemId: item.id, quantity, warehouseId })
}

function sumFact(rows: { factQty?: number }[] | undefined): number {
  return (rows ?? []).reduce((s, r) => s + (r.factQty ?? 0), 0)
}

/**
 * Расходники по проведённой заявке — отдельные строки склада.
 * Компоненты замеса списываются при confirmBatchMix; здесь — суровьё и готовая пропитка на линии.
 */
export function buildProductionConsumeLines(
  request: ProductionRequest,
  orders: ProductionOrder[],
  finishedProducts: FinishedProduct[],
  warehouseItems: WarehouseItem[],
  packStore: PackagingRecipeStore,
  formulationRecipes: FormulationRecipe[] = [],
  evidence?: DocumentPickerWarehouseEvidence,
): ProductionConsumeLine[] {
  const order = firstOrder(request, orders)
  const fp = order?.finishedProductId
    ? finishedProducts.find((p) => p.id === order.finishedProductId)
    : undefined
  const inherited = inheritPackagingFromProduct(fp, packStore)
  const summary = summarizeRequest(request)
  const lines: ProductionConsumeLine[] = []

  if (request.lineId === 'pack') {
    const rolls =
      sumFact(request.packaging?.rolls) ||
      estimatedOrderedRolls(summary.factMp, order?.metersPerRoll ?? fp?.metersPerRoll) ||
      0
    const box = (packStore.boxes ?? []).find(
      (b) => b.id === (order?.boxRecipeId ?? inherited.boxRecipeId) && b.active,
    )
    const pallet = packStore.items.find(
      (r) => r.id === (order?.packagingRecipeId ?? inherited.packagingRecipeId) && r.active,
    )
    const boxItem = itemById(warehouseItems, box?.boxItemId ?? inherited.boxItemId ?? pallet?.boxItemId)
    const palletItem = itemById(warehouseItems, pallet?.palletItemId)
    const boxFact = sumFact(request.packaging?.boxes)
    const palletFact = sumFact(request.packaging?.pallets)
    const rollsPerBox = order?.rollsPerBox ?? box?.rollsPerBox ?? pallet?.rollsPerBox ?? 0
    const rollsPerPallet = pallet ? recipeLayerCounts(pallet).rollsPerPallet : 0

    pushLine(
      lines,
      boxItem,
      boxFact > 0 ? boxFact : rollsPerBox > 0 ? Math.ceil(rolls / rollsPerBox) : 0,
      evidence,
    )
    pushLine(
      lines,
      palletItem,
      palletFact > 0 ? palletFact : rollsPerPallet > 0 ? Math.ceil(rolls / rollsPerPallet) : 0,
      evidence,
    )
    return lines
  }

  const goodMp = Math.max(0, summary.factMp - (summary.byCategory.defect?.qtyMp ?? 0))
  const rawItem = itemById(
    warehouseItems,
    request.rawMaterialItemId || order?.rawMaterialItemId || fp?.defaultRawMaterialItemId,
  )
  const rawQty =
    request.rawRollQty && request.rawRollQty > 0
      ? request.rawRollQty
      : estimatedOrderedRolls(goodMp, order?.metersPerRoll ?? fp?.metersPerRoll) ?? 0
  pushLine(lines, rawItem, rawQty, evidence)

  const recipe = resolveFormulationRecipe(order, fp, formulationRecipes)
  const impregnationItem = itemById(warehouseItems, recipe?.outputWarehouseItemId)
  const impregnationKg = estimateImpregnationConsumeKg({
    goodMp,
    rollWidthM: resolveRollWidthM(fp),
    grammageGsm: resolveImpregnationGrammage(recipe, fp),
  })
  pushLine(lines, impregnationItem, impregnationKg, evidence)

  return lines
}

export function groupConsumeByWarehouse(
  lines: ProductionConsumeLine[],
): Map<string, ProductionConsumeLine[]> {
  const map = new Map<string, ProductionConsumeLine[]>()
  for (const line of lines) {
    if (!line.warehouseId) continue
    const cur = map.get(line.warehouseId) ?? []
    cur.push(line)
    map.set(line.warehouseId, cur)
  }
  return map
}

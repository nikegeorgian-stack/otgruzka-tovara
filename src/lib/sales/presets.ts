import { findA2LineCounterparty } from '@/lib/counterparties/presets'
import type { Counterparty } from '@/lib/counterparties/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { PlannerOrderCategory } from '@/lib/planner/types'
import { A2LINE_ORDER_META, A2LINE_PORTUGAL_LINES } from '@/lib/warehouse/loadingPresets'
import { emptySalesOrder } from './init'
import type { SalesLabelType, SalesOrder, SalesOrderLine } from './types'

export const A2LINE_SALES_PRESET_ID = 'a2line-portugal-2026-05' as const

/** м² → п.м. по ширине рулона */
export function areaM2ToQtyMp(areaM2: number, rollWidthM: number): number {
  if (areaM2 <= 0 || rollWidthM <= 0) return 0
  return Math.round(areaM2 / rollWidthM)
}

function genId(): string {
  return crypto.randomUUID()
}

function labelTypeFromNote(note: string): SalesLabelType {
  if (/заказчик/i.test(note)) return 'customer'
  if (/celloplex|наша/i.test(note)) return 'ours'
  return 'none'
}

function categoryForProduct(key: string, gsm: number): PlannerOrderCategory {
  if (key === '160' || gsm >= 155) return 'cat4'
  if (key === '75' || gsm <= 80) return 'ratl1'
  return 'ratl2'
}

function findFinishedProduct(
  items: FinishedProduct[],
  name: string,
  category: PlannerOrderCategory,
  gsm: number,
): FinishedProduct | undefined {
  const byName = items.find(
    (p) => p.active && (p.name === name || p.name.includes(name.replace('№ ', ''))),
  )
  if (byName) return byName
  return items.find(
    (p) =>
      p.active &&
      p.category === category &&
      p.grammageGsm != null &&
      Math.abs(p.grammageGsm - gsm) < 5,
  )
}

function buildLine(
  def: (typeof A2LINE_PORTUGAL_LINES)[number],
  finishedProducts: FinishedProduct[],
): SalesOrderLine {
  const category = categoryForProduct(def.key, def.gsm)
  const fp = findFinishedProduct(finishedProducts, def.name, category, def.gsm)
  const qtyMp = areaM2ToQtyMp(def.areaM2, def.widthM)
  const labelType = labelTypeFromNote(def.labelNote)
  const needsSeparateRecipe = def.key === '145light'

  const areaPerRoll = def.areaM2 / def.rolls
  const rollLengthM = Math.round((areaPerRoll / def.widthM) * 1000) / 1000

  return {
    id: genId(),
    finishedProductId: fp?.id,
    productName: fp?.name ?? def.name,
    category: fp?.category ?? category,
    productColor: def.color === 'белая' ? '#ffffff' : undefined,
    colorLogo: def.labelNote.includes('Celloplex') ? def.labelNote : undefined,
    qtyMp,
    qtyAreaM2: def.areaM2,
    rollWidthM: def.widthM,
    rollLengthM,
    targetGsm: def.gsm,
    labelType,
    labelNote: def.labelNote,
    rolls: def.rolls,
    boxes: def.boxes,
    palletPlaces: def.pallets,
    rollsPerBox: def.rollsPerBox,
    productionOrderIds: [],
    note: needsSeparateRecipe
      ? 'Отдельная рецептура пропитки · этикетка заказчика'
      : undefined,
  }
}

export type BuildA2LineSalesOrderOpts = {
  orderDate?: string
  dueDate?: string
  suggestedProductionStart?: string
  counterparties?: Counterparty[]
  finishedProducts?: FinishedProduct[]
}

/** Шаблон заказа клиента A2LINE Portugal (4 позиции) */
export function buildA2LinePortugalSalesOrder(opts: BuildA2LineSalesOrderOpts = {}): SalesOrder {
  const orderDate = opts.orderDate ?? A2LINE_ORDER_META.orderPlacedDate
  const dueDate = opts.dueDate ?? A2LINE_ORDER_META.clientDueDate
  const finishedProducts = opts.finishedProducts ?? []
  const cp = opts.counterparties ? findA2LineCounterparty(opts.counterparties) : undefined

  const order = emptySalesOrder(orderDate)
  return {
    ...order,
    counterpartyId: cp?.id,
    customer: cp?.name ?? A2LINE_ORDER_META.counterpartyName,
    status: 'confirmed',
    orderDate,
    dueDate,
    region: A2LINE_ORDER_META.region,
    logistics: A2LINE_ORDER_META.logistics,
    suggestedProductionStart: opts.suggestedProductionStart ?? '2026-06-27',
    note: A2LINE_ORDER_META.orderNotes,
    lines: A2LINE_PORTUGAL_LINES.map((def) => buildLine(def, finishedProducts)),
  }
}

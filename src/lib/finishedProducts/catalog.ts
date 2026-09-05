import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'
import type { PlannerOrderCategory } from '@/lib/planner/types'
import { ROLL_WIDTH_PRESETS_M } from '@/lib/warehouse/loadingProfile'
import {
  FINISHED_PRODUCT_TYPES,
  type FinishedProduct,
  type FinishedProductStore,
  type FinishedProductTypeDef,
} from './types'

/** Стандартные граммовки для ГП (г/м²) */
export const STANDARD_FINISHED_GRAMMAGES_GSM = [75, 130, 145, 160, 165] as const

/** Размер ячейки сетки (мм × мм), как в заказе */
export const STANDARD_MESH_CELLS = ['4x4', '4x5', '5x5'] as const

export function normalizeMeshCell(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined
  const s = raw
    .trim()
    .replace(/[×хХ]/g, 'x')
    .replace(/\s+/g, '')
    .toLowerCase()
  if (!s) return undefined
  const m = s.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/)
  if (m) return `${m[1]}x${m[2]}`
  return s
}

export function slugProductTypeId(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яёა-ჰ0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || `type-${Date.now().toString(36)}`
}

export function builtInProductTypes(): FinishedProductTypeDef[] {
  return FINISHED_PRODUCT_TYPES.map((pt) => ({
    id: pt.id,
    labelRu: pt.labelRu,
    labelKa: pt.labelKa,
  }))
}

/** Все типы: встроенные + реестр + уже использованные в карточках */
export function buildProductTypeOptions(
  store: FinishedProductStore,
  locale: Locale,
): { id: string; label: string; custom?: boolean }[] {
  const seen = new Set<string>()
  const out: { id: string; label: string; custom?: boolean }[] = []

  function push(id: string, label: string, custom?: boolean) {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, label, custom })
  }

  for (const pt of builtInProductTypes()) {
    push(pt.id, labelRuKa(locale, pt.labelRu, pt.labelKa ?? pt.labelRu))
  }
  for (const pt of store.productTypeRegistry ?? []) {
    if (!pt.id?.trim()) continue
    push(
      pt.id,
      labelRuKa(locale, pt.labelRu || pt.id, pt.labelKa || pt.labelRu || pt.id),
      true,
    )
  }
  for (const item of store.items) {
    const id = item.productType?.trim()
    if (!id || seen.has(id)) continue
    push(id, id, true)
  }
  return out
}

export function buildGrammageOptionsGsm(store: FinishedProductStore): number[] {
  const set = new Set<number>()
  for (const g of STANDARD_FINISHED_GRAMMAGES_GSM) set.add(g)
  for (const g of store.grammageRegistry ?? []) {
    if (g > 0) set.add(Math.round(g))
  }
  for (const item of store.items) {
    if (item.grammageGsm && item.grammageGsm > 0) set.add(Math.round(item.grammageGsm))
  }
  return [...set].sort((a, b) => a - b)
}

export function buildMeshCellOptions(store: FinishedProductStore): string[] {
  const set = new Set<string>()
  for (const c of STANDARD_MESH_CELLS) set.add(c)
  for (const c of store.meshCellRegistry ?? []) {
    const n = normalizeMeshCell(c)
    if (n) set.add(n)
  }
  for (const item of store.items) {
    const n = normalizeMeshCell(item.meshCellSize)
    if (n) set.add(n)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export function buildRollWidthOptionsM(store: FinishedProductStore): number[] {
  const set = new Set<number>()
  for (const w of ROLL_WIDTH_PRESETS_M) set.add(w)
  for (const w of store.rollWidthRegistry ?? []) {
    if (w > 0) set.add(Math.round(w * 1000) / 1000)
  }
  for (const item of store.items) {
    if (item.rollWidthM && item.rollWidthM > 0) {
      set.add(Math.round(item.rollWidthM * 1000) / 1000)
    }
  }
  return [...set].sort((a, b) => a - b)
}

/** Подсказка категории выработки по граммовке */
export function plannerCategoryForGsm(gsm: number): PlannerOrderCategory | undefined {
  if (gsm <= 0) return undefined
  if (gsm <= 90) return 'ratl1'
  if (gsm <= 150) return 'ratl2'
  if (gsm <= 170) return 'cat4'
  return undefined
}

export function withRegisteredFinishedCatalog(
  store: FinishedProductStore,
  product: Pick<FinishedProduct, 'productType' | 'grammageGsm' | 'rollWidthM' | 'meshCellSize'> & {
    newTypeLabel?: string
  },
): FinishedProductStore {
  let productTypeRegistry = [...(store.productTypeRegistry ?? [])]
  let grammageRegistry = [...(store.grammageRegistry ?? [])]
  let rollWidthRegistry = [...(store.rollWidthRegistry ?? [])]
  let meshCellRegistry = [...(store.meshCellRegistry ?? [])]

  const typeId = product.productType?.trim()
  if (typeId && !FINISHED_PRODUCT_TYPES.some((p) => p.id === typeId)) {
    if (!productTypeRegistry.some((p) => p.id === typeId)) {
      productTypeRegistry.push({
        id: typeId,
        labelRu: product.newTypeLabel?.trim() || typeId,
      })
    }
  }

  if (product.grammageGsm && product.grammageGsm > 0) {
    const g = Math.round(product.grammageGsm)
    if (!grammageRegistry.includes(g) && !(STANDARD_FINISHED_GRAMMAGES_GSM as readonly number[]).includes(g)) {
      grammageRegistry.push(g)
      grammageRegistry.sort((a, b) => a - b)
    }
  }

  if (product.rollWidthM && product.rollWidthM > 0) {
    const w = Math.round(product.rollWidthM * 1000) / 1000
    if (
      !rollWidthRegistry.some((x) => Math.abs(x - w) < 0.001) &&
      !ROLL_WIDTH_PRESETS_M.some((x) => Math.abs(x - w) < 0.001)
    ) {
      rollWidthRegistry.push(w)
      rollWidthRegistry.sort((a, b) => a - b)
    }
  }

  const cell = normalizeMeshCell(product.meshCellSize)
  if (cell && !(STANDARD_MESH_CELLS as readonly string[]).includes(cell)) {
    if (!meshCellRegistry.includes(cell)) {
      meshCellRegistry.push(cell)
      meshCellRegistry.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    }
  }

  return {
    ...store,
    productTypeRegistry,
    grammageRegistry,
    rollWidthRegistry,
    meshCellRegistry,
  }
}

export function normalizeNumberRegistry(raw: number[] | undefined): number[] {
  const set = new Set<number>()
  for (const n of raw ?? []) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      set.add(n >= 10 ? Math.round(n) : Math.round(n * 1000) / 1000)
    }
  }
  return [...set].sort((a, b) => a - b)
}

export function normalizeMeshCellRegistry(raw: string[] | undefined): string[] {
  const set = new Set<string>()
  for (const row of raw ?? []) {
    const n = normalizeMeshCell(row)
    if (n) set.add(n)
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

export function normalizeProductTypeRegistry(
  raw: FinishedProductTypeDef[] | undefined,
): FinishedProductTypeDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: FinishedProductTypeDef[] = []
  for (const row of raw) {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    if (!id || seen.has(id)) continue
    if (FINISHED_PRODUCT_TYPES.some((p) => p.id === id)) continue
    seen.add(id)
    out.push({
      id,
      labelRu: (row.labelRu ?? id).trim() || id,
      labelKa: row.labelKa?.trim() || undefined,
      labelEn: row.labelEn?.trim() || undefined,
    })
  }
  return out
}

import { newId } from '@/lib/production/files'
import { guessColorFromText, isValidProductColor } from './colors'
import {
  normalizeMeshCell,
  normalizeMeshCellRegistry,
  normalizeNumberRegistry,
  normalizeProductTypeRegistry,
} from './catalog'
import type { FinishedProduct, FinishedProductStore, FinishedProductTypeId } from './types'
import { productTypeToRawKind } from './types'

export function formatFinishedProductCode(n: number): string {
  return `ГП-${String(n).padStart(6, '0')}`
}

function normalizeProductType(
  raw: FinishedProduct['productType'],
): FinishedProductTypeId | undefined {
  if (typeof raw !== 'string') return undefined
  const id = raw.trim()
  return id || undefined
}

export function normalizeFinishedProduct(p: FinishedProduct): FinishedProduct {
  const productType = normalizeProductType(p.productType)
  return {
    ...p,
    code: p.code?.trim() || formatFinishedProductCode(1),
    name: p.name?.trim() ?? '',
    nameKa: p.nameKa?.trim() || undefined,
    nameEn: p.nameEn?.trim() || undefined,
    productType,
    grammageGsm: p.grammageGsm && p.grammageGsm > 0 ? p.grammageGsm : undefined,
    meshCellSize: normalizeMeshCell(p.meshCellSize),
    category: p.category ?? 'ratl1',
    colorLogo: p.colorLogo?.trim() || undefined,
    productColor: isValidProductColor(p.productColor)
      ? p.productColor
      : guessColorFromText(p.colorLogo),
    warehouseItemId: p.warehouseItemId || undefined,
    labelPhotoDataUrl: p.labelPhotoDataUrl || undefined,
    labelPhotoName: p.labelPhotoName?.trim() || undefined,
    unit: 'mp',
    defaultCounterpartyId: p.defaultCounterpartyId || undefined,
    rawMaterialKind: p.rawMaterialKind || productTypeToRawKind(productType),
    defaultRawMaterialItemId: p.defaultRawMaterialItemId || undefined,
    defaultPackagingRecipeId: p.defaultPackagingRecipeId || undefined,
    defaultBoxRecipeId: p.defaultBoxRecipeId || undefined,
    defaultFormulationRecipeId: p.defaultFormulationRecipeId || undefined,
    metersPerRoll: p.metersPerRoll && p.metersPerRoll > 0 ? p.metersPerRoll : undefined,
    rollWidthM: p.rollWidthM && p.rollWidthM > 0 ? p.rollWidthM : undefined,
    note: p.note?.trim() || undefined,
    active: p.active !== false,
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
  }
}

export function createDefaultFinishedProducts(): FinishedProductStore {
  return { items: [], nextCode: 1 }
}

export function normalizeFinishedProductStore(
  raw: FinishedProductStore | undefined,
): FinishedProductStore {
  const items = (raw?.items ?? []).map(normalizeFinishedProduct)
  const maxFromCodes = items.reduce((max, i) => {
    const m = i.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  return {
    items,
    nextCode: Math.max(raw?.nextCode ?? 1, maxFromCodes + 1),
    productTypeRegistry: normalizeProductTypeRegistry(raw?.productTypeRegistry),
    grammageRegistry: normalizeNumberRegistry(raw?.grammageRegistry),
    rollWidthRegistry: normalizeNumberRegistry(raw?.rollWidthRegistry),
    meshCellRegistry: normalizeMeshCellRegistry(raw?.meshCellRegistry),
  }
}

export function nextFinishedProductCode(store: FinishedProductStore): string {
  return formatFinishedProductCode(store.nextCode)
}

export function emptyFinishedProduct(store: FinishedProductStore): FinishedProduct {
  const now = new Date().toISOString()
  return {
    id: newId(),
    code: nextFinishedProductCode(store),
    name: '',
    category: 'ratl1',
    unit: 'mp',
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

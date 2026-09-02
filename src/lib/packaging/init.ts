import { normalizeMeshCell } from '@/lib/finishedProducts/catalog'
import { newId } from '@/lib/production/files'
import type { BoxRecipe, PackagingRecipe, PackagingRecipeStore } from './types'

function normalizeRecipe(r: PackagingRecipe): PackagingRecipe {
  const stack = (r.stack ?? []).filter((s) => s === 'pallet' || s === 'box')
  return {
    id: r.id || newId(),
    code: r.code?.trim() || 'РУ-000001',
    name: r.name?.trim() || 'Рецепт',
    palletItemId: r.palletItemId || undefined,
    boxItemId: r.boxItemId || undefined,
    stack: stack.length ? stack : ['pallet', 'box'],
    rollsPerBox: Math.max(1, Number(r.rollsPerBox) || 1),
    topRolls: r.topRolls && r.topRolls > 0 ? r.topRolls : undefined,
    note: r.note?.trim() || undefined,
    active: r.active !== false,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  }
}

export function emptyPackagingRecipe(): PackagingRecipe {
  const now = new Date().toISOString()
  return {
    id: newId(),
    code: '',
    name: '',
    stack: ['pallet', 'box'],
    rollsPerBox: 2,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function nextPackagingRecipeCode(store: PackagingRecipeStore): string {
  const n = store.nextCode
  return `РУ-${String(n).padStart(6, '0')}`
}

function normalizeBoxRecipe(r: BoxRecipe): BoxRecipe {
  return {
    id: r.id || newId(),
    code: r.code?.trim() || 'РК-000001',
    name: r.name?.trim() || 'Коробка',
    productType: r.productType?.trim() || undefined,
    rollsPerBox: Math.max(1, Number(r.rollsPerBox) || 1),
    boxItemId: r.boxItemId || undefined,
    meshCellSize: normalizeMeshCell(r.meshCellSize),
    note: r.note?.trim() || undefined,
    active: r.active !== false,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  }
}

export function emptyBoxRecipe(): BoxRecipe {
  const now = new Date().toISOString()
  return {
    id: newId(),
    code: '',
    name: '',
    rollsPerBox: 4,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function nextBoxRecipeCode(store: PackagingRecipeStore): string {
  const n = store.nextBoxCode ?? 1
  return `РК-${String(n).padStart(6, '0')}`
}

export function createDefaultPackagingRecipes(): PackagingRecipeStore {
  return { items: [], nextCode: 1, boxes: [], nextBoxCode: 1 }
}

export function normalizePackagingRecipeStore(
  raw: PackagingRecipeStore | undefined,
): PackagingRecipeStore {
  const items = (raw?.items ?? []).map(normalizeRecipe)
  const boxes = (raw?.boxes ?? []).map(normalizeBoxRecipe)

  const maxFromCodes = items.reduce((max, i) => {
    const m = i.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)
  const maxBoxFromCodes = boxes.reduce((max, i) => {
    const m = i.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  return {
    items,
    nextCode: Math.max(raw?.nextCode ?? 1, maxFromCodes + 1),
    boxes,
    nextBoxCode: Math.max(raw?.nextBoxCode ?? 1, maxBoxFromCodes + 1),
  }
}

export { normalizeRecipe as normalizePackagingRecipe, normalizeBoxRecipe }

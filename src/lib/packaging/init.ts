import { newId } from '@/lib/production/files'
import type { PackagingRecipe, PackagingRecipeStore } from './types'

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

const DEFAULT_RECIPES: Omit<PackagingRecipe, 'id' | 'code' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Палета · коробка · палета · коробка',
    stack: ['pallet', 'box', 'pallet', 'box'],
    rollsPerBox: 2,
    active: true,
  },
  {
    name: 'Палета · коробка · коробка',
    stack: ['pallet', 'box', 'box'],
    rollsPerBox: 2,
    active: true,
  },
  {
    name: 'Палета · коробка · палета · коробка + 6 сверху',
    stack: ['pallet', 'box', 'pallet', 'box'],
    rollsPerBox: 2,
    topRolls: 6,
    active: true,
  },
  {
    name: 'Палета · коробка · коробка + 12 сверху',
    stack: ['pallet', 'box', 'box'],
    rollsPerBox: 2,
    topRolls: 12,
    active: true,
  },
]

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

export function createDefaultPackagingRecipes(): PackagingRecipeStore {
  const now = new Date().toISOString()
  const items = DEFAULT_RECIPES.map((r, i) =>
    normalizeRecipe({
      ...r,
      id: newId(),
      code: `РУ-${String(i + 1).padStart(6, '0')}`,
      createdAt: now,
      updatedAt: now,
    }),
  )
  return { items, nextCode: items.length + 1 }
}

export function normalizePackagingRecipeStore(
  raw: PackagingRecipeStore | undefined,
): PackagingRecipeStore {
  const items = (raw?.items ?? []).map(normalizeRecipe)
  if (items.length === 0) return createDefaultPackagingRecipes()

  const maxFromCodes = items.reduce((max, i) => {
    const m = i.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  return {
    items,
    nextCode: Math.max(raw?.nextCode ?? 1, maxFromCodes + 1),
  }
}

export { normalizeRecipe as normalizePackagingRecipe }

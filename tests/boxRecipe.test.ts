import { describe, expect, it } from 'vitest'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { inheritPackagingFromProduct } from '@/lib/packaging/inherit'
import {
  nextBoxRecipeCode,
  normalizePackagingRecipeStore,
} from '@/lib/packaging/init'
import type { PackagingRecipeStore } from '@/lib/packaging/types'

function store(partial: Partial<PackagingRecipeStore>): PackagingRecipeStore {
  return normalizePackagingRecipeStore({
    items: [],
    nextCode: 1,
    boxes: [],
    nextBoxCode: 1,
    ...partial,
  })
}

const now = '2026-08-01T00:00:00.000Z'

describe('box recipe inherit', () => {
  it('takes rolls and box SKU from the box recipe, not the pallet recipe', () => {
    const pack = store({
      items: [
        {
          id: 'pal1',
          code: 'РУ-000001',
          name: 'Палета',
          stack: ['pallet', 'box'],
          rollsPerBox: 99,
          boxItemId: 'sku-old-box',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      boxes: [
        {
          id: 'box1',
          code: 'РК-000001',
          name: 'Коробка сетка 4',
          rollsPerBox: 4,
          boxItemId: 'sku-box',
          meshCellSize: '4x4',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    const fp = {
      id: 'fp1',
      code: 'ГП-000001',
      name: 'Сетка',
      category: 'ratl1',
      unit: 'mp',
      defaultBoxRecipeId: 'box1',
      defaultPackagingRecipeId: 'pal1',
      meshCellSize: '5x5',
      active: true,
      createdAt: now,
      updatedAt: now,
    } satisfies FinishedProduct

    const got = inheritPackagingFromProduct(fp, pack)
    expect(got.boxRecipeId).toBe('box1')
    expect(got.packagingRecipeId).toBe('pal1')
    expect(got.rollsPerBox).toBe(4)
    expect(got.boxItemId).toBe('sku-box')
    expect(got.meshCellSize).toBe('4x4')
  })

  it('falls back to pallet rolls when the product has no box recipe', () => {
    const pack = store({
      items: [
        {
          id: 'pal1',
          code: 'РУ-000001',
          name: 'Палета',
          stack: ['pallet', 'box'],
          rollsPerBox: 32,
          boxItemId: 'sku-box',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    })
    const fp = {
      id: 'fp1',
      code: 'ГП-000001',
      name: 'Сетка',
      category: 'ratl1',
      unit: 'mp',
      defaultPackagingRecipeId: 'pal1',
      meshCellSize: '5x5',
      active: true,
      createdAt: now,
      updatedAt: now,
    } satisfies FinishedProduct

    const got = inheritPackagingFromProduct(fp, pack)
    expect(got.boxRecipeId).toBeUndefined()
    expect(got.rollsPerBox).toBe(32)
    expect(got.boxItemId).toBe('sku-box')
    expect(got.meshCellSize).toBe('5x5')
  })

  it('formats the next box recipe code', () => {
    expect(nextBoxRecipeCode({ items: [], nextCode: 1, boxes: [], nextBoxCode: 3 })).toBe(
      'РК-000003',
    )
  })
})

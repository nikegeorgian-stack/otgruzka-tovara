import { describe, expect, it } from 'vitest'
import {
  STANDARD_MESH_CELLS,
  buildMeshCellOptions,
  normalizeMeshCell,
} from '@/lib/finishedProducts/catalog'
import { estimatedOrderedRolls } from '@/lib/planner/rolls'

describe('normalizeMeshCell', () => {
  it('normalizes latin, cyrillic and times signs to 4x5', () => {
    expect(normalizeMeshCell('4x5')).toBe('4x5')
    expect(normalizeMeshCell('4×5')).toBe('4x5')
    expect(normalizeMeshCell('4х5')).toBe('4x5')
    expect(normalizeMeshCell(' 4 X 5 ')).toBe('4x5')
  })

  it('keeps standard cells and custom like 4x4.5', () => {
    expect(STANDARD_MESH_CELLS).toContain('4x4')
    expect(STANDARD_MESH_CELLS).toContain('4x5')
    expect(STANDARD_MESH_CELLS).toContain('5x5')
    expect(normalizeMeshCell('4x4.5')).toBe('4x4.5')
  })

  it('builds options from store registry and products', () => {
    const opts = buildMeshCellOptions({
      items: [{ meshCellSize: '5x4' } as never],
      nextCode: 1,
      meshCellRegistry: ['3x3'],
    })
    expect(opts).toContain('4x4')
    expect(opts).toContain('3x3')
    expect(opts).toContain('5x4')
  })
})

describe('estimatedOrderedRolls', () => {
  it('ceils linear metres by metres per roll', () => {
    expect(estimatedOrderedRolls(1000, 50)).toBe(20)
    expect(estimatedOrderedRolls(1001, 50)).toBe(21)
  })

  it('returns undefined without metres or qty', () => {
    expect(estimatedOrderedRolls(0, 50)).toBeUndefined()
    expect(estimatedOrderedRolls(100, 0)).toBeUndefined()
    expect(estimatedOrderedRolls(100, undefined)).toBeUndefined()
  })
})

import type { WorkwearPpeCategory, WorkwearSizeGrid } from './types'

/** Стандартные размерные сетки (EU / EN 340) */
export const SIZE_GRIDS: Record<WorkwearSizeGrid, string[]> = {
  clothing_eu: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '44', '46', '48', '50', '52', '54', '56', '58'],
  footwear_eu: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48'],
  headwear: ['52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62'],
  gloves: ['7', '8', '9', '10', '11', '12'],
  free: [],
}

/** Рекомендуемая сетка по категории СИЗ */
export function defaultSizeGridForCategory(cat: WorkwearPpeCategory): WorkwearSizeGrid {
  switch (cat) {
    case 'footwear':
      return 'footwear_eu'
    case 'headwear':
      return 'headwear'
    case 'gloves':
      return 'gloves'
    case 'upper':
    case 'pants':
      return 'clothing_eu'
    default:
      return 'clothing_eu'
  }
}

export function sizesForGrid(grid: WorkwearSizeGrid, custom?: string[]): string[] {
  if (grid === 'free') return custom ?? []
  return SIZE_GRIDS[grid]
}

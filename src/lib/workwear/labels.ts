import type { WorkwearPpeCategory, WorkwearSeason, WorkwearSizeGrid } from './types'
import { defaultSizeGridForCategory, sizesForGrid } from './sizes'

export function workwearSeasonLabel(season: WorkwearSeason, locale: 'ru' | 'ka'): string {
  const ru: Record<WorkwearSeason, string> = {
    summer: 'Летняя',
    winter: 'Зимняя',
  }
  const ka: Record<WorkwearSeason, string> = {
    summer: 'საზაფხულო',
    winter: 'ზამთრის',
  }
  return locale === 'ka' ? ka[season] : ru[season]
}

export function workwearPpeCategoryLabel(cat: WorkwearPpeCategory, locale: 'ru' | 'ka'): string {
  const ru: Record<WorkwearPpeCategory, string> = {
    headwear: 'Головной убор',
    upper: 'Верхняя одежда',
    pants: 'Штаны / брюки',
    footwear: 'Обувь',
    gloves: 'Перчатки',
    eye: 'Защита глаз',
    respiratory: 'СИЗОД',
    hearing: 'Защита слуха',
    other: 'Прочее',
  }
  const ka: Record<WorkwearPpeCategory, string> = {
    headwear: 'თავსაბურავი',
    upper: 'ზედა ტანსაცმელი',
    pants: 'შარვალი',
    footwear: 'ფეხსაცმელი',
    gloves: 'თხევრები',
    eye: 'თვალის დაცვა',
    respiratory: 'სუნთქვის დაცვა',
    hearing: 'სმენის დაცვა',
    other: 'სხვა',
  }
  return locale === 'ka' ? ka[cat] : ru[cat]
}

export function workwearSizeGridLabel(grid: WorkwearSizeGrid, locale: 'ru' | 'ka'): string {
  const ru: Record<WorkwearSizeGrid, string> = {
    clothing_eu: 'Одежда (EU)',
    footwear_eu: 'Обувь (EU)',
    headwear: 'Головной убор (обхват)',
    gloves: 'Перчатки',
    free: 'Свой список',
  }
  const ka: Record<WorkwearSizeGrid, string> = {
    clothing_eu: 'ტანსაცმელი (EU)',
    footwear_eu: 'ფეხსაცმელი (EU)',
    headwear: 'თავსაბურავი',
    gloves: 'თხევრები',
    free: 'თავისუფალი',
  }
  return locale === 'ka' ? ka[grid] : ru[grid]
}

export const WORKWEAR_PPE_CATEGORIES: WorkwearPpeCategory[] = [
  'headwear',
  'upper',
  'pants',
  'footwear',
  'gloves',
  'eye',
  'respiratory',
  'hearing',
  'other',
]

export const WORKWEAR_SIZE_GRIDS: WorkwearSizeGrid[] = [
  'clothing_eu',
  'footwear_eu',
  'headwear',
  'gloves',
  'free',
]

export function defaultSizesForCatalog(
  ppeCategory: WorkwearPpeCategory,
  sizeGrid?: WorkwearSizeGrid,
): string[] {
  const grid = sizeGrid ?? defaultSizeGridForCategory(ppeCategory)
  return sizesForGrid(grid)
}

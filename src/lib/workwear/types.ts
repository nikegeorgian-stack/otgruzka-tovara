export type WorkwearSeason = 'summer' | 'winter'

export type WorkwearCurrency = 'GEL' | 'RUB' | 'USD'

/** Категория СИЗ по европейской классификации (EN 340 / ISO) */
export type WorkwearPpeCategory =
  | 'headwear'
  | 'upper'
  | 'pants'
  | 'footwear'
  | 'gloves'
  | 'eye'
  | 'respiratory'
  | 'hearing'
  | 'other'

export type WorkwearSizeGrid =
  | 'clothing_eu'
  | 'footwear_eu'
  | 'headwear'
  | 'gloves'
  | 'free'

/** Номенклатура спецодежды (каталог выдачи) */
export type WorkwearCatalogItem = {
  id: string
  name: string
  nameKa?: string
  /** Головной убор, верх, штаны, обувь… */
  ppeCategory: WorkwearPpeCategory
  season: WorkwearSeason
  sizeGrid: WorkwearSizeGrid
  /** Цена за единицу при выдаче */
  unitPrice: number
  currency: WorkwearCurrency
  /** Доступные размеры */
  sizes: string[]
  /** Связь со складской номенклатурой (категория СИЗ) */
  warehouseItemId?: string
  warehouseId?: string
  active: boolean
  sortOrder: number
  note?: string
}

/** Проводка выдачи спецодежды сотруднику */
export type WorkwearIssuance = {
  id: string
  documentNumber: string
  employeeId: string
  itemId: string
  size: string
  quantity: number
  unitPrice: number
  currency: WorkwearCurrency
  season: WorkwearSeason
  ppeCategory: WorkwearPpeCategory
  amortizationMonths: number
  issueDate: string
  issuedBy: string
  issuedByName: string
  warehouseItemId?: string
  warehouseDocumentId?: string
  comment?: string
  createdAt: string
}

export type WorkwearStore = {
  catalog: WorkwearCatalogItem[]
  issuances: WorkwearIssuance[]
}

export const WORKWEAR_AMORTIZATION_MONTHS: Record<WorkwearSeason, number> = {
  summer: 12,
  winter: 24,
}

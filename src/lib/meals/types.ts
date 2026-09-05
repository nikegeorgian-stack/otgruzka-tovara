export type MealOrderStatus = 'draft' | 'submitted' | 'accepted' | 'cancelled'

export type MealOption = {
  id: string
  nameRu: string
  nameKa: string
  nameEn: string
  emoji?: string
  active: boolean
  sort: number
}

export type MealCatalogKind = 'base' | 'extra'

export type MealCompositionLine = {
  id: string
  nameRu: string
  nameKa: string
  nameEn: string
  /** Вес порции в граммах, как в ресторанном меню. */
  grams?: number
}

export type MealCatalogItem = {
  id: string
  kind: MealCatalogKind
  nameRu: string
  nameKa: string
  nameEn: string
  /** Для extra — фиксированная цена сотрудника; компания всегда платит 0. */
  employeePriceGel: number
  /** Состав комплекса: блюда и граммовки. */
  composition?: MealCompositionLine[]
  active: boolean
  sort: number
}

export type MealMenuDay = {
  date: string
  baseItemId?: string
  /** Дополнения именно этого дня. undefined — берём недельный список (старые меню). */
  extraIds?: string[]
}

export type MealMenuWeekStatus = 'draft' | 'published'

export type MealMenuWeek = {
  /** ISO понедельника — стабильный ID недели. */
  id: string
  weekStart: string
  status: MealMenuWeekStatus
  days: MealMenuDay[]
  /** Дополнения по умолчанию: применяются к дням без собственного списка. */
  extraIds: string[]
  createdAt: string
  updatedAt: string
  publishedAt?: string
  publishedBy?: string
  publishedByName?: string
  copiedFromWeekId?: string
}

export type MealAdvanceReceipt = {
  id: string
  amountGel: number
  receivedAt: string
  note?: string
  createdBy?: string
  createdByName?: string
}

export type MealPricing = {
  firstPortionEmployeeGel: number
  extraPortionEmployeeGel: number
  firstPortionCompanyGel: number
  extraPortionCompanyGel: number
}

export type MealTelegramSettings = {
  enabled: boolean
  lunchEnabled: boolean
  extraEnabled: boolean
}

export type MealSettings = {
  ordersDisabled: boolean
  disabledTextRu: string
  disabledTextKa: string
  disabledTextEn: string
  /** Час Тбилиси, после которого заказ на завтра закрыт (по умолчанию 18). */
  deadlineHourTbilisi: number
  pricing: MealPricing
  options: MealOption[]
  telegram: MealTelegramSettings
}

export type MealOrderLine = {
  optionId: string
  qty: number
  kind?: MealCatalogKind
  nameRu?: string
  nameKa?: string
  nameEn?: string
  /** Снимок цены на момент заказа — не меняется задним числом. */
  employeeUnitGel?: number
  companyUnitGel?: number
}

export type MealOrder = {
  id: string
  employeeId: string
  employeeName: string
  date: string
  lines: MealOrderLine[]
  status: MealOrderStatus
  createdAt: string
  updatedAt: string
  createdBy?: string
  createdByName?: string
}

export type MealAcceptedDay = {
  id: string
  date: string
  acceptedAt: string
  acceptedBy?: string
  acceptedByName?: string
}

export type MealsStore = {
  settings: MealSettings
  /** Новый каталог; legacy settings.options хранится только для старых заказов. */
  catalog: MealCatalogItem[]
  weeks: MealMenuWeek[]
  advances: MealAdvanceReceipt[]
  orders: MealOrder[]
  acceptedDays: MealAcceptedDay[]
}

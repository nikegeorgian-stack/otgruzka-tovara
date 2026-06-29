export type DirectorySection =
  | 'codes'
  | 'employees'
  | 'brigades'
  | 'positions'
  | 'counterparties'
  | 'finishedProducts'
  | 'packagingRecipes'
  | 'formulations'
  | 'nomenclature'
  | 'warehouseMeta'

export const DIRECTORY_SECTIONS: { id: DirectorySection; labelKey: string }[] = [
  { id: 'counterparties', labelKey: 'directories.tab.counterparties' },
  { id: 'finishedProducts', labelKey: 'directories.tab.finishedProducts' },
  { id: 'packagingRecipes', labelKey: 'directories.tab.packagingRecipes' },
  { id: 'formulations', labelKey: 'directories.tab.formulations' },
  { id: 'codes', labelKey: 'directories.tab.codes' },
  { id: 'employees', labelKey: 'directories.tab.employees' },
  { id: 'brigades', labelKey: 'directories.tab.brigades' },
  { id: 'positions', labelKey: 'directories.tab.positions' },
  { id: 'nomenclature', labelKey: 'directories.tab.nomenclature' },
  { id: 'warehouseMeta', labelKey: 'directories.tab.warehouseMeta' },
]

/** Справочники для облачного кладовщика */
export const WAREHOUSE_WEB_DIRECTORY_SECTIONS: DirectorySection[] = [
  'counterparties',
  'nomenclature',
  'warehouseMeta',
]

/** Справочники для облачного менеджера закупок */
export const PROCUREMENT_WEB_DIRECTORY_SECTIONS: DirectorySection[] = [
  'counterparties',
  'nomenclature',
]

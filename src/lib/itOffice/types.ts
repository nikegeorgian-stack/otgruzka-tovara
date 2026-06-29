export type ItAssetKind =
  | 'laptop'
  | 'tablet'
  | 'printer'
  | 'monitor'
  | 'phone'
  | 'ups'
  | 'router'
  | 'switch'
  | 'projector'
  | 'scanner'
  | 'keyboard'
  | 'mouse'
  | 'headset'
  | 'webcam'
  | 'docking'
  | 'other'

export type ItAssetStatus = 'stock' | 'issued' | 'repair' | 'written_off'

export type ItActType = 'issue' | 'return' | 'transfer' | 'write_off'

export type ItMaintenanceKind = 'service' | 'repair' | 'replacement' | 'other'

export type ItAttachmentEntity = 'asset' | 'act' | 'maintenance'

/** Модель / тип техники в справочнике */
export type ItAssetCatalogItem = {
  id: string
  name: string
  kind: ItAssetKind
  manufacturer?: string
  model?: string
  note?: string
  active: boolean
  sortOrder: number
}

/** Локация: кабинет, IT-комната, склад */
export type ItLocation = {
  id: string
  name: string
  sortOrder: number
}

/** Единица техники в реестре */
export type ItAsset = {
  id: string
  catalogId?: string
  kind: ItAssetKind
  name: string
  inventoryNo: string
  serialNo?: string
  status: ItAssetStatus
  locationId?: string
  currentEmployeeId?: string
  purchaseDate?: string
  warrantyUntil?: string
  purchasePrice?: number
  currency?: string
  ipAddress?: string
  macAddress?: string
  accessories?: string
  note?: string
  createdAt: string
  updatedAt: string
}

export type ItHandoverActLine = {
  id: string
  assetId: string
  condition?: string
  accessories?: string
  note?: string
}

export type ItHandoverActStatus = 'draft' | 'posted'

/** Акт приёма-передачи */
export type ItHandoverAct = {
  id: string
  number: string
  actType: ItActType
  date: string
  employeeId: string
  fromEmployeeId?: string
  issuedBy: string
  issuedByName: string
  lines: ItHandoverActLine[]
  status: ItHandoverActStatus
  comment?: string
  createdAt: string
  updatedAt: string
  postedAt?: string
}

export type ItMaintenanceRecord = {
  id: string
  assetId: string
  date: string
  kind: ItMaintenanceKind
  description: string
  vendor?: string
  cost?: number
  currency?: string
  nextDueDate?: string
  performedBy?: string
  note?: string
  createdAt: string
}

/** Расходник (картридж, барабан, кабель…) */
export type ItConsumableSpec = {
  id: string
  name: string
  sku?: string
  compatibleCatalogIds: string[]
  compatibleAssetIds: string[]
  minStock: number
  unit: string
  active: boolean
}

export type ItConsumableBalance = {
  specId: string
  locationId: string
  qty: number
}

export type ItConsumableIssue = {
  id: string
  specId: string
  qty: number
  date: string
  printerAssetId?: string
  employeeId?: string
  issuedBy: string
  issuedByName: string
  note?: string
  createdAt: string
}

export type ItAttachment = {
  id: string
  entityType: ItAttachmentEntity
  entityId: string
  folderPath: string
  fileName: string
  fileUrl?: string
  note?: string
  uploadedAt: string
}

export type ItOfficeStore = {
  catalog: ItAssetCatalogItem[]
  locations: ItLocation[]
  assets: ItAsset[]
  acts: ItHandoverAct[]
  maintenance: ItMaintenanceRecord[]
  consumableSpecs: ItConsumableSpec[]
  consumableBalances: ItConsumableBalance[]
  consumableIssues: ItConsumableIssue[]
  attachments: ItAttachment[]
  nextInventorySeq: number
}

export const IT_ASSET_KINDS: ItAssetKind[] = [
  'laptop',
  'tablet',
  'printer',
  'monitor',
  'phone',
  'ups',
  'router',
  'switch',
  'projector',
  'scanner',
  'keyboard',
  'mouse',
  'headset',
  'webcam',
  'docking',
  'other',
]

export const IT_PRINTER_KINDS: ItAssetKind[] = ['printer', 'scanner', 'projector']

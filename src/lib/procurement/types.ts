/** Внутренние / зарубежные закупки */
export type ProcurementScope = 'domestic' | 'international'

export type TransportMode = 'truck' | 'rail' | 'sea' | 'air' | 'mixed'

/** Морские линии для отслеживания контейнеров */
export type SeaCarrier = 'maersk' | 'msc' | 'cma-cgm'

export type ContainerReferenceType = 'container' | 'bl' | 'booking'

/** Настройки авто-отслеживания контейнера по заказу */
export type ContainerTracking = {
  enabled: boolean
  carrier: SeaCarrier
  reference: string
  referenceType: ContainerReferenceType
  lastSyncedAt?: string
  lastLocation?: string
  lastEventLabel?: string
  syncError?: string
}

export type OrderCategory =
  | 'raw_material'
  | 'packaging'
  | 'spare_parts'
  | 'equipment'
  | 'consumables'
  | 'other'

export type PurchaseOrderStatus =
  | 'draft'
  | 'ordered'
  | 'production'
  | 'shipped'
  | 'in_transit'
  | 'customs'
  | 'arrived'
  | 'partial'
  | 'received'
  | 'cancelled'

export type PurchaseOrderAttachmentKind =
  | 'contract'
  | 'invoice'
  | 'packing_list'
  | 'specification'
  | 'correspondence'
  | 'customs'
  | 'scan'
  | 'other'

export type PurchaseOrderAttachment = {
  id: string
  name: string
  mimeType: string
  kind: PurchaseOrderAttachmentKind
  sizeBytes: number
  dataUrl: string
  uploadedAt: string
  note?: string
}

export type PurchaseOrderLine = {
  id: string
  warehouseItemId?: string
  name: string
  /** Артикул / код у поставщика (часто для Китая) */
  supplierSku?: string
  quantity: number
  unit: string
  unitPrice?: number
  currency?: string
  receivedQty: number
  note?: string
}

/** Этап маршрута: поезд, судно, авто и т.д. */
export type ShipmentLeg = {
  id: string
  sequence: number
  transportMode: TransportMode
  carrier?: string
  vesselOrTrain?: string
  origin: string
  destination: string
  /** Плановая дата отгрузки */
  plannedDepartureDate?: string
  actualDepartureDate?: string
  /** Ожидаемое прибытие на этап */
  etaDate?: string
  actualArrivalDate?: string
  trackingNumber?: string
  note?: string
}

export type ShipmentMilestone = {
  id: string
  at: string
  status: PurchaseOrderStatus | string
  location?: string
  note?: string
  /** ID события у линии — для дедупликации при синхронизации */
  externalId?: string
  source?: 'manual' | 'carrier'
  carrier?: SeaCarrier
}

/** Запись журнала смены статуса заказа */
export type PurchaseOrderStatusChange = {
  id: string
  at: string
  fromStatus?: PurchaseOrderStatus
  toStatus: PurchaseOrderStatus
  note?: string
}

export type PurchaseOrder = {
  id: string
  /** ЗЗ-2025-0001 */
  orderNumber: string
  counterpartyId: string
  /** Договор из справочника контрагента */
  contractId?: string
  scope: ProcurementScope
  category: OrderCategory
  status: PurchaseOrderStatus
  orderDate: string
  /** Желаемая дата поставки */
  requestedDeliveryDate?: string
  /** Подтверждённая дата */
  confirmedDeliveryDate?: string
  /** Номер заказа у поставщика (PI / PO ref) */
  supplierReference?: string
  incoterms?: string
  originCountry?: string
  portOfLoading?: string
  portOfDischarge?: string
  destinationWarehouseId?: string
  currency?: string
  /** Условия оплаты: предоплата %, аккредитив и т.д. */
  paymentTerms?: string
  /** Курс к GEL на дату */
  exchangeRate?: number
  exchangeRateDate?: string
  lines: PurchaseOrderLine[]
  legs: ShipmentLeg[]
  milestones: ShipmentMilestone[]
  statusHistory: PurchaseOrderStatusChange[]
  /** Авто-отслеживание контейнера у морской линии */
  containerTracking?: ContainerTracking
  attachments: PurchaseOrderAttachment[]
  warehouseDocumentIds: string[]
  note?: string
  createdAt: string
  updatedAt: string
}

export type ProcurementStore = {
  orders: PurchaseOrder[]
  nextOrderSeq: number
}

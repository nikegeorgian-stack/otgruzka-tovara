export type StockMovementType =
  | 'receipt'
  | 'issue'
  | 'adjustment'
  | 'reserve'
  | 'unreserve'
  | 'inventory'

export type WarehouseLocationKind =
  | 'raw'
  | 'chemistry'
  | 'packaging'
  | 'wip'
  | 'finished'
  | 'office'
  | 'other'

export type WarehouseLocation = {
  id: string
  name: string
  sortOrder: number
  /** Зона учёта: сырьё, химия, выработка… */
  kind?: WarehouseLocationKind
  /**
   * Стабильный номер склада для фильтров/отчётов (не зависит от названия).
   * Пример: 01, 02, WH-03.
   */
  code?: string
}

export type WarehouseDocumentPurpose =
  | 'purchase'
  | 'production_issue'
  | 'production_receipt'
  | 'return'
  | 'writeoff'
  | 'transfer'
  | 'other'
  | 'loading'
  /** PHASE W0.5 — начальная инвентаризация для активации учёта */
  | 'opening_inventory'
  /** PHASE W3 — документный резерв материалов под производственный заказ */
  | 'production_reservation'
  | 'production_reservation_increase'
  | 'production_reservation_release'
  | 'production_reservation_reallocation'
  /** PHASE P1A — передача сырья на линию / возврат */
  | 'production_material_transfer'
  | 'production_material_return'

export type WarehouseDocumentStatus = 'draft' | 'posted' | 'cancelled'

export type WriteoffReasonId =
  | 'defect'
  | 'expired'
  | 'damage'
  | 'inventory_shortage'
  | 'production_loss'
  | 'other'

export type WarehouseCategory = {
  id: string
  name: string
  sortOrder: number
  /** Код группы номенклатуры для фильтров (01, 01.01…). */
  code?: string
}

export type UnitConversion = {
  unit: string
  /** 1 alt unit = factor base units */
  factor: number
}

/** Журнал изменений одной позиции номенклатуры */
export type WarehouseItemHistoryEntry = {
  id: string
  at: string
  kind: 'created' | 'renamed' | 'field_change' | 'archived' | 'restored'
  field?: string
  oldValue?: string
  newValue?: string
  detail: string
}

export type WarehouseItem = {
  id: string
  /** Внутренний код (выдаётся автоматически, менять нельзя) */
  internalCode: string
  name: string
  /**
   * Техническое название (задаёт только технолог).
   * В списках приоритетнее `name`; название в накладной (`name`) не перезаписывается.
   */
  technicalName?: string
  /** Наименование на грузинском (черновик из русского). Аддитивно. */
  nameKa?: string
  /** Наименование на английском (черновик из русского). Аддитивно. */
  nameEn?: string
  categoryId: string
  warehouseId: string
  unit: string
  sku?: string
  barcode?: string
  price?: number
  /** Вес единицы, кг (рулон, коробка, палета, шт) */
  weightKg?: number
  minStock?: number
  note?: string
  /** Миниатюра (JPEG data URL, ~128px) */
  photoDataUrl?: string
  unitConversions?: UnitConversion[]
  active: boolean
  sortOrder: number
  createdAt?: string
}

export type StockMovement = {
  id: string
  itemId: string
  warehouseId: string
  type: StockMovementType
  quantity: number
  date: string
  documentId?: string
  /** PHASE W1 — link to WarehouseDocumentLine.lineId */
  documentLineId?: string
  documentNo?: string
  /** PHASE W0.6/W1 — cloud atomic group when part of warehouse transaction */
  transactionGroupId?: string
  brigade?: string
  comment?: string
  /** Резерв под заказ планировщика */
  productionOrderId?: string
  /** Резерв под задание миксеру (ЗД-…) */
  mixTaskId?: string
  /** if entered in alternate unit */
  inputUnit?: string
  /** Себестоимость за базовую единицу (для прихода) — для средневзвешенной оценки */
  unitCost?: number
  /** Номер партии (для прихода) */
  batchNo?: string
  /** Срок годности партии (YYYY-MM-DD) */
  expiryDate?: string
  createdAt: string
  /** PHASE W1 — immutable actor snapshot */
  createdBy?: string
  createdByName?: string
}

export type WarehouseDocumentLine = {
  /** PHASE W1 — stable line id (optional on legacy rows) */
  lineId?: string
  itemId: string
  quantity: number
  /** Snapshot at post time — rename of item must not rewrite history */
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unitSnapshot?: string
  plannedQty?: number
  actualQty?: number
  sourceLocationId?: string
  destinationLocationId?: string
  /** Снимок учётного остатка на момент ревизии (документ inventory) */
  bookQty?: number
  /** Сомнительные данные при пересчёте */
  doubtful?: boolean
  inputUnit?: string
  /** Цена за единицу (для прихода) */
  unitPrice?: number
  /** Номер партии (для прихода) */
  batchNo?: string
  /** Срок годности (YYYY-MM-DD, для прихода) */
  expiryDate?: string
  /** Комментарий к строке (opening inventory / ревизия) */
  comment?: string
  /** PHASE W3 — snapshot потребности / резерва / дефицита */
  requiredQty?: number
  reservedQty?: number
  shortageQty?: number
  /** PHASE P1A — выдано / сверх резерва */
  issuedQty?: number
  overReserveQty?: number
  /** Ручная замена партии (причина на документе) */
  batchOverrideReason?: string
}

export type WarehouseDocumentType = 'receipt' | 'issue' | 'inventory' | 'reservation'

/** PHASE W3 — устойчивый дефицит материалов (не hard-delete) */
export type MaterialShortageStatus = 'open' | 'partial' | 'resolved'

export type MaterialShortageRecord = {
  id: string
  productionOrderId: string
  /** Стабильный ключ строки потребности (role или line id) */
  materialLineKey: string
  itemId: string
  warehouseId: string
  requiredDate: string
  requiredQty: number
  reservedQty: number
  shortageQty: number
  orderPriority: 'normal' | 'urgent' | number
  status: MaterialShortageStatus
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  sourceReservationDocumentId?: string
  /** Детерминированный ключ идемпотентности: order+item+warehouse+line */
  idempotencyKey: string
}

export type WarehouseDocument = {
  id: string
  type: WarehouseDocumentType
  number: string
  date: string
  /** PHASE W1 — optional datetime (legacy uses `date` only) */
  documentDateTime?: string
  warehouseId: string
  sourceWarehouseId?: string
  destinationWarehouseId?: string
  /** Вид операции / основание */
  purpose?: WarehouseDocumentPurpose
  counterparty?: string
  counterpartyId?: string
  contractId?: string
  /** Снимок номера договора на момент проводки */
  contractNumber?: string
  basisType?: string
  basisId?: string
  basisNumber?: string
  responsibleEmployeeId?: string
  responsibleEmployeeNameSnapshot?: string
  brigade?: string
  comment?: string
  writeoffReason?: WriteoffReasonId
  status?: WarehouseDocumentStatus
  /** Кто и когда провёл документ (draft → posted) */
  postedAt?: string
  postedBy?: string
  postedByName?: string
  cancelledAt?: string
  cancelledBy?: string
  cancelledByName?: string
  cancellationReason?: string
  reversalDocumentId?: string
  reversesDocumentId?: string
  /** Кладовщик, проводивший документ */
  keeperId?: string
  keeperName?: string
  /** Связь с заявкой производства */
  productionRequestId?: string
  /** Связь с заказом планировщика (резерв материалов) */
  productionOrderId?: string
  /** Связь с заданием миксеру (резерв) */
  mixTaskId?: string
  /** Склад-получатель при перемещении */
  targetWarehouseId?: string
  /** Связанная пара приход/расход при перемещении */
  transferPairId?: string
  /** Ключ инвойса RS.ge (серия/номер) */
  invoiceKey?: string
  sellerTin?: string
  /** Заказ закупки (ЗЗ), из которого создан приход */
  purchaseOrderId?: string
  lines: WarehouseDocumentLine[]
  /** Связь с замесом пропитки */
  batchRunId?: string
  /** Связь с заявкой кладовщика на пополнение (ЗКл) */
  keeperRequestId?: string
  /**
   * Детерминированный ключ идемпотентности (auto-docs).
   * Старые записи без поля читаются как раньше.
   */
  idempotencyKey?: string
  /** PHASE W0.5 — документ начальной инвентаризации (активация учёта) */
  isOpeningInventory?: boolean
  /** PHASE W3 — корректирует предыдущий документ резерва / связанный документ */
  correctsDocumentId?: string
  relatedDocumentIds?: string[]
  /** Причина ручной корректировки / перераспределения */
  reservationReason?: string
  /** PHASE W0.6/W3 — cloud atomic group */
  transactionGroupId?: string
  docRole?:
    | 'batch_issue'
    | 'batch_receipt'
    | 'transfer_issue'
    | 'transfer_receipt'
    | 'reversal'
    | 'production_receipt'
    | 'production_issue'
    | 'loading_issue'
    | 'production_reservation'
    | 'production_reservation_release'
    | 'production_transfer_issue'
    | 'production_transfer_receipt'
    | 'production_return_issue'
    | 'production_return_receipt'
  /** PHASE P1A — линия производства */
  productionLineId?: string
  /** PHASE P1A — ссылка на документ резерва */
  reservationDocumentId?: string
  /** Причина превышения резерва / возврата */
  overReserveReason?: string
  returnReason?: string
  /** Связь с погрузкой ГП */
  loadingShipmentId?: string
  /** Когда документ выгружен бухгалтеру / в Balance */
  exportedAt?: string
  exportedBy?: string
  exportedByName?: string
  /** Блокировка редактирования черновика другим пользователем */
  lockedBy?: string
  lockedByName?: string
  lockedAt?: string
  createdAt: string
  createdBy?: string
  createdByName?: string
  updatedAt?: string
  updatedBy?: string
  updatedByName?: string
  /** Optimistic revision for concurrent draft edits */
  revision?: number
}

/** Строка инвойса RS.ge / eAPI */
export type GeorgianInvoiceLine = {
  name: string
  quantity: number
  unit?: string
  unitPrice?: number
  amount?: number
  barcode?: string
}

/** Импортированный инвойс — локальный реестр для подстановки в приход */
export type GeorgianInvoice = {
  id: string
  /** Нормализованный ключ для поиска (SERIE/NUMBER) */
  key: string
  number: string
  serie?: string
  date?: string
  sellerName?: string
  sellerTin?: string
  buyerTin?: string
  amount?: number
  lines: GeorgianInvoiceLine[]
  importedAt: string
  source: 'json' | 'xml' | 'excel'
}

export type WarehouseAuditEntry = {
  id: string
  at: string
  action:
    | 'item_change'
    | 'item_archive'
    | 'movement_add'
    | 'movement_delete'
    | 'document_draft'
    | 'document_post'
    | 'document_unpost'
    | 'document_cancel'
    | 'inventory'
    | 'import'
    | 'daily_issue'
    | 'batch_mix'
    | 'item_request'
    | 'item_rename'
    | 'loading_shipment'
  detail: string
  itemId?: string
  actorId?: string
  actorName?: string
  batchRunId?: string
  productionRequestId?: string
}

/** Заявка технолога на добавление позиции в номенклатуру */
export type WarehouseItemRequest = {
  id: string
  name: string
  unit: string
  categoryHint?: string
  note?: string
  recipeCode?: string
  requestedBy: string
  requestedByName: string
  status: 'open' | 'fulfilled' | 'rejected'
  fulfilledItemId?: string
  keeperNote?: string
  createdAt: string
  resolvedAt?: string
}

/** Предложение технолога переименовать позицию склада */
export type WarehouseItemRenameRequest = {
  id: string
  itemId: string
  previousName: string
  previousUnit: string
  proposedName: string
  proposedUnit?: string
  proposedSku?: string
  note?: string
  requestedBy: string
  requestedByName: string
  status: 'open' | 'accepted' | 'rejected'
  keeperNote?: string
  resolvedBy?: string
  resolvedByName?: string
  resolvedAt?: string
  createdAt: string
}

/** Строка ведомости выдачи за день */
export type DailyIssueLine = {
  itemId: string
  quantity: number
  updatedAt: string
}

/** Событие +/- в течение дня (для печати) */
export type DailyIssueEvent = {
  id: string
  at: string
  itemId: string
  delta: number
}

/** Строка заявки кладовщика на пополнение склада */
export type KeeperReplenishmentLine = {
  itemId: string
  requestedQty: number
  receivedQty: number
  note?: string
}

/** Заявка кладовщика на закупку / пополнение (не расход сотрудникам) */
export type KeeperReplenishmentStatus =
  | 'draft'
  | 'submitted'
  | 'partial'
  | 'received'
  | 'cancelled'

export type KeeperReplenishmentRequest = {
  id: string
  /** ЗКл-20260624-01 */
  number: string
  date: string
  warehouseId: string
  keeperId: string
  keeperName: string
  status: KeeperReplenishmentStatus
  lines: KeeperReplenishmentLine[]
  warehouseDocumentIds: string[]
  purchaseOrderId?: string
  comment?: string
  createdAt: string
  updatedAt: string
  submittedAt?: string
  closedAt?: string
}

/** Строка погрузки готовой продукции */
export type LoadingShipmentLine = {
  id: string
  itemId?: string
  finishedProductId?: string
  name: string
  note: string
  rollLengthM: number
  grammageGsm: number
  rollWidthM: number
  rolls: number
  weightPerRollKg: number
  areaPerRollM2: number
  rollsPerBox: number
  topRolls: number
  rollsPerPallet: number
  palletLayers: number
  boxLayers: number
  palletTareKg: number
  boxes: number
  boxTareKg: number
  palletPlaces: number
  color?: string
  labelNote?: string
  logoNote?: string
  cellSize?: string
}

export type LoadingShipmentStatus = 'draft' | 'posted'

/** Учётная форма погрузки готовой продукции (отгрузка) */
export type LoadingShipment = {
  id: string
  /** ПГ-20260623-01 */
  number: string
  date: string
  warehouseId: string
  containerId: string
  payloadKg: number
  palletPlacesLimit: number
  counterpartyId?: string
  counterpartyName: string
  orderNo: string
  /** Дата размещения заявки */
  orderPlacedDate?: string
  /** Срок исполнения для клиента */
  clientDueDate?: string
  /** Планируемый срок изготовления */
  plannedProductionDate?: string
  /** Фактическая дата отгрузки */
  actualShipDate?: string
  /** Регион / страна */
  region?: string
  /** Логистика (CIF, контейнер…) */
  logistics?: string
  /** Примечания к заказу */
  orderNotes?: string
  /** Связь с заказом клиента */
  salesOrderId?: string
  salesLineId?: string
  keeperId?: string
  keeperName?: string
  lines: LoadingShipmentLine[]
  totalsRolls: number
  totalsNetKg: number
  totalsGrossKg: number
  totalsAreaM2: number
  totalsPalletPlaces: number
  status: LoadingShipmentStatus
  createdAt: string
  updatedAt: string
  postedAt?: string
  /** Авто-расход ГП при проведении погрузки */
  postedDocumentId?: string
}

/** Черновик выдачи за день — проводится одним расходом в конце смены */
export type DailyIssueSession = {
  id: string
  /** ВД-20260616-АЛ */
  number: string
  date: string
  warehouseId: string
  keeperId: string
  keeperName: string
  status: 'open' | 'posted'
  lines: DailyIssueLine[]
  events: DailyIssueEvent[]
  comment?: string
  postedDocumentId?: string
  createdAt: string
  updatedAt: string
}

export type WarehouseStore = {
  locations: WarehouseLocation[]
  categories: WarehouseCategory[]
  items: WarehouseItem[]
  movements: StockMovement[]
  documents: WarehouseDocument[]
  /** Реестр инвойсов RS.ge (импорт JSON/XML) */
  invoiceRegistry: GeorgianInvoice[]
  auditLog: WarehouseAuditEntry[]
  /** Черновики выдачи за день (кладовщик) */
  dailyIssueSessions?: DailyIssueSession[]
  /** Следующий номер для internalCode (FC-000001…) */
  nextInternalCode?: number
  /** История по позиции: itemId → записи (новые сверху) */
  itemHistories?: Record<string, WarehouseItemHistoryEntry[]>
  /** Заявки технологов на новые позиции номенклатуры */
  itemRequests?: WarehouseItemRequest[]
  /** Предложения технологов по переименованию номенклатуры */
  itemRenameRequests?: WarehouseItemRenameRequest[]
  /** Заявки кладовщика на пополнение / закупку */
  replenishmentRequests?: KeeperReplenishmentRequest[]
  /** Журнал погрузок готовой продукции */
  loadingShipments?: LoadingShipment[]
  /** Закрытые учётные периоды склада (YYYY-MM) — проводки запрещены */
  closedMonths?: string[]
  /**
   * PHASE W0.5 — статус достоверности учёта по каждому складу.
   * Отсутствие записи = uninitialized (legacy).
   */
  accountingByWarehouse?: WarehouseAccountingState[]
  /** PHASE W3 — дефициты материалов (soft-resolve, без hard delete) */
  materialShortages?: MaterialShortageRecord[]
  /**
   * PHASE P1A — привязка lineId → production warehouse/location (стабильные ID).
   * Не заполняется автоматически из пользовательских данных.
   */
  productionLineBindings?: ProductionLineLocationBinding[]
}

/** PHASE P1A — конфиг линии → склад/location производства */
export type ProductionLineLocationBinding = {
  /** Stable row id (= lineId for cloud merge) */
  id: string
  lineId: string
  productionWarehouseId: string
  productionLocationId: string
  note?: string
}

/** PHASE W0.5 — состояние подтверждения остатков по складу */
export type WarehouseAccountingStatus = 'uninitialized' | 'reconciling' | 'active'

export type WarehouseAccountingState = {
  /** Stable row id for cloud merge (= warehouseId) */
  id: string
  warehouseId: string
  status: WarehouseAccountingStatus
  openingInventoryDocumentId?: string
  activatedAt?: string
  activatedBy?: string
  activatedByName?: string
  note?: string
  revision?: number
}

export type ItemBalance = {
  itemId: string
  receipt: number
  issue: number
  adjustment: number
  reserved: number
  balance: number
  available: number
}

export type TurnoverRow = {
  itemId: string
  receipt: number
  issue: number
  net: number
}

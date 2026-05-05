import { collection, doc, serverTimestamp, type DocumentData, type Firestore, type Transaction } from 'firebase/firestore'

export type WarehouseRecord = {
  id?: string
  code: string
  name: string
  isActive: boolean
  sortOrder: number
}

/** Начальное заполнение — как типовые склады производства с сырьём и ГП */
export const defaultWarehousesSeed: Omit<WarehouseRecord, 'id'>[] = [
  { code: 'SKL-SYRW', name: 'СКЛ — Сырьё и материалы', isActive: true, sortOrder: 10 },
  { code: 'SKL-WIP', name: 'Цех / ожидание ОТК', isActive: true, sortOrder: 20 },
  { code: 'SKL-GP', name: 'СКЛ — Готовая продукция', isActive: true, sortOrder: 30 },
  { code: 'SKL-SHIP', name: 'Зона отгрузки', isActive: true, sortOrder: 40 },
]

export type StockLedgerMovementType =
  | 'purchase_in'
  | 'transfer_out'
  | 'transfer_in'
  | 'shipment_out'
  | 'writeoff'

export function movementTypeRu(t: StockLedgerMovementType): string {
  const m: Record<StockLedgerMovementType, string> = {
    purchase_in: 'Приход',
    transfer_out: 'Передача со склада',
    transfer_in: 'Поступление на склад',
    shipment_out: 'Отгрузка',
    writeoff: 'Списание',
  }
  return m[t] || t
}

export type StockLedgerEntry = {
  id?: string
  docId: string
  docNumber: string
  docKind: string
  movementType: StockLedgerMovementType
  warehouse: string
  productId: string
  productName: string
  qtyDelta: number
  uom: string
  nomenclatureKind: 'raw_lot' | 'finished_roll'
  comment?: string
  createdAt?: unknown
}

export function ledgerEntry(
  tx: Transaction,
  db: Firestore,
  partial: Omit<StockLedgerEntry, 'id' | 'createdAt'>,
) {
  const ref = doc(collection(db, 'stockLedger'))
  const row: DocumentData = { ...partial, createdAt: serverTimestamp() }
  tx.set(ref, row)
}

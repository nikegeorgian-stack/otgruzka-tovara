import type { WarehouseDocument } from './types'

export function documentNumberPrefix(type: WarehouseDocument['type']): string {
  if (type === 'receipt') return 'ПР'
  if (type === 'issue') return 'РС'
  return 'ИНВ'
}

/** Следующий номер: ПР-20260619-001 (сквозная нумерация за день по типу) */
export function nextDocumentNumber(
  documents: WarehouseDocument[],
  type: WarehouseDocument['type'],
  date: string,
): string {
  const prefix = documentNumberPrefix(type)
  const day = date.replace(/-/g, '')
  const pattern = new RegExp(`^${prefix}-${day}-(\\d+)$`, 'i')
  let max = 0
  for (const doc of documents) {
    const m = doc.number.match(pattern)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return `${prefix}-${day}-${String(max + 1).padStart(3, '0')}`
}

export function nextReversalNumber(originalNumber: string): string {
  const base = originalNumber.replace(/-СТ\d*$/i, '')
  return `${base}-СТ`
}

export function isDocumentNumberTaken(
  documents: WarehouseDocument[],
  number: string,
  excludeId?: string,
): boolean {
  const n = number.trim().toLowerCase()
  if (!n) return false
  return documents.some(
    (d) => d.id !== excludeId && d.number.trim().toLowerCase() === n && d.status !== 'cancelled',
  )
}

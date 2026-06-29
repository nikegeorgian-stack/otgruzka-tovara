import type { WriteoffReasonId } from './types'

export const WRITEOFF_REASONS: { id: WriteoffReasonId; labelKey: string }[] = [
  { id: 'defect', labelKey: 'warehouse.writeoff.defect' },
  { id: 'expired', labelKey: 'warehouse.writeoff.expired' },
  { id: 'damage', labelKey: 'warehouse.writeoff.damage' },
  { id: 'inventory_shortage', labelKey: 'warehouse.writeoff.inventory_shortage' },
  { id: 'production_loss', labelKey: 'warehouse.writeoff.production_loss' },
  { id: 'other', labelKey: 'warehouse.writeoff.other' },
]

import type { DirectorySection } from '@/lib/directories/types'
import type { Counterparty } from '@/lib/counterparties/types'
import type { AppStore } from '@/lib/types'
import type { WarehouseItem } from '@/lib/warehouse/types'

export type ProcurementActions = {
  onUpsertOrder: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['upsertPurchaseOrder']
  onCreateOrder: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['createPurchaseOrder']
  onRemoveOrder: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['removePurchaseOrder']
  onAddMilestone: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['addPurchaseOrderMilestone']
  onSetStatus: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['setPurchaseOrderStatus']
  onReceiveOrder: ReturnType<
    typeof import('@/store/slices/procurementSlice').createProcurementSlice
  >['receivePurchaseOrder']
  onUpsertCounterparty: (c: Counterparty) => void
  onUpsertWarehouseItem: (item: WarehouseItem) => void
  onNavigateToDirectory: (section: DirectorySection) => void
}

export function buildProcurementPageProps(
  store: AppStore,
  actions: ProcurementActions,
) {
  return {
    procurement: store.procurement,
    counterparties: store.counterparties,
    warehouse: store.warehouse,
    settings: store.settings,
    ...actions,
  }
}

export type ProcurementPageProps = ReturnType<typeof buildProcurementPageProps>

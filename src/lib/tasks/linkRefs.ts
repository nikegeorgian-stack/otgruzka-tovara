import type { TaskLinkRef, WorkTaskDraft } from './types'

export const TASK_BOARD_WAREHOUSE = 'board_warehouse'
export const TASK_BOARD_PRODUCTION = 'board_production'
export const TASK_BOARD_OFFICE = 'board_office'
export const TASK_BOARD_IT = 'board_it'

/** Целевая доска для быстрого создания задачи из ERP. */
export function boardIdForLinkType(type: TaskLinkRef['type']): string {
  switch (type) {
    case 'production_order':
      return TASK_BOARD_WAREHOUSE
    case 'warehouse_doc':
      return TASK_BOARD_WAREHOUSE
    case 'employee':
      return TASK_BOARD_OFFICE
    case 'sales_order':
      return TASK_BOARD_PRODUCTION
    case 'procurement_order':
      return TASK_BOARD_WAREHOUSE
    default:
      return TASK_BOARD_WAREHOUSE
  }
}

export function draftFromProductionMaterialShortage(args: {
  orderId: string
  orderNumber: string
  productName: string
  createdBy: string
  createdByName?: string
}): WorkTaskDraft {
  return {
    boardId: TASK_BOARD_WAREHOUSE,
    title: `Обеспечить материал: ${args.orderNumber}`,
    description: args.productName,
    linkRefs: [
      {
        type: 'production_order',
        id: args.orderId,
        label: args.orderNumber,
      },
    ],
    priority: 'high',
    createdBy: args.createdBy,
    createdByName: args.createdByName,
  }
}

export function draftFromWarehouseReceipt(args: {
  documentId: string
  documentNumber: string
  createdBy: string
  createdByName?: string
}): WorkTaskDraft {
  return {
    boardId: TASK_BOARD_WAREHOUSE,
    title: `Разобрать расхождение: ${args.documentNumber}`,
    linkRefs: [
      {
        type: 'warehouse_doc',
        id: args.documentId,
        label: args.documentNumber,
      },
    ],
    priority: 'normal',
    createdBy: args.createdBy,
    createdByName: args.createdByName,
  }
}

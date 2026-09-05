/** Уровень доступа к разделу «Задачи» */
export type TaskAccessLevel = 'none' | 'my' | 'board' | 'manage'

export type TaskModuleId =
  | 'kanban'
  | 'my_tasks'
  | 'wip_limit'
  | 'workflow'
  | 'forms_on_action'
  | 'approval'
  | 'auto_assign_column'
  | 'archive_done'
  | 'parent_auto_done'
  | 'reminders'
  | 'time_tracking'
  | 'telegram_notify'
  | 'email_to_task'

export type TaskBoard = {
  id: string
  title: string
  /** office | production | warehouse | quality | it | management | general */
  department: string
  columnIds: string[]
  sortOrder: number
  archived?: boolean
  ownerUserId?: string
  enabledModules?: TaskModuleId[]
}

export type TaskColumn = {
  id: string
  boardId: string
  title: string
  sortOrder: number
  wipLimit?: number
  color?: string
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export type TaskLinkRef = {
  type: 'production_order' | 'warehouse_doc' | 'employee' | 'sales_order' | 'procurement_order'
  id: string
  label?: string
}

export type WorkTask = {
  id: string
  /** Отображаемый номер З-YYYY-NNN */
  number?: string
  boardId: string
  columnId: string
  title: string
  description?: string
  /** @deprecated первый из assigneeUserIds — для совместимости */
  assigneeUserId?: string
  /** Несколько исполнителей на одну задачу */
  assigneeUserIds?: string[]
  /** Кто из исполнителей отметил свою часть */
  assigneeDoneUserIds?: string[]
  assigneeEmployeeId?: string
  createdBy: string
  createdByName?: string
  dueDate?: string
  dueTime?: string
  priority: TaskPriority
  status: 'open' | 'done' | 'cancelled'
  checklist?: { id: string; text: string; done: boolean }[]
  linkRefs?: TaskLinkRef[]
  attachmentIds?: string[]
  private?: boolean
  sortOrder?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type TaskComment = {
  id: string
  taskId: string
  by: string
  byName?: string
  text: string
  at: string
}

export type TaskAttachment = {
  id: string
  taskId: string
  storagePath: string
  fileName: string
  mimeType?: string
  sizeBytes?: number
  uploadedBy: string
  uploadedAt: string
  /** Двухфазное удаление — файл в outbox, Storage delete после SQL ack. */
  pendingDeletion?: boolean
  externalEffectOperationId?: string
}

export type TaskBoardRule =
  | { id: string; kind: 'wip_limit'; columnId: string; max: number }
  | {
      id: string
      kind: 'workflow'
      allowed: { fromColumnId: string; toColumnId: string }[]
      createAllowedColumnIds?: string[]
    }
  | {
      id: string
      kind: 'form_on_action'
      trigger: 'create' | 'move' | 'complete'
      columnId?: string
      title: string
      fields: { id: string; label: string; required: boolean; hint?: string }[]
    }
  | {
      id: string
      kind: 'approval'
      reviewColumnId: string
      approveColumnId: string
      rejectColumnId: string
      returnToSourceOnReject?: boolean
      approverUserIds: string[]
    }
  | { id: string; kind: 'auto_assign_column'; columnId: string; userIds: string[] }
  | { id: string; kind: 'archive_done'; columnId: string; afterDays: number }
  | { id: string; kind: 'parent_auto_done'; enabled: true }

export type TasksStore = {
  boards: TaskBoard[]
  columns: TaskColumn[]
  tasks: WorkTask[]
  comments: TaskComment[]
  attachments: TaskAttachment[]
  rules: TaskBoardRule[]
  personalLists?: {
    id: string
    userId: string
    title: string
    taskIds: string[]
    sortOrder: number
  }[]
}

export type WorkTaskDraft = {
  id?: string
  boardId: string
  columnId?: string
  title: string
  description?: string
  assigneeUserId?: string
  assigneeUserIds?: string[]
  assigneeEmployeeId?: string
  dueDate?: string
  dueTime?: string
  priority?: TaskPriority
  checklist?: { id: string; text: string; done: boolean }[]
  linkRefs?: TaskLinkRef[]
  createdBy: string
  createdByName?: string
}

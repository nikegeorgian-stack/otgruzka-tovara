import type {
  TaskBoard,
  TaskColumn,
  TasksStore,
  WorkTask,
  WorkTaskDraft,
  TaskComment,
  TaskPriority,
} from './types'
import {
  normalizeAssigneeUserIds,
  primaryAssigneeUserId,
  taskAssigneeDoneUserIds,
} from './assignees'
import { nextTaskNumber } from './taskNumber'

type BoardSeed = {
  id: string
  title: string
  department: string
  sortOrder: number
  columns: string[]
  ownerRole?: string
}

const BOARD_SEEDS: BoardSeed[] = [
  {
    id: 'board_office',
    title: 'Офис',
    department: 'office',
    sortOrder: 10,
    columns: ['Новая', 'В работе', 'Ждёт', 'Готово'],
    ownerRole: 'office_manager',
  },
  {
    id: 'board_general',
    title: 'Общие поручения',
    department: 'general',
    sortOrder: 20,
    columns: ['Новая', 'В работе', 'Готово'],
  },
  {
    id: 'board_production',
    title: 'Производство',
    department: 'production',
    sortOrder: 30,
    columns: ['Новая', 'В работе', 'ОТК', 'Готово'],
    ownerRole: 'chief_engineer',
  },
  {
    id: 'board_warehouse',
    title: 'Склад',
    department: 'warehouse',
    sortOrder: 40,
    columns: ['Новая', 'В работе', 'Готово'],
    ownerRole: 'warehouse_keeper',
  },
  {
    id: 'board_quality',
    title: 'Качество',
    department: 'quality',
    sortOrder: 50,
    columns: ['Новая', 'В работе', 'Готово'],
  },
  {
    id: 'board_it',
    title: 'IT',
    department: 'it',
    sortOrder: 60,
    columns: ['Новая', 'В работе', 'Готово'],
    ownerRole: 'it_specialist',
  },
  {
    id: 'board_management',
    title: 'Руководство',
    department: 'management',
    sortOrder: 70,
    columns: [],
  },
]

function columnId(boardId: string, index: number): string {
  return `${boardId}_col_${index}`
}

function buildSeedStore(): TasksStore {
  const boards: TaskBoard[] = []
  const columns: TaskColumn[] = []
  for (const seed of BOARD_SEEDS) {
    const columnIds = seed.columns.map((_, i) => columnId(seed.id, i))
    boards.push({
      id: seed.id,
      title: seed.title,
      department: seed.department,
      columnIds,
      sortOrder: seed.sortOrder,
      enabledModules: ['kanban', 'my_tasks', 'workflow'],
    })
    seed.columns.forEach((title, i) => {
      columns.push({
        id: columnIds[i]!,
        boardId: seed.id,
        title,
        sortOrder: i * 10,
      })
    })
  }
  return { boards, columns, tasks: [], comments: [], attachments: [], rules: [] }
}

export function createDefaultTasksStore(): TasksStore {
  return buildSeedStore()
}

function mergeSeedBoards(existing: TasksStore): TasksStore {
  const seed = buildSeedStore()
  const boardIds = new Set(existing.boards.map((b) => b.id))
  const columnIds = new Set(existing.columns.map((c) => c.id))
  const boards = [...existing.boards]
  const columns = [...existing.columns]
  for (const b of seed.boards) {
    if (!boardIds.has(b.id)) {
      boards.push(b)
      boardIds.add(b.id)
    }
  }
  for (const c of seed.columns) {
    if (!columnIds.has(c.id)) {
      columns.push(c)
      columnIds.add(c.id)
    }
  }
  return {
    ...existing,
    boards: boards.sort((a, b) => a.sortOrder - b.sortOrder),
    columns,
  }
}

export function normalizeTasksStore(raw: TasksStore | undefined): TasksStore {
  if (!raw?.boards?.length) return createDefaultTasksStore()
  const boards = raw.boards
    .filter((b) => b?.id && b.title)
    .map((b) => ({
      id: b.id,
      title: b.title.trim(),
      department: b.department?.trim() || 'general',
      columnIds: Array.isArray(b.columnIds) ? b.columnIds.filter(Boolean) : [],
      sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : 0,
      archived: b.archived === true,
      ownerUserId: b.ownerUserId,
      enabledModules: b.enabledModules,
    }))
  const columns = (raw.columns ?? [])
    .filter((c) => c?.id && c.boardId && c.title)
    .map((c) => ({
      id: c.id,
      boardId: c.boardId,
      title: c.title.trim(),
      sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : 0,
      wipLimit: c.wipLimit,
      color: c.color,
    }))
  const tasks = (raw.tasks ?? [])
    .filter((t) => t?.id && t.boardId && t.columnId && t.title)
    .map(normalizeWorkTask)
  const comments = (raw.comments ?? []).filter((c) => c?.id && c.taskId && c.text)
  const attachments = (raw.attachments ?? []).filter((a) => a?.id && a.taskId)
  const rules = raw.rules ?? []
  return mergeSeedBoards({
    boards,
    columns,
    tasks,
    comments,
    attachments,
    rules,
    personalLists: raw.personalLists,
  })
}

export function normalizeWorkTask(t: WorkTask): WorkTask {
  const priority: TaskPriority =
    t.priority === 'low' || t.priority === 'high' || t.priority === 'urgent'
      ? t.priority
      : 'normal'
  const status =
    t.status === 'done' || t.status === 'cancelled' ? t.status : 'open'
  const assigneeUserIds = normalizeAssigneeUserIds(t)
  const assigneeDoneUserIds = taskAssigneeDoneUserIds({
    ...t,
    assigneeUserIds,
  })
  return {
    ...t,
    title: t.title.trim(),
    priority,
    status,
    assigneeUserIds: assigneeUserIds.length ? assigneeUserIds : undefined,
    assigneeUserId: primaryAssigneeUserId(assigneeUserIds) ?? t.assigneeUserId,
    assigneeDoneUserIds: assigneeDoneUserIds.length ? assigneeDoneUserIds : undefined,
    createdAt: t.createdAt || new Date().toISOString(),
    updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
  }
}

export function getBoardColumn(
  store: TasksStore,
  boardId: string,
): TaskColumn | undefined {
  const board = store.boards.find((b) => b.id === boardId)
  if (!board?.columnIds.length) return undefined
  const firstId = board.columnIds[0]
  return store.columns.find((c) => c.id === firstId)
}

export function buildWorkTask(
  draft: WorkTaskDraft,
  store: TasksStore,
  existing?: WorkTask,
): WorkTask {
  const now = new Date().toISOString()
  const columnId =
    draft.columnId ??
    existing?.columnId ??
    getBoardColumn(store, draft.boardId)?.id ??
    ''
  const id = draft.id ?? crypto.randomUUID()
  const draftAssignees = normalizeAssigneeUserIds({
    assigneeUserIds: draft.assigneeUserIds,
    assigneeUserId: draft.assigneeUserId,
  })
  const existingAssignees = existing ? normalizeAssigneeUserIds(existing) : []
  const assigneeUserIds =
    draft.assigneeUserIds !== undefined || draft.assigneeUserId !== undefined
      ? draftAssignees
      : existingAssignees
  return normalizeWorkTask({
    id,
    number: existing?.number ?? nextTaskNumber(store.tasks),
    boardId: draft.boardId,
    columnId,
    title: draft.title,
    description: draft.description ?? existing?.description,
    assigneeUserIds,
    assigneeUserId: primaryAssigneeUserId(assigneeUserIds),
    assigneeDoneUserIds: existing?.assigneeDoneUserIds,
    assigneeEmployeeId: draft.assigneeEmployeeId ?? existing?.assigneeEmployeeId,
    createdBy: existing?.createdBy ?? draft.createdBy,
    createdByName: existing?.createdByName ?? draft.createdByName,
    dueDate: draft.dueDate ?? existing?.dueDate,
    dueTime: draft.dueTime ?? existing?.dueTime,
    priority: draft.priority ?? existing?.priority ?? 'normal',
    status: existing?.status ?? 'open',
    checklist: draft.checklist ?? existing?.checklist,
    linkRefs: draft.linkRefs ?? existing?.linkRefs,
    attachmentIds: existing?.attachmentIds,
    sortOrder: existing?.sortOrder,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt: existing?.completedAt,
  })
}

export function buildTaskComment(
  taskId: string,
  text: string,
  by: string,
  byName?: string,
): TaskComment {
  return {
    id: crypto.randomUUID(),
    taskId,
    by,
    byName,
    text: text.trim(),
    at: new Date().toISOString(),
  }
}

export function columnTitle(store: TasksStore, columnId: string): string {
  return store.columns.find((c) => c.id === columnId)?.title ?? columnId
}

export function boardTitle(store: TasksStore, boardId: string): string {
  return store.boards.find((b) => b.id === boardId)?.title ?? boardId
}

export function isDoneColumn(store: TasksStore, columnId: string): boolean {
  const col = store.columns.find((c) => c.id === columnId)
  if (!col) return false
  const t = col.title.toLowerCase()
  return t.includes('готово') || t.includes('done') || t.includes('დასრულ')
}

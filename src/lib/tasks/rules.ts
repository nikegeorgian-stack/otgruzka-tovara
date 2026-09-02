import type { TasksStore } from './types'

export function columnWipLimit(store: TasksStore, columnId: string): number | undefined {
  const col = store.columns.find((c) => c.id === columnId)
  if (typeof col?.wipLimit === 'number' && col.wipLimit > 0) return col.wipLimit
  const rule = store.rules.find((r) => r.kind === 'wip_limit' && r.columnId === columnId)
  if (rule?.kind === 'wip_limit' && rule.max > 0) return rule.max
  return undefined
}

export function columnTaskCount(
  store: TasksStore,
  boardId: string,
  columnId: string,
): number {
  return store.tasks.filter(
    (t) =>
      t.boardId === boardId &&
      t.columnId === columnId &&
      t.status !== 'cancelled' &&
      t.status !== 'done',
  ).length
}

export function isWipOverLimit(store: TasksStore, boardId: string, columnId: string): boolean {
  const limit = columnWipLimit(store, columnId)
  if (!limit) return false
  return columnTaskCount(store, boardId, columnId) > limit
}

export function autoAssignUserId(store: TasksStore, _boardId: string, columnId: string): string | undefined {
  const rule = store.rules.find(
    (r) => r.kind === 'auto_assign_column' && r.columnId === columnId,
  )
  if (rule?.kind !== 'auto_assign_column' || !rule.userIds.length) return undefined
  return rule.userIds[0]
}

import type { WorkTask } from './types'

export type TaskAssigneeFields = Pick<WorkTask, 'assigneeUserId' | 'assigneeUserIds'>

/** Все исполнители задачи (новое поле + legacy одиночный id). */
export function taskAssigneeUserIds(task: TaskAssigneeFields): string[] {
  if (Array.isArray(task.assigneeUserIds) && task.assigneeUserIds.length > 0) {
    return [...new Set(task.assigneeUserIds.filter(Boolean))]
  }
  if (task.assigneeUserId) return [task.assigneeUserId]
  return []
}

export function taskHasAssignee(task: TaskAssigneeFields, userId: string): boolean {
  return taskAssigneeUserIds(task).includes(userId)
}

export function taskAssigneeDoneUserIds(task: WorkTask): string[] {
  const ids = task.assigneeDoneUserIds ?? []
  const assignees = new Set(taskAssigneeUserIds(task))
  return ids.filter(id => assignees.has(id))
}

export function taskAssigneeProgress(task: WorkTask): { done: number; total: number } {
  const total = taskAssigneeUserIds(task).length
  if (total === 0) return { done: 0, total: 0 }
  return { done: taskAssigneeDoneUserIds(task).length, total }
}

export function allAssigneesMarkedDone(task: WorkTask): boolean {
  const assignees = taskAssigneeUserIds(task)
  if (assignees.length === 0) return false
  const done = new Set(taskAssigneeDoneUserIds(task))
  return assignees.every(id => done.has(id))
}

export function normalizeAssigneeUserIds(
  task: Partial<WorkTask> & TaskAssigneeFields,
): string[] {
  const fromArray = Array.isArray(task.assigneeUserIds)
    ? task.assigneeUserIds.filter(Boolean)
    : []
  if (fromArray.length > 0) return [...new Set(fromArray)]
  if (task.assigneeUserId) return [task.assigneeUserId]
  return []
}

export function assigneeIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((id, i) => id === sb[i])
}

export function primaryAssigneeUserId(ids: string[]): string | undefined {
  return ids[0]
}

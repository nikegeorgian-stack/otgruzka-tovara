import { appendAudit } from '@/lib/audit'
import {
  assigneeIdsEqual,
  taskAssigneeDoneUserIds,
  taskAssigneeUserIds,
  taskHasAssignee,
} from '@/lib/tasks/assignees'
import {
  boardTitle,
  buildTaskComment,
  buildWorkTask,
  columnTitle,
  isDoneColumn,
  normalizeTasksStore,
  normalizeWorkTask,
} from '@/lib/tasks/init'
import type { WorkTaskDraft, TaskAttachment } from '@/lib/tasks/types'
import { autoAssignUserId } from '@/lib/tasks/rules'
import type { AppStore } from '@/lib/types'
import { actorAuditFields } from './actorAuditFields'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createTasksSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const who = () => actorAuditFields(getActor)

  return {
    createWorkTask(draft: WorkTaskDraft) {
      let createdId = ''
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        let row = buildWorkTask(draft, tasks)
        const autoUser = autoAssignUserId(tasks, row.boardId, row.columnId)
        if (autoUser && taskAssigneeUserIds(row).length === 0) {
          row = normalizeWorkTask({
            ...row,
            assigneeUserIds: [autoUser],
            assigneeUserId: autoUser,
          })
        }
        createdId = row.id
        let next: AppStore = {
          ...s,
          tasks: { ...tasks, tasks: [row, ...tasks.tasks] },
        }
        next = appendAudit(next, {
          action: 'task_create',
          detail: `${row.number ?? row.id.slice(0, 8)} · ${row.title} · ${boardTitle(tasks, row.boardId)}`,
          ...who(),
        })
        return next
      })
      return createdId
    },

    updateWorkTask(draft: WorkTaskDraft & { id: string }) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === draft.id)
        if (!existing) return s
        const row = buildWorkTask(draft, tasks, existing)
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => (t.id === row.id ? row : t)),
          },
        }
        next = appendAudit(next, {
          action: 'task_update',
          detail: `${row.number ?? row.title} · ${boardTitle(tasks, row.boardId)}`,
          ...who(),
        })
        const prevAssignees = taskAssigneeUserIds(existing)
        const nextAssignees = taskAssigneeUserIds(row)
        if (!assigneeIdsEqual(prevAssignees, nextAssignees)) {
          next = appendAudit(next, {
            action: 'task_assign',
            detail: `${row.number ?? row.title} → ${nextAssignees.length ? nextAssignees.join(', ') : '—'}`,
            ...who(),
          })
        }
        return next
      })
    },

    moveWorkTask(taskId: string, columnId: string) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!existing || existing.columnId === columnId) return s
        const done = isDoneColumn(tasks, columnId)
        const now = new Date().toISOString()
        const autoUser = autoAssignUserId(tasks, existing.boardId, columnId)
        const existingAssignees = taskAssigneeUserIds(existing)
        const assigneeUserIds =
          autoUser && existingAssignees.length === 0
            ? [autoUser]
            : existingAssignees
        const row = normalizeWorkTask({
          ...existing,
          columnId,
          assigneeUserIds,
          assigneeUserId: assigneeUserIds[0],
          status: done ? ('done' as const) : existing.status === 'done' ? 'open' : existing.status,
          updatedAt: now,
          completedAt: done ? now : existing.status === 'done' ? undefined : existing.completedAt,
        })
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => (t.id === taskId ? row : t)),
          },
        }
        next = appendAudit(next, {
          action: 'task_move',
          detail: `${existing.number ?? existing.title}: ${columnTitle(tasks, existing.columnId)} → ${columnTitle(tasks, columnId)}`,
          oldValue: existing.columnId,
          newValue: columnId,
          ...who(),
        })
        if (done) {
          next = appendAudit(next, {
            action: 'task_complete',
            detail: existing.number ?? existing.title,
            ...who(),
          })
        }
        return next
      })
    },

    completeWorkTask(taskId: string) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!existing) return s
        const board = tasks.boards.find((b) => b.id === existing.boardId)
        const doneColId =
          [...(board?.columnIds ?? [])]
            .reverse()
            .find((id) => isDoneColumn(tasks, id)) ?? existing.columnId
        if (existing.status === 'done' && existing.columnId === doneColId) return s
        const now = new Date().toISOString()
        const row = {
          ...existing,
          columnId: doneColId,
          status: 'done' as const,
          updatedAt: now,
          completedAt: now,
        }
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => (t.id === taskId ? row : t)),
          },
        }
        next = appendAudit(next, {
          action: 'task_complete',
          detail: existing.number ?? existing.title,
          ...who(),
        })
        return next
      })
    },

    cancelWorkTask(taskId: string) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!existing || existing.status === 'cancelled') return s
        const row = {
          ...existing,
          status: 'cancelled' as const,
          updatedAt: new Date().toISOString(),
        }
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => (t.id === taskId ? row : t)),
          },
        }
        next = appendAudit(next, {
          action: 'task_cancel',
          detail: existing.number ?? existing.title,
          ...who(),
        })
        return next
      })
    },

    addTaskComment(taskId: string, text: string) {
      const actor = getActor?.()
      const actorId = actor?.id
      if (!text.trim() || !actorId) return
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!existing) return s
        const comment = buildTaskComment(taskId, text, actorId, actor?.name)
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            comments: [comment, ...tasks.comments],
            tasks: tasks.tasks.map((t) =>
              t.id === taskId ? { ...t, updatedAt: new Date().toISOString() } : t,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'task_comment',
          detail: `${existing.number ?? existing.title}: ${text.trim().slice(0, 80)}`,
          ...who(),
        })
        return next
      })
    },

    toggleTaskChecklistItem(taskId: string, itemId: string) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        return {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => {
              if (t.id !== taskId || !t.checklist) return t
              return {
                ...t,
                updatedAt: new Date().toISOString(),
                checklist: t.checklist.map((c) =>
                  c.id === itemId ? { ...c, done: !c.done } : c,
                ),
              }
            }),
          },
        }
      })
    },

    addTaskAttachmentMeta(attachment: TaskAttachment) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === attachment.taskId)
        if (!existing) return s
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            attachments: [attachment, ...tasks.attachments],
            tasks: tasks.tasks.map((t) =>
              t.id === attachment.taskId
                ? {
                    ...t,
                    attachmentIds: [...(t.attachmentIds ?? []), attachment.id],
                    updatedAt: new Date().toISOString(),
                  }
                : t,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'task_attach_add',
          detail: `${existing.number ?? existing.title}: ${attachment.fileName}`,
          ...who(),
        })
        return next
      })
    },

    toggleTaskAssigneeDone(taskId: string, userId: string) {
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!existing || !taskHasAssignee(existing, userId)) return s
        const done = taskAssigneeDoneUserIds(existing)
        const marked = done.includes(userId)
        const assigneeDoneUserIds = marked
          ? done.filter((id) => id !== userId)
          : [...done, userId]
        const now = new Date().toISOString()
        const row = normalizeWorkTask({
          ...existing,
          assigneeDoneUserIds,
          updatedAt: now,
        })
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            tasks: tasks.tasks.map((t) => (t.id === taskId ? row : t)),
          },
        }
        next = appendAudit(next, {
          action: 'task_update',
          detail: `${existing.number ?? existing.title}: ${marked ? 'снята' : 'отмечена'} готовность ${userId.slice(0, 8)}`,
          ...who(),
        })
        return next
      })
    },

    beginTaskAttachmentDelete(taskId: string, attachmentId: string) {
      // P: no outbox — drop attachment meta immediately (pre-cloud behavior).
      const tasks = normalizeTasksStore(getStore().tasks)
      const att = tasks.attachments.find((a) => a.id === attachmentId)
      const existing = tasks.tasks.find((t) => t.id === taskId)
      if (!att || !existing) return
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const att = tasks.attachments.find((a) => a.id === attachmentId)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!att || !existing) return s
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            attachments: tasks.attachments.filter((a) => a.id !== attachmentId),
            tasks: tasks.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    attachmentIds: (t.attachmentIds ?? []).filter((id) => id !== attachmentId),
                    updatedAt: new Date().toISOString(),
                  }
                : t,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'task_attach_remove',
          detail: `${existing.number ?? existing.title}: ${att.fileName}`,
          ...who(),
        })
        return next
      })
    },

    removeTaskAttachmentMeta(taskId: string, attachmentId: string) {
      const tasks = normalizeTasksStore(getStore().tasks)
      const att = tasks.attachments.find((a) => a.id === attachmentId)
      const existing = tasks.tasks.find((t) => t.id === taskId)
      if (!att || !existing) return
      patchStore(setStore, (s) => {
        const tasks = normalizeTasksStore(s.tasks)
        const att = tasks.attachments.find((a) => a.id === attachmentId)
        const existing = tasks.tasks.find((t) => t.id === taskId)
        if (!att || !existing) return s
        let next: AppStore = {
          ...s,
          tasks: {
            ...tasks,
            attachments: tasks.attachments.filter((a) => a.id !== attachmentId),
            tasks: tasks.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    attachmentIds: (t.attachmentIds ?? []).filter((id) => id !== attachmentId),
                    updatedAt: new Date().toISOString(),
                  }
                : t,
            ),
          },
        }
        next = appendAudit(next, {
          action: 'task_attach_remove',
          detail: `${existing.number ?? existing.title}: ${att.fileName}`,
          ...who(),
        })
        return next
      })
    },
  }
}

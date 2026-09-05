import { useEffect, useMemo, useState } from 'react'
import { TasksAssigneePicker } from '@/components/tasks/TasksAssigneePicker'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { canEditWorkTask, resolveTaskAccessLevel } from '@/lib/tasks/access'
import { taskAssigneeUserIds } from '@/lib/tasks/assignees'
import { boardTitle, columnTitle } from '@/lib/tasks/init'
import { linkedDraftLabel } from '@/components/tasks/CreateLinkedTaskButton'
import {
  taskAttachmentDownloadUrl,
  uploadTaskAttachmentFile,
} from '@/lib/tasks/taskAttachmentStorage'
import { findOutboxItem } from '@/lib/cloud/externalEffects/outbox'
import { isExternalDeletionRuntimeEnabled } from '@/lib/cloud/externalEffects/runtime'
import type { AppStore } from '@/lib/types'
import type { TaskAttachment, TaskComment, TaskPriority, TasksStore, WorkTask } from '@/lib/tasks/types'

type Props = {
  open: boolean
  task: WorkTask | null
  tasksStore: TasksStore
  access: AccessStore
  currentUser: AppUser | null
  comments: TaskComment[]
  attachments: TaskAttachment[]
  externalEffects?: AppStore['externalEffects']
  onAddTaskAttachmentMeta: (attachment: TaskAttachment) => void
  onBeginTaskAttachmentDelete: (taskId: string, attachmentId: string) => void
  onRemoveTaskAttachmentMeta: (taskId: string, attachmentId: string) => void
  onClose: () => void
  onSave: (draft: {
    id?: string
    boardId: string
    columnId?: string
    title: string
    description?: string
    assigneeUserIds?: string[]
    dueDate?: string
    priority?: TaskPriority
    checklist?: { id: string; text: string; done: boolean }[]
    linkRefs?: WorkTask['linkRefs']
  }) => void
  onMove: (taskId: string, columnId: string) => void
  onComplete: (taskId: string) => void
  onCancel: (taskId: string) => void
  onComment: (taskId: string, text: string) => void
  onToggleChecklist: (taskId: string, itemId: string) => void
  onToggleAssigneeDone: (taskId: string, userId: string) => void
}

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent']

export function TaskCardModal({
  open,
  task,
  tasksStore,
  access,
  currentUser,
  comments,
  attachments,
  externalEffects,
  onAddTaskAttachmentMeta,
  onBeginTaskAttachmentDelete,
  onClose,
  onSave,
  onMove,
  onComplete,
  onCancel,
  onComment,
  onToggleChecklist,
  onToggleAssigneeDone,
}: Props) {
  const { t, tf } = useI18n()
  const isNew = !task?.id
  const canHardDeleteAttachments = isExternalDeletionRuntimeEnabled()
  const boardId = task?.boardId ?? ''
  const canEdit =
    task && currentUser
      ? canEditWorkTask(task, currentUser, access, boardId) || isNew
      : isNew
  const level = resolveTaskAccessLevel(currentUser, access)
  const canMarkAnyAssignee = level === 'manage' || level === 'board'

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeUserIds, setAssigneeUserIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [commentText, setCommentText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? '')
    setDescription(task?.description ?? '')
    setAssigneeUserIds(task ? taskAssigneeUserIds(task) : [])
    setDueDate(task?.dueDate ?? '')
    setPriority(task?.priority ?? 'normal')
    setCommentText('')
    setDirty(false)
  }, [open, task])

  const board = tasksStore.boards.find((b) => b.id === boardId)
  const columns = useMemo(
    () =>
      (board?.columnIds ?? [])
        .map((id) => tasksStore.columns.find((c) => c.id === id))
        .filter(Boolean),
    [board, tasksStore.columns],
  )

  const taskComments = useMemo(
    () =>
      comments
        .filter((c) => c.taskId === task?.id)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [comments, task?.id],
  )

  const taskAttachments = useMemo(
    () =>
      attachments
        .filter((a) => a.taskId === task?.id)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    [attachments, task?.id],
  )

  const activeUsers = access.users.filter((u) => u.active)

  async function handleFilePick(file: File | null) {
    if (!file || !task?.id || !currentUser) return
    setUploading(true)
    try {
      const meta = await uploadTaskAttachmentFile(task.id, file, currentUser.id)
      if (meta) onAddTaskAttachmentMeta(meta)
    } finally {
      setUploading(false)
    }
  }

  function handleSave() {
    if (!title.trim() || !boardId || !currentUser) return
    onSave({
      id: task?.id,
      boardId,
      columnId: task?.columnId,
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeUserIds,
      dueDate: dueDate || undefined,
      priority,
      checklist: task?.checklist,
      linkRefs: task?.linkRefs,
    })
    setDirty(false)
    onClose()
  }

  function canToggleDoneFor(userId: string): boolean {
    if (!currentUser || !task?.id) return false
    if (canMarkAnyAssignee) return assigneeUserIds.includes(userId)
    return currentUser.id === userId && assigneeUserIds.includes(userId)
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={isNew ? t('tasks.card.newTitle') : task?.number ?? task?.title ?? ''}
      subtitle={
        task
          ? `${boardTitle(tasksStore, task.boardId)} · ${columnTitle(tasksStore, task.columnId)}`
          : undefined
      }
      size="lg"
      dirty={dirty}
      onSaveDirty={handleSave}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {task && task.status === 'open' ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => onComplete(task.id)}>
                {t('tasks.card.complete')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => onCancel(task.id)}>
                {t('tasks.card.cancelTask')}
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
              {t('common.save')}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block space-y-1">
          <span className="text-stone-600">{t('tasks.card.title')}</span>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
            disabled={!canEdit}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-stone-600">{t('tasks.card.description')}</span>
          <textarea
            className="fc-input min-h-[80px] w-full"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              setDirty(true)
            }}
            disabled={!canEdit}
          />
        </label>

        <TasksAssigneePicker
          users={activeUsers}
          selectedIds={assigneeUserIds}
          onChange={(ids) => {
            setAssigneeUserIds(ids)
            setDirty(true)
          }}
          readonly={!canEdit}
          task={task?.id ? task : undefined}
          onToggleDone={
            task?.id
              ? (userId) => {
                  if (canToggleDoneFor(userId)) {
                    onToggleAssigneeDone(task.id, userId)
                  }
                }
              : undefined
          }
          labels={{
            title: t('tasks.card.assignees'),
            empty: t('tasks.card.assigneesEmpty'),
            markDone: t('tasks.card.markDone'),
            progress: (done, total) => tf('tasks.card.assigneeProgress', { done, total }),
          }}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-stone-600">{t('tasks.card.dueDate')}</span>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value)
                setDirty(true)
              }}
              disabled={!canEdit}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-stone-600">{t('tasks.card.priority')}</span>
            <select
              className="fc-input w-full"
              value={priority}
              onChange={(e) => {
                setPriority(e.target.value as TaskPriority)
                setDirty(true)
              }}
              disabled={!canEdit}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`tasks.priority.${p}`)}
                </option>
              ))}
            </select>
          </label>
          {task && columns.length > 0 ? (
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-stone-600">{t('tasks.card.column')}</span>
              <select
                className="fc-input w-full"
                value={task.columnId}
                onChange={(e) => onMove(task.id, e.target.value)}
                disabled={!canEdit}
              >
                {columns.map((c) =>
                  c ? (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ) : null,
                )}
              </select>
            </label>
          ) : null}
        </div>
        {task?.linkRefs?.length ? (
          <div className="flex flex-wrap gap-2">
            {task.linkRefs.map((link) => (
              <span
                key={`${link.type}-${link.id}`}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700"
              >
                {t(`tasks.link.${link.type}`)}: {linkedDraftLabel(link)}
              </span>
            ))}
          </div>
        ) : null}
        {task?.checklist?.length ? (
          <div className="space-y-2">
            <div className="font-medium text-stone-700">{t('tasks.card.checklist')}</div>
            <ul className="space-y-1">
              {task.checklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => onToggleChecklist(task.id, item.id)}
                  />
                  <span className={item.done ? 'line-through text-stone-400' : ''}>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {task ? (
          <div className="space-y-2 border-t border-stone-200 pt-3">
            <div className="font-medium text-stone-700">{t('tasks.card.attachments')}</div>
            <ul className="space-y-1 text-xs">
              {taskAttachments.map((a) => {
                const outbox = a.externalEffectOperationId
                  ? findOutboxItem({ externalEffects } as AppStore, a.externalEffectOperationId)
                  : undefined
                const pendingLabel = a.pendingDeletion
                  ? outbox?.status === 'failed'
                    ? t('externalEffects.fileDeleteFailed')
                    : outbox?.step === 'await_final_sql'
                      ? t('externalEffects.fileAwaitFinalSave')
                      : t('externalEffects.filePendingDelete')
                  : null
                return (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="truncate text-sky-700 hover:underline"
                      disabled={a.pendingDeletion}
                      onClick={() => void taskAttachmentDownloadUrl(a.storagePath).then((url) => {
                        if (url) window.open(url, '_blank', 'noopener')
                      })}
                    >
                      {a.fileName}
                    </button>
                    {pendingLabel ? (
                      <div className="text-[10px] text-amber-700">{pendingLabel}</div>
                    ) : null}
                  </div>
                  {canEdit && canHardDeleteAttachments && !a.pendingDeletion ? (
                    <button
                      type="button"
                      className="text-stone-400 hover:text-rose-600"
                      onClick={() => {
                        onBeginTaskAttachmentDelete(task.id, a.id)
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              )})}
            </ul>
            {canEdit && !canHardDeleteAttachments ? (
              <p className="text-[11px] text-amber-800">{t('access.externalDeleteWebOnly')}</p>
            ) : null}
            {canEdit ? (
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-stone-600">
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => void handleFilePick(e.target.files?.[0] ?? null)}
                />
                <span className="rounded border border-stone-200 px-2 py-1 hover:bg-stone-50">
                  {uploading ? t('tasks.card.uploading') : t('tasks.card.addAttachment')}
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
        {task ? (
          <div className="space-y-2 border-t border-stone-200 pt-3">
            <div className="font-medium text-stone-700">{t('tasks.card.comments')}</div>
            <ul className="max-h-40 space-y-2 overflow-y-auto">
              {taskComments.map((c) => (
                <li key={c.id} className="rounded bg-stone-50 px-2 py-1.5 text-xs">
                  <div className="text-stone-500">
                    {c.byName ?? c.by.slice(0, 8)} · {c.at.slice(0, 16).replace('T', ' ')}
                  </div>
                  <div className="whitespace-pre-wrap">{c.text}</div>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={t('tasks.card.commentPlaceholder')}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!commentText.trim()) return
                  onComment(task.id, commentText)
                  setCommentText('')
                }}
              >
                {t('tasks.card.addComment')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </AppDialog>
  )
}

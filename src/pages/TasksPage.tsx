import { useMemo, useState } from 'react'
import { TasksSummaryTab } from '@/components/tasks/TasksSummaryTab'
import { TaskCardModal } from '@/components/tasks/TaskCardModal'
import { TasksBoardTab } from '@/components/tasks/TasksBoardTab'
import { TasksMyTab } from '@/components/tasks/TasksMyTab'
import { TasksWorkspaceNav } from '@/components/tasks/TasksWorkspaceNav'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { useI18n } from '@/context/I18nContext'
import type { AppUser } from '@/lib/access/types'
import {
  canUseTasksSection,
  canViewTaskBoards,
  canViewTasksSummary,
  resolveTaskAccessLevel,
  resolveTaskBoardIds,
} from '@/lib/tasks/access'
import { getBoardColumn, normalizeTasksStore } from '@/lib/tasks/init'
import type { TaskAttachment, WorkTask, WorkTaskDraft } from '@/lib/tasks/types'
import type { AppStore } from '@/lib/types'

type TabId = 'my' | 'boards' | 'summary'

type Props = {
  store: AppStore
  currentUser: AppUser | null
  onCreateWorkTask: (draft: WorkTaskDraft) => string
  onUpdateWorkTask: (draft: WorkTaskDraft & { id: string }) => void
  onMoveWorkTask: (taskId: string, columnId: string) => void
  onCompleteWorkTask: (taskId: string) => void
  onCancelWorkTask: (taskId: string) => void
  onAddTaskComment: (taskId: string, text: string) => void
  onToggleTaskChecklistItem: (taskId: string, itemId: string) => void
  onToggleTaskAssigneeDone: (taskId: string, userId: string) => void
  onAddTaskAttachmentMeta: (attachment: TaskAttachment) => void
  onBeginTaskAttachmentDelete: (taskId: string, attachmentId: string) => void
  onRemoveTaskAttachmentMeta: (taskId: string, attachmentId: string) => void
}

export function TasksPage({
  store,
  currentUser,
  onCreateWorkTask,
  onUpdateWorkTask,
  onMoveWorkTask,
  onCompleteWorkTask,
  onCancelWorkTask,
  onAddTaskComment,
  onToggleTaskChecklistItem,
  onToggleTaskAssigneeDone,
  onAddTaskAttachmentMeta,
  onBeginTaskAttachmentDelete,
  onRemoveTaskAttachmentMeta,
}: Props) {
  const { t } = useI18n()
  const tasksStore = useMemo(() => normalizeTasksStore(store.tasks), [store.tasks])
  const level = resolveTaskAccessLevel(currentUser, store.access)
  const boardIds = resolveTaskBoardIds(currentUser, store.access)
  const showBoards = canViewTaskBoards(level)
  const showSummary = canViewTasksSummary(currentUser, store.access)

  const tabs: { id: TabId; label: string; coach?: string }[] = [
    { id: 'my', label: t('tasks.tab.my'), coach: 'tasks:my' },
  ]
  if (showBoards) {
    tabs.push({ id: 'boards', label: t('tasks.tab.boards'), coach: 'tasks:boards' })
  }
  if (showSummary) {
    tabs.push({ id: 'summary', label: t('tasks.tab.summary'), coach: 'tasks:summary' })
  }

  const [tab, setTab] = useState<TabId>('my')
  const activeTab = tabs.some((x) => x.id === tab) ? tab : 'my'

  const [cardOpen, setCardOpen] = useState(false)
  const [editing, setEditing] = useState<WorkTask | null>(null)

  if (!canUseTasksSection(level) || !currentUser) {
    return (
      <PageLayout>
        <PageHeader title={t('nav.tasks')} />
        <p className="text-sm text-stone-500">{t('tasks.noAccess')}</p>
      </PageLayout>
    )
  }

  function openNew(boardId: string) {
    const col = getBoardColumn(tasksStore, boardId)
    if (!col) return
    setEditing({
      id: '',
      boardId,
      columnId: col.id,
      title: '',
      createdBy: currentUser!.id,
      createdByName: currentUser!.displayName,
      priority: 'normal',
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    setCardOpen(true)
  }

  function openTask(task: WorkTask) {
    setEditing(task)
    setCardOpen(true)
  }

  function handleSave(draft: {
    id?: string
    boardId: string
    columnId?: string
    title: string
    description?: string
    assigneeUserIds?: string[]
    dueDate?: string
    priority?: WorkTask['priority']
    checklist?: WorkTask['checklist']
    linkRefs?: WorkTask['linkRefs']
  }) {
    if (!currentUser) return
    const base: WorkTaskDraft = {
      boardId: draft.boardId,
      columnId: draft.columnId,
      title: draft.title,
      description: draft.description,
      assigneeUserIds: draft.assigneeUserIds,
      assigneeUserId: draft.assigneeUserIds?.[0],
      dueDate: draft.dueDate,
      priority: draft.priority,
      checklist: draft.checklist,
      linkRefs: draft.linkRefs,
      createdBy: currentUser.id,
      createdByName: currentUser.displayName,
    }
    if (draft.id) {
      onUpdateWorkTask({ ...base, id: draft.id })
    } else {
      onCreateWorkTask(base)
    }
  }

  return (
    <PageLayout>
      <PageHeader title={t('nav.tasks')} subtitle={t('nav.tasksHint')} />
      <TasksWorkspaceNav tabs={tabs} value={activeTab} onChange={(id) => setTab(id as TabId)} />
      <div
        key={activeTab}
        className="mt-5 animate-[fadeIn_0.25s_ease-out]"
        style={{
          animation: 'tasksFadeIn 0.28s ease-out',
        }}
      >
        {activeTab === 'my' ? (
          <TasksMyTab
            tasksStore={tasksStore}
            userId={currentUser.id}
            onOpenTask={openTask}
          />
        ) : activeTab === 'boards' ? (
          <TasksBoardTab
            tasksStore={tasksStore}
            boardIds={boardIds}
            users={store.access.users}
            currentUser={currentUser}
            access={store.access}
            onOpenTask={openTask}
            onMoveTask={onMoveWorkTask}
            onAddTask={openNew}
          />
        ) : (
          <TasksSummaryTab
            tasksStore={tasksStore}
            boardIds={
              currentUser.roleId === 'sysadmin'
                ? tasksStore.boards.map((b) => b.id)
                : boardIds
            }
            onOpenTask={openTask}
          />
        )}
      </div>
      <style>{`
        @keyframes tasksFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <TaskCardModal
        open={cardOpen}
        task={editing?.id ? editing : editing}
        tasksStore={tasksStore}
        access={store.access}
        currentUser={currentUser}
        comments={tasksStore.comments}
        attachments={tasksStore.attachments}
        onAddTaskAttachmentMeta={onAddTaskAttachmentMeta}
        onBeginTaskAttachmentDelete={onBeginTaskAttachmentDelete}
        onRemoveTaskAttachmentMeta={onRemoveTaskAttachmentMeta}
        onClose={() => {
          setCardOpen(false)
          setEditing(null)
        }}
        onSave={handleSave}
        onMove={onMoveWorkTask}
        onComplete={(id) => {
          onCompleteWorkTask(id)
          setCardOpen(false)
        }}
        onCancel={(id) => {
          onCancelWorkTask(id)
          setCardOpen(false)
        }}
        onComment={onAddTaskComment}
        onToggleChecklist={onToggleTaskChecklistItem}
        onToggleAssigneeDone={onToggleTaskAssigneeDone}
      />
    </PageLayout>
  )
}

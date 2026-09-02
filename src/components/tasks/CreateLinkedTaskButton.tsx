import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { canAccessView } from '@/lib/access/permissions'
import type { AccessStore, AppUser } from '@/lib/access/types'
import { canCreateTaskOnBoard } from '@/lib/tasks/access'
import { boardIdForLinkType } from '@/lib/tasks/linkRefs'
import type { TaskLinkRef, WorkTaskDraft } from '@/lib/tasks/types'

type Props = {
  draft: WorkTaskDraft
  access: AccessStore
  currentUser: AppUser | null
  onCreate: (draft: WorkTaskDraft) => string
  onCreated?: (taskId: string) => void
  size?: 'sm' | 'md'
  variant?: 'secondary' | 'primary'
  labelKey?: string
  dataCoach?: string
}

export function CreateLinkedTaskButton({
  draft,
  access,
  currentUser,
  onCreate,
  onCreated,
  size = 'sm',
  variant = 'secondary',
  labelKey = 'tasks.link.create',
  dataCoach = 'tasks:linkCreate',
}: Props) {
  const { t } = useI18n()
  const boardId =
    draft.boardId ||
    (draft.linkRefs?.[0] ? boardIdForLinkType(draft.linkRefs[0].type) : '')
  const visible =
    currentUser &&
    canAccessView(access, currentUser, 'tasks') &&
    boardId &&
    canCreateTaskOnBoard(boardId, currentUser, access)

  if (!visible) return null

  return (
    <Button
      variant={variant}
      size={size}
      data-coach={dataCoach}
      onClick={() => {
        const id = onCreate({ ...draft, boardId })
        onCreated?.(id)
      }}
    >
      {t(labelKey)}
    </Button>
  )
}

export function linkedDraftLabel(link: TaskLinkRef): string {
  return link.label ?? link.id.slice(0, 8)
}

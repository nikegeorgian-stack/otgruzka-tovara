import { useCallback } from 'react'
import type { DirectorySection } from '@/lib/directories/types'
import { directorySectionTitle } from '@/lib/workspace/labels'
import type { ViewId } from '@/lib/types'
import type { WorkspaceBranchFrom, WorkspaceBranchTarget } from '@/lib/workspace/types'

type BranchWorkspace = (
  target: WorkspaceBranchTarget,
  from?: WorkspaceBranchFrom,
) => void

type Options = {
  t: (key: string) => string
  branchWorkspace: BranchWorkspace
  onNavigateToDirectory?: (section: DirectorySection) => void
  /** Если true — открыть справочник в стеке workspace с черновиком */
  stackDraft: boolean
  returnTitle: string
  returnView: ViewId
  draftKey: string
  draft: unknown
}

export function useDirectoryBranch({
  t,
  branchWorkspace,
  onNavigateToDirectory,
  stackDraft,
  returnTitle,
  returnView,
  draftKey,
  draft,
}: Options) {
  return useCallback(
    (section: DirectorySection) => {
      if (stackDraft) {
        branchWorkspace(
          {
            title: directorySectionTitle(section, t),
            view: 'directories',
            directorySection: section,
          },
          {
            title: returnTitle,
            draftKey,
            draft,
            view: returnView,
          },
        )
        return
      }
      onNavigateToDirectory?.(section)
    },
    [
      branchWorkspace,
      draft,
      draftKey,
      onNavigateToDirectory,
      returnTitle,
      returnView,
      stackDraft,
      t,
    ],
  )
}

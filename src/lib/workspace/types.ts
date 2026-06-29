import type { DirectorySection } from '@/lib/directories/types'
import type { ViewId } from '@/lib/types'

export type WorkspacePane = {
  id: string
  title: string
  view: ViewId
  directorySection?: DirectorySection
  /** Ключ черновика в workspaceDrafts */
  draftKey?: string
}

export type WorkspaceBranchFrom = {
  title: string
  draftKey: string
  draft: unknown
  view: ViewId
  directorySection?: DirectorySection
}

export type WorkspaceBranchTarget = {
  title: string
  view: ViewId
  directorySection?: DirectorySection
}

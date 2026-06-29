import type { DirectorySection } from '@/lib/directories/types'
import {
  saveWorkspaceDrafts,
  saveWorkspacePanesJson,
} from '@/lib/persistence/workspaceDrafts'
import type { ViewId } from '@/lib/types'
import type {
  WorkspaceBranchFrom,
  WorkspaceBranchTarget,
  WorkspacePane,
} from '@/lib/workspace/types'
import type { Dispatch, SetStateAction } from 'react'

export type WorkspaceUiState = {
  view: ViewId
  directorySection: DirectorySection
  workspacePanes: WorkspacePane[]
  activeWorkspacePaneId: string | null
  workspaceDrafts: Record<string, unknown>
  workspaceRestoreSeq: number
}

export type WorkspaceSliceDeps = {
  setView: Dispatch<SetStateAction<ViewId>>
  setDirectorySection: Dispatch<SetStateAction<DirectorySection>>
  setWorkspacePanes: Dispatch<SetStateAction<WorkspacePane[]>>
  setActiveWorkspacePaneId: Dispatch<SetStateAction<string | null>>
  setWorkspaceDrafts: Dispatch<SetStateAction<Record<string, unknown>>>
  setWorkspaceRestoreSeq: Dispatch<SetStateAction<number>>
}

function persistDrafts(drafts: Record<string, unknown>) {
  saveWorkspaceDrafts(drafts)
}

function persistPanes(panes: WorkspacePane[]) {
  saveWorkspacePanesJson(panes.length ? JSON.stringify(panes) : null)
}

export function createWorkspaceSlice(deps: WorkspaceSliceDeps) {
  const {
    setView,
    setDirectorySection,
    setWorkspacePanes,
    setActiveWorkspacePaneId,
    setWorkspaceDrafts,
    setWorkspaceRestoreSeq,
  } = deps

  return {
    navigateToDirectory(section: DirectorySection) {
      setDirectorySection(section)
      setView('directories')
      const paneId = `dir:${section}`
      setActiveWorkspacePaneId(paneId)
    },

    branchWorkspace(target: WorkspaceBranchTarget, from?: WorkspaceBranchFrom) {
      if (from) {
        setWorkspaceDrafts((d) => {
          const next = { ...d, [from.draftKey]: from.draft }
          persistDrafts(next)
          return next
        })
      }

      const toId = target.directorySection
        ? `dir:${target.directorySection}`
        : `view:${target.view}`

      setWorkspacePanes((prev) => {
        const panes = [...prev]
        if (from) {
          const fromId = `draft:${from.draftKey}`
          const fromPane: WorkspacePane = {
            id: fromId,
            title: from.title,
            view: from.view,
            directorySection: from.directorySection,
            draftKey: from.draftKey,
          }
          const fromIdx = panes.findIndex((p) => p.id === fromId)
          if (fromIdx >= 0) panes[fromIdx] = fromPane
          else panes.push(fromPane)
        }
        const toPane: WorkspacePane = {
          id: toId,
          title: target.title,
          view: target.view,
          directorySection: target.directorySection,
        }
        const toIdx = panes.findIndex((p) => p.id === toId)
        if (toIdx >= 0) panes[toIdx] = toPane
        else panes.push(toPane)
        persistPanes(panes)
        return panes
      })

      setActiveWorkspacePaneId(toId)
      setView(target.view)
      if (target.directorySection) setDirectorySection(target.directorySection)
      setWorkspaceRestoreSeq((s) => s + 1)
    },

    activateWorkspacePane(paneId: string) {
      setWorkspacePanes((prev) => {
        const pane = prev.find((p) => p.id === paneId)
        if (!pane) return prev
        setActiveWorkspacePaneId(paneId)
        setView(pane.view)
        if (pane.directorySection) setDirectorySection(pane.directorySection)
        setWorkspaceRestoreSeq((s) => s + 1)
        return prev
      })
    },

    closeWorkspacePane(paneId: string) {
      setWorkspacePanes((prev) => {
        const closing = prev.find((p) => p.id === paneId)
        const next = prev.filter((p) => p.id !== paneId)
        persistPanes(next)
        if (closing?.draftKey) {
          setWorkspaceDrafts((d) => {
            const { [closing.draftKey!]: _removed, ...rest } = d
            persistDrafts(rest)
            return rest
          })
        }
        setActiveWorkspacePaneId((activeId) => {
          if (activeId !== paneId) return activeId
          const last = next[next.length - 1]
          if (last) {
            setView(last.view)
            if (last.directorySection) setDirectorySection(last.directorySection)
            setWorkspaceRestoreSeq((s) => s + 1)
            return last.id
          }
          return null
        })
        return next
      })
    },

    clearWorkspaceDraft(draftKey: string) {
      setWorkspaceDrafts((d) => {
        const { [draftKey]: _removed, ...rest } = d
        persistDrafts(rest)
        return rest
      })
      const draftPaneId = `draft:${draftKey}`
      setWorkspacePanes((prev) => {
        const next = prev.filter((p) => p.draftKey !== draftKey)
        persistPanes(next)
        setActiveWorkspacePaneId((activeId) => {
          if (activeId !== draftPaneId) return activeId
          const last = next[next.length - 1]
          if (last) {
            setView(last.view)
            if (last.directorySection) setDirectorySection(last.directorySection)
            setWorkspaceRestoreSeq((s) => s + 1)
            return last.id
          }
          return null
        })
        return next
      })
    },
  }
}

const WORKSPACE_DRAFTS_KEY = 'fibercell-workspace-drafts-v1'
const WORKSPACE_PANES_KEY = 'fibercell-workspace-panes-v1'

export function loadWorkspaceDrafts(): Record<string, unknown> {
  try {
    const raw = sessionStorage.getItem(WORKSPACE_DRAFTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function saveWorkspaceDrafts(drafts: Record<string, unknown>): void {
  try {
    if (Object.keys(drafts).length === 0) {
      sessionStorage.removeItem(WORKSPACE_DRAFTS_KEY)
    } else {
      sessionStorage.setItem(WORKSPACE_DRAFTS_KEY, JSON.stringify(drafts))
    }
  } catch {
    /* quota or private mode */
  }
}

export function loadWorkspacePanesJson(): string | null {
  try {
    return sessionStorage.getItem(WORKSPACE_PANES_KEY)
  } catch {
    return null
  }
}

export function saveWorkspacePanesJson(json: string | null): void {
  try {
    if (!json) sessionStorage.removeItem(WORKSPACE_PANES_KEY)
    else sessionStorage.setItem(WORKSPACE_PANES_KEY, json)
  } catch {
    /* ignore */
  }
}

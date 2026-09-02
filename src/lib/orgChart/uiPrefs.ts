import { safeSessionGet, safeSessionSet } from '@/lib/safeStorage'

export type OrgChartUiPrefs = {
  collapsedIds: string[]
  focusBranchId: string | null
  zoom: number
  panX: number
  panY: number
}

const DEFAULT: OrgChartUiPrefs = {
  collapsedIds: [],
  focusBranchId: null,
  zoom: 1,
  panX: 0,
  panY: 0,
}

function key(userId: string | null | undefined): string {
  return `fst.orgTree.ui:${userId || 'anon'}`
}

export function loadOrgChartUiPrefs(userId: string | null | undefined): OrgChartUiPrefs {
  const raw = safeSessionGet(key(userId))
  if (!raw) return { ...DEFAULT, collapsedIds: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<OrgChartUiPrefs>
    const zoom = Number(parsed.zoom)
    return {
      collapsedIds: Array.isArray(parsed.collapsedIds)
        ? parsed.collapsedIds.map(String)
        : [],
      focusBranchId: parsed.focusBranchId ? String(parsed.focusBranchId) : null,
      zoom: Number.isFinite(zoom) ? Math.min(2.2, Math.max(0.2, zoom)) : 1,
      panX: Number.isFinite(Number(parsed.panX)) ? Number(parsed.panX) : 0,
      panY: Number.isFinite(Number(parsed.panY)) ? Number(parsed.panY) : 0,
    }
  } catch {
    return { ...DEFAULT, collapsedIds: [] }
  }
}

export function saveOrgChartUiPrefs(
  userId: string | null | undefined,
  prefs: OrgChartUiPrefs,
): void {
  safeSessionSet(key(userId), JSON.stringify(prefs))
}

export function clampOrgChartZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(2.2, Math.max(0.2, Math.round(z * 100) / 100))
}

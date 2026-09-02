import { canAccessView } from '@/lib/access/permissions'
import type { AccessStore, AppUser } from '@/lib/access/types'
import type { AdminCabinetId } from '@/lib/access/adminCabinet'
import { alkaliOverdue, localTodayYmd } from '@/lib/otc/calc'
import {
  countPendingHandoffs,
  countUrgentPendingHandoffs,
} from '@/lib/technologist/shiftHandoff'
import type { AppStore, ViewId } from '@/lib/types'

export type ShiftUrgentTone = 'warn' | 'critical' | 'info'

export type ShiftUrgentTarget =
  | { view: 'technologist'; tab: 'handoff' | 'tasks' }
  | { view: 'otc'; tab: 'alkali' | 'defects' | 'dash' }
  | { view: 'mixer' }
  | { view: 'production' }
  | { view: 'director' }

export type ShiftUrgentItem = {
  id: string
  labelKey: string
  labelParams?: Record<string, string>
  tone: ShiftUrgentTone
  target: ShiftUrgentTarget
  count: number
}

export type ShiftUrgentInbox = {
  items: ShiftUrgentItem[]
  totalCount: number
}

type Input = {
  store: AppStore
  access: AccessStore
  user: AppUser | null | undefined
  adminCabinet?: AdminCabinetId
  today?: string
}

function allow(
  access: AccessStore,
  user: AppUser | null | undefined,
  view: ViewId,
  adminCabinet?: AdminCabinetId,
): boolean {
  return canAccessView(access, user, view, adminCabinet)
}

/** Срочные сигналы смены для текущего пользователя (только доступные разделы). */
export function computeShiftUrgentInbox(input: Input): ShiftUrgentInbox {
  const { store, access, user, adminCabinet } = input
  const today = input.today ?? localTodayYmd()
  const items: ShiftUrgentItem[] = []

  const userId = user?.id
  const userName = user?.displayName

  if (allow(access, user, 'technologist', adminCabinet)) {
    const handoffs = store.technologistQc?.shiftHandoffs ?? []
    const urgent = countUrgentPendingHandoffs(handoffs, userId, userName)
    const pending = countPendingHandoffs(handoffs, userId, userName)
    if (urgent > 0) {
      items.push({
        id: 'handoff_urgent',
        labelKey: 'ops.urgent.handoffUrgent',
        labelParams: { n: String(urgent) },
        tone: 'critical',
        target: { view: 'technologist', tab: 'handoff' },
        count: urgent,
      })
    } else if (pending > 0) {
      items.push({
        id: 'handoff_pending',
        labelKey: 'ops.urgent.handoffPending',
        labelParams: { n: String(pending) },
        tone: 'warn',
        target: { view: 'technologist', tab: 'handoff' },
        count: pending,
      })
    }

    const openTasks = (store.formulations?.mixTasks ?? []).filter((t) => t.status === 'open')
      .length
    if (openTasks > 0 && !allow(access, user, 'mixer', adminCabinet)) {
      items.push({
        id: 'mix_tasks_tech',
        labelKey: 'ops.urgent.mixTasks',
        labelParams: { n: String(openTasks) },
        tone: 'info',
        target: { view: 'technologist', tab: 'tasks' },
        count: openTasks,
      })
    }
  }

  if (allow(access, user, 'mixer', adminCabinet)) {
    const openTasks = (store.formulations?.mixTasks ?? []).filter((t) => t.status === 'open')
      .length
    if (openTasks > 0) {
      items.push({
        id: 'mix_tasks',
        labelKey: 'ops.urgent.mixTasks',
        labelParams: { n: String(openTasks) },
        tone: 'warn',
        target: { view: 'mixer' },
        count: openTasks,
      })
    }
  }

  if (allow(access, user, 'otc', adminCabinet)) {
    const otc = store.otc
    if (otc) {
      const overdue = otc.alkaliSeries.filter(
        (s) => s.phase === 'soaking' && alkaliOverdue(s, today),
      ).length
      if (overdue > 0) {
        items.push({
          id: 'alkali_overdue',
          labelKey: 'ops.urgent.alkaliOverdue',
          labelParams: { n: String(overdue) },
          tone: 'critical',
          target: { view: 'otc', tab: 'alkali' },
          count: overdue,
        })
      }
      const openDefects = otc.defects.filter((d) => d.status !== 'closed').length
      if (openDefects > 0) {
        items.push({
          id: 'otc_defects',
          labelKey: 'ops.urgent.otcDefects',
          labelParams: { n: String(openDefects) },
          tone: 'warn',
          target: { view: 'otc', tab: 'defects' },
          count: openDefects,
        })
      }
    }
  }

  if (allow(access, user, 'production', adminCabinet)) {
    const openShift = (store.production?.requests ?? []).filter(
      (r) => r.status === 'draft' || r.status === 'saved',
    ).length
    if (openShift > 0) {
      items.push({
        id: 'shift_requests',
        labelKey: 'ops.urgent.shiftRequests',
        labelParams: { n: String(openShift) },
        tone: 'info',
        target: { view: 'production' },
        count: openShift,
      })
    }
  }

  const totalCount = items.reduce((s, i) => s + i.count, 0)
  return { items, totalCount }
}

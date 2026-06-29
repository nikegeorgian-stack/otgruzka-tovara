import type { WastewaterCube, WastewaterCubeStatus } from './types'

export type WastewaterTransition =
  | 'finish_filling'
  | 'to_drain_zone'
  | 'start_use'
  | 'mark_used'
  | 'mark_unsuitable'
  | 'restore_active'

export type WastewaterTransitionPatch = Partial<
  Pick<
    WastewaterCube,
    | 'massKg'
    | 'fillEndDate'
    | 'locationNote'
    | 'dryResiduePct'
    | 'usageNote'
    | 'usedFromDate'
    | 'usedToDate'
    | 'usedMassKg'
    | 'note'
  >
>

export type TransitionResult =
  | { ok: true; cube: WastewaterCube }
  | { ok: false; error: string }

const NEXT_STATUS: Record<Exclude<WastewaterTransition, 'restore_active'>, WastewaterCubeStatus> = {
  finish_filling: 'waiting',
  to_drain_zone: 'drain_zone',
  start_use: 'in_use',
  mark_used: 'used',
  mark_unsuitable: 'unsuitable',
}

function inferStatusFromData(cube: WastewaterCube): WastewaterCubeStatus {
  if (cube.usedFromDate || cube.usedMassKg) return 'in_use'
  if (cube.dryResiduePct != null) return 'drain_zone'
  if (cube.fillEndDate) return 'waiting'
  return 'filling'
}

export function availableWastewaterTransitions(
  status: WastewaterCubeStatus,
): WastewaterTransition[] {
  switch (status) {
    case 'filling':
      return ['finish_filling', 'mark_unsuitable']
    case 'waiting':
      return ['to_drain_zone', 'mark_unsuitable']
    case 'drain_zone':
      return ['start_use', 'mark_unsuitable']
    case 'in_use':
      return ['mark_used', 'mark_unsuitable']
    case 'unsuitable':
      return ['restore_active']
    default:
      return []
  }
}

export function applyWastewaterTransition(
  cube: WastewaterCube,
  action: WastewaterTransition,
  patch: WastewaterTransitionPatch = {},
): TransitionResult {
  const allowed = availableWastewaterTransitions(cube.status)
  if (!allowed.includes(action)) {
    return { ok: false, error: 'invalid_transition' }
  }

  const now = new Date().toISOString()

  if (action === 'finish_filling') {
    if (!patch.fillEndDate && !cube.fillEndDate) {
      return { ok: false, error: 'fill_end_required' }
    }
    if (patch.massKg == null && cube.massKg == null) {
      return { ok: false, error: 'mass_required' }
    }
  }

  if (action === 'start_use') {
    if (patch.dryResiduePct == null && cube.dryResiduePct == null) {
      return { ok: false, error: 'dry_residue_required' }
    }
    if (patch.massKg == null && cube.massKg == null) {
      return { ok: false, error: 'mass_required' }
    }
  }

  if (action === 'mark_used') {
    const from = patch.usedFromDate ?? cube.usedFromDate
    const to = patch.usedToDate ?? cube.usedToDate
    if (!from || !to) {
      return { ok: false, error: 'used_dates_required' }
    }
  }

  if (action === 'restore_active') {
    const restored =
      cube.statusBeforeClose && cube.statusBeforeClose !== 'unsuitable'
        ? cube.statusBeforeClose
        : inferStatusFromData(cube)
    return {
      ok: true,
      cube: {
        ...cube,
        ...patch,
        status: restored,
        statusBeforeClose: undefined,
        closedAt: undefined,
        updatedAt: now,
      },
    }
  }

  const nextStatus = NEXT_STATUS[action as Exclude<WastewaterTransition, 'restore_active'>]
  const closing = nextStatus === 'used' || nextStatus === 'unsuitable'
  const closedAt = closing ? now : cube.closedAt
  const statusBeforeClose = closing
    ? cube.status !== 'unsuitable' && cube.status !== 'used'
      ? cube.status
      : cube.statusBeforeClose
    : cube.statusBeforeClose

  return {
    ok: true,
    cube: {
      ...cube,
      ...patch,
      status: nextStatus,
      statusBeforeClose,
      updatedAt: now,
      closedAt,
    },
  }
}

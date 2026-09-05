import type { ShiftHandoffRecord, ShiftHandoffUrgency } from './types'

/** Нужно ли текущему пользователю ознакомиться с записью. */
export function handoffNeedsAck(
  h: ShiftHandoffRecord,
  userId?: string,
  userName?: string,
): boolean {
  if (h.status !== 'open') return false
  if (userId && h.authorId === userId) return false
  if (!userId && userName && h.authorName === userName) return false
  if (userId && h.acknowledgements.some((a) => a.userId === userId)) return false
  if (
    !userId &&
    userName &&
    h.acknowledgements.some((a) => a.userName === userName)
  ) {
    return false
  }
  return true
}

export function countPendingHandoffs(
  list: ShiftHandoffRecord[] | undefined,
  userId?: string,
  userName?: string,
): number {
  if (!list?.length) return 0
  return list.filter((h) => handoffNeedsAck(h, userId, userName)).length
}

export function countUrgentPendingHandoffs(
  list: ShiftHandoffRecord[] | undefined,
  userId?: string,
  userName?: string,
): number {
  if (!list?.length) return 0
  return list.filter(
    (h) =>
      handoffNeedsAck(h, userId, userName) &&
      (h.urgency === 'urgent' || h.urgency === 'critical'),
  ).length
}

const URGENCY_ORDER: Record<ShiftHandoffUrgency, number> = {
  critical: 0,
  urgent: 1,
  normal: 2,
}

/** Открытые сверху, по срочности, затем новые. */
export function sortHandoffs(list: ShiftHandoffRecord[]): ShiftHandoffRecord[] {
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
    if (u !== 0) return u
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export const HANDOFF_EOS_BODY_RU = `Что в работе / незавершено:
—

Что использовали (рецепт / куб / линия / участок):
—

Нюансы следующей смене:
—

На что обратить внимание:
—`

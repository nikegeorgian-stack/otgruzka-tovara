import { brigadesForLine } from '@/lib/production/brigades'
import type { AppStore } from '@/lib/types'
import type { NightShiftGroupId } from './types'

const MIXER_RE = /миксер|mixer|შემრევ/i
const MECH_BRIGADE_RE = /механик|слесар|ремонт|инженер|მექანიკ|ინჟინერ/i
const MECH_POS_RE = /механик|слесар|ремонт|инженер|მექანიკ|ინჟინერ|საშლელ/i

/** Бригады, подходящие под группу ночной смены. */
export function brigadesForNightGroup(
  group: NightShiftGroupId,
  allBrigades: string[],
): string[] {
  switch (group) {
    case 'line1':
      return brigadesForLine('1', allBrigades)
    case 'line2':
      return brigadesForLine('2', allBrigades)
    case 'pack':
      return brigadesForLine('pack', allBrigades)
    case 'mixer': {
      const hit = allBrigades.filter((b) => MIXER_RE.test(b))
      return hit.length ? hit : []
    }
    case 'mechanics': {
      const hit = allBrigades.filter((b) => MECH_BRIGADE_RE.test(b))
      return hit.length ? hit : []
    }
    default:
      return []
  }
}

/** Сотрудники-кандидаты в группу: состав бригад + (для механиков) по должности. */
export function candidateEmployeeIdsForNightGroup(
  store: AppStore,
  group: NightShiftGroupId,
  month: string,
): string[] {
  const brigades = new Set(brigadesForNightGroup(group, store.brigades))
  const ids = new Set<string>()
  const sheet = store.months[month]

  for (const emp of store.employees) {
    if (!emp.active || (emp.hrStatus ?? 'active') === 'fired') continue
    if (brigades.has(emp.brigade)) {
      ids.add(emp.id)
      continue
    }
    if (group === 'mechanics' && MECH_POS_RE.test(emp.position ?? '')) {
      ids.add(emp.id)
    }
  }

  if (sheet) {
    for (const row of sheet.rows) {
      if (!row.employeeId || !brigades.has(row.brigade)) continue
      ids.add(row.employeeId)
    }
  }

  return [...ids]
}

/** Кандидаты из одной бригады (кадры + строки месяца). */
export function candidateEmployeeIdsForBrigade(
  store: AppStore,
  brigade: string,
  month: string,
): string[] {
  const ids = new Set<string>()
  const sheet = store.months[month]

  for (const emp of store.employees) {
    if (!emp.active || (emp.hrStatus ?? 'active') === 'fired') continue
    if (emp.brigade === brigade) ids.add(emp.id)
  }

  if (sheet) {
    for (const row of sheet.rows) {
      if (!row.employeeId || row.brigade !== brigade) continue
      ids.add(row.employeeId)
    }
  }

  return [...ids]
}

import type { AppStore, Employee, ShiftTemplate } from './types'

export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  {
    id: 'tpl-52',
    name: '5/2 офис',
    schedule: '5/2 8ч',
    cycleStart: '2026-06-01',
  },
  {
    id: 'tpl-22-a-day',
    name: '2/2 группа А (день)',
    schedule: '2/2 11ч',
    group2x2: 'А',
    shiftMode: 'day',
    cycleStart: '2026-06-01',
  },
  {
    id: 'tpl-22-b-day',
    name: '2/2 группа Б (день)',
    schedule: '2/2 11ч',
    group2x2: 'Б',
    shiftMode: 'day',
    cycleStart: '2026-06-03',
  },
  {
    id: 'tpl-22-a-night',
    name: '2/2 группа А (ночь)',
    schedule: '2/2 11ч',
    group2x2: 'А',
    shiftMode: 'night',
    cycleStart: '2026-06-01',
  },
  {
    id: 'tpl-11-a-day',
    name: '1/1 группа А (день)',
    schedule: '1/1 11ч',
    group2x2: 'А',
    shiftMode: 'day',
    cycleStart: '2026-06-01',
  },
  {
    id: 'tpl-11-b-day',
    name: '1/1 группа Б (день)',
    schedule: '1/1 11ч',
    group2x2: 'Б',
    shiftMode: 'day',
    cycleStart: '2026-06-02',
  },
]

export function applyTemplateToEmployees(
  store: AppStore,
  templateId: string,
  employeeIds: string[],
): AppStore {
  const tpl = store.shiftTemplates.find((t) => t.id === templateId)
  if (!tpl) return store

  const employees = store.employees.map((e) => {
    if (!employeeIds.includes(e.id)) return e
    return applyTemplate(e, tpl)
  })
  return { ...store, employees }
}

function applyTemplate(emp: Employee, tpl: ShiftTemplate): Employee {
  return {
    ...emp,
    schedule: tpl.schedule,
    group2x2: tpl.group2x2 ?? emp.group2x2,
    shiftMode: tpl.shiftMode ?? emp.shiftMode,
    cycleStart: tpl.cycleStart ?? emp.cycleStart,
  }
}

export function applyTemplateToBrigade(
  store: AppStore,
  templateId: string,
  brigade: string,
): AppStore {
  const ids = store.employees
    .filter((e) => e.brigade === brigade && e.active)
    .map((e) => e.id)
  return applyTemplateToEmployees(store, templateId, ids)
}

import type { JournalCategory } from './types'

export type JournalFilterGroupId =
  | 'people'
  | 'money'
  | 'warehouse'
  | 'supply'
  | 'plant'
  | 'other'

export const JOURNAL_FILTER_GROUPS: {
  id: JournalFilterGroupId
  labelKey: string
  categories: JournalCategory[]
}[] = [
  {
    id: 'people',
    labelKey: 'journals.group.people',
    categories: ['timesheet', 'hr', 'access', 'workwear'],
  },
  {
    id: 'money',
    labelKey: 'journals.group.money',
    categories: ['finance'],
  },
  {
    id: 'warehouse',
    labelKey: 'journals.group.warehouse',
    categories: [
      'warehouse_documents',
      'warehouse_movements',
      'warehouse_loading',
      'warehouse_nomenclature',
      'warehouse_audit',
    ],
  },
  {
    id: 'supply',
    labelKey: 'journals.group.supply',
    categories: ['procurement', 'sales'],
  },
  {
    id: 'plant',
    labelKey: 'journals.group.plant',
    categories: ['production', 'technologist_batch', 'technologist_climate', 'technologist_qc'],
  },
  {
    id: 'other',
    labelKey: 'journals.group.other',
    categories: ['directories', 'it_office'],
  },
]

export function groupCategoriesForAllowed(
  allowed: JournalCategory[],
): typeof JOURNAL_FILTER_GROUPS {
  const set = new Set(allowed)
  return JOURNAL_FILTER_GROUPS.map((g) => ({
    ...g,
    categories: g.categories.filter((c) => set.has(c)),
  })).filter((g) => g.categories.length > 0)
}

export function countGroup(
  counts: Partial<Record<JournalCategory, number>>,
  categories: JournalCategory[],
): number {
  return categories.reduce((n, c) => n + (counts[c] ?? 0), 0)
}

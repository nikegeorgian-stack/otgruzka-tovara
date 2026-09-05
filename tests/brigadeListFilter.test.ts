import { describe, expect, it } from 'vitest'
import {
  BRIGADE_UNIT_FILTER_ALL,
  filterAndSortBrigadeList,
  NO_STRUCTURAL_UNIT_ID,
} from '@/lib/monthViewOptions'

describe('filterAndSortBrigadeList', () => {
  const brigades = ['Цех Б', '1.2 Пропитка', 'Альфа', '1.1 Пропитка']
  const namesKa: Record<string, string> = {}
  const brigadeUnits: Record<string, string> = {
    '1.1 Пропитка': 'u1',
    '1.2 Пропитка': 'u1',
    'Цех Б': 'u2',
  }

  it('sorts A→Я with numeric awareness', () => {
    const list = filterAndSortBrigadeList({
      brigades,
      namesKa,
      locale: 'ru',
    })
    expect(list).toEqual(['1.1 Пропитка', '1.2 Пропитка', 'Альфа', 'Цех Б'])
  })

  it('filters by structural unit', () => {
    const list = filterAndSortBrigadeList({
      brigades,
      namesKa,
      locale: 'ru',
      brigadeUnits,
      unitFilter: 'u1',
    })
    expect(list).toEqual(['1.1 Пропитка', '1.2 Пропитка'])
  })

  it('filters unassigned and respects search', () => {
    const list = filterAndSortBrigadeList({
      brigades,
      namesKa,
      locale: 'ru',
      brigadeUnits,
      unitFilter: NO_STRUCTURAL_UNIT_ID,
      search: 'аль',
    })
    expect(list).toEqual(['Альфа'])
  })

  it('all units keeps full sorted list', () => {
    const list = filterAndSortBrigadeList({
      brigades,
      namesKa,
      locale: 'ru',
      brigadeUnits,
      unitFilter: BRIGADE_UNIT_FILTER_ALL,
    })
    expect(list).toHaveLength(4)
  })
})

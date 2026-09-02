import { describe, expect, it } from 'vitest'
import {
  activeCoverageBrigades,
  coverageOverlapsMonth,
  isCoverageActiveOn,
  isBrigadeViaMasterCoverage,
  localTodayIsoDate,
  mergeBrigadeLists,
  monthCoverageBrigades,
  nextWorkshopMasterCoverageNumber,
  normalizeWorkshopMasterCoverage,
} from '@/lib/access/workshopMasterCoverage'
import type { AccessStore, AppUser, WorkshopMasterCoverage } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'
import { resolveTimesheetBrigades } from '@/lib/access/timesheetScope'
import { buildCoverageFocusChips } from '@/lib/access/coverageFocus'

function master(partial: Partial<AppUser> & Pick<AppUser, 'id' | 'login'>): AppUser {
  return {
    displayName: partial.displayName ?? partial.login,
    roleId: 'workshop_master',
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('workshopMasterCoverage document', () => {
  const cov: WorkshopMasterCoverage = {
    id: 'c1',
    number: 'ПМ-2026-001',
    status: 'posted',
    coverUserId: 'u-valera',
    absentUserId: 'u-karlo',
    brigades: ['Пропитки №1.1', 'Пропитки №1.2'],
    fromDate: '2026-07-20',
    toDate: '2026-08-05',
    createdAt: '2026-07-19T00:00:00.000Z',
    postedAt: '2026-07-19T00:00:00.000Z',
  }

  it('normalizes valid coverage and legacy without status → posted', () => {
    expect(normalizeWorkshopMasterCoverage(cov)?.status).toBe('posted')
    const legacy = normalizeWorkshopMasterCoverage({
      id: 'c2',
      coverUserId: 'a',
      absentUserId: 'b',
      brigades: ['X'],
      fromDate: '2026-07-01',
      toDate: '2026-07-10',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    expect(legacy?.status).toBe('posted')
    expect(legacy?.number).toBeTruthy()
    expect(normalizeWorkshopMasterCoverage({ ...cov, brigades: [] })).toBeNull()
  })

  it('draft is never active; posted only in period', () => {
    expect(isCoverageActiveOn({ ...cov, status: 'draft' }, '2026-07-27')).toBe(false)
    expect(isCoverageActiveOn(cov, '2026-07-20')).toBe(true)
    expect(isCoverageActiveOn(cov, '2026-08-05')).toBe(true)
    expect(isCoverageActiveOn(cov, '2026-07-19')).toBe(false)
    expect(
      isCoverageActiveOn(
        { ...cov, status: 'ended', endedAt: '2026-07-21T00:00:00.000Z' },
        '2026-07-22',
      ),
    ).toBe(false)
  })

  it('overlaps month for posted docs', () => {
    expect(coverageOverlapsMonth(cov, '2026-07')).toBe(true)
    expect(coverageOverlapsMonth(cov, '2026-08')).toBe(true)
    expect(coverageOverlapsMonth(cov, '2026-06')).toBe(false)
    expect(coverageOverlapsMonth({ ...cov, status: 'draft' }, '2026-07')).toBe(false)
  })

  it('merges coverage brigades for cover user', () => {
    const access: AccessStore = {
      users: [],
      roleViews: {} as AccessStore['roleViews'],
      workshopMasterCoverages: [cov],
    }
    expect(
      activeCoverageBrigades(
        access,
        'u-valera',
        ['Пропитки №1.1', 'Пропитки №1.2', 'Пропитки №2.1'],
        '2026-07-27',
      ),
    ).toEqual(['Пропитки №1.1', 'Пропитки №1.2'])
    expect(
      activeCoverageBrigades(access, 'u-karlo', ['Пропитки №1.1'], '2026-07-27'),
    ).toEqual([])
  })

  it('month coverage after period end of today still grants brigades for open month', () => {
    const futureOnly: WorkshopMasterCoverage = {
      ...cov,
      id: 'c-future',
      fromDate: '2026-08-01',
      toDate: '2026-08-10',
    }
    const access: AccessStore = {
      users: [],
      roleViews: {} as AccessStore['roleViews'],
      workshopMasterCoverages: [futureOnly],
    }
    expect(
      activeCoverageBrigades(access, 'u-valera', futureOnly.brigades, '2026-07-27'),
    ).toEqual([])
    expect(
      monthCoverageBrigades(access, 'u-valera', futureOnly.brigades, '2026-08'),
    ).toEqual(['Пропитки №1.1', 'Пропитки №1.2'])
  })

  it('resolveTimesheetBrigades merges month overlap', () => {
    const valera = master({
      id: 'u-valera',
      login: 'master-valera@fibercell.net',
      defaultBrigades: ['Пропитки №2.1'],
    })
    const store = {
      brigades: ['Пропитки №1.1', 'Пропитки №2.1'],
      employees: [],
      brigadiers: {},
      access: {
        users: [valera],
        roleViews: {} as AccessStore['roleViews'],
        workshopMasterCoverages: [cov],
      },
    } as unknown as AppStore
    // today outside period → still see via month
    const scope = resolveTimesheetBrigades(store, valera, {
      month: '2026-07',
      dayIso: '2026-07-10',
    })
    expect(scope).toEqual(expect.arrayContaining(['Пропитки №1.1', 'Пропитки №2.1']))
  })

  it('detects brigade via coverage only', () => {
    const valera = master({
      id: 'u-valera',
      login: 'master-valera@fibercell.net',
      defaultBrigades: ['Пропитки №2.1'],
    })
    const store = {
      brigades: ['Пропитки №1.1', 'Пропитки №2.1'],
      employees: [],
      brigadiers: {},
      access: {
        users: [valera],
        roleViews: {} as AccessStore['roleViews'],
        workshopMasterCoverages: [cov],
      },
    } as unknown as AppStore
    expect(isBrigadeViaMasterCoverage(store, valera, 'Пропитки №1.1', '2026-07-27')).toBe(true)
    expect(isBrigadeViaMasterCoverage(store, valera, 'Пропитки №2.1', '2026-07-27')).toBe(false)
  })

  it('mergeBrigadeLists unique', () => {
    expect(mergeBrigadeLists(['a'], ['a', 'b'], undefined)).toEqual(['a', 'b'])
  })

  it('next number increments', () => {
    expect(nextWorkshopMasterCoverageNumber([cov], new Date('2026-07-01'))).toBe('ПМ-2026-002')
  })

  it('localTodayIsoDate format', () => {
    expect(localTodayIsoDate(new Date('2026-07-27T12:00:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('buildCoverageFocusChips: mine / covered master / all', () => {
    const valera = master({
      id: 'u-valera',
      login: 'master-valera@fibercell.net',
      displayName: 'Валера',
      defaultBrigades: ['Пропитки №2.1'],
    })
    const karlo = master({
      id: 'u-karlo',
      login: 'master-karlo@fibercell.net',
      displayName: 'Карло',
    })
    const store = {
      brigades: ['Пропитки №1.1', 'Пропитки №1.2', 'Пропитки №2.1'],
      employees: [],
      brigadiers: {},
      access: {
        users: [valera, karlo],
        roleViews: {} as AccessStore['roleViews'],
        workshopMasterCoverages: [cov],
      },
    } as unknown as AppStore
    const chips = buildCoverageFocusChips(store, valera, '2026-07', 'ru', {
      all: 'Все',
      mine: 'Мои',
      coverTitle: (name, to) => `${name}|${to}`,
    })
    expect(chips.map((c) => c.id)).toEqual(['mine', 'cov:c1', 'all'])
    expect(chips[0]!.brigades).toEqual(['Пропитки №2.1'])
    expect(chips[1]!.label).toBe('Карло')
    expect(chips[1]!.brigades).toEqual(['Пропитки №1.1', 'Пропитки №1.2'])
    expect(chips[2]!.brigades).toEqual([
      'Пропитки №2.1',
      'Пропитки №1.1',
      'Пропитки №1.2',
    ])
    expect(buildCoverageFocusChips(store, karlo, '2026-07', 'ru', {
      all: 'Все',
      mine: 'Мои',
      coverTitle: (name, to) => `${name}|${to}`,
    })).toEqual([])
  })
})

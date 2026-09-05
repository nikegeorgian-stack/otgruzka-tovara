import { describe, expect, it } from 'vitest'
import {
  timesheetAccessForRole,
  brigadeInTimesheetScope,
  timesheetAccess,
} from '@/lib/access/timesheetScope'
import { canMutateTimesheet } from '@/lib/access/timesheetGuard'
import type { AppStore } from '@/lib/types'
import type { AppUser } from '@/lib/access/types'

function emptyStore(over: Partial<AppStore> = {}): AppStore {
  return {
    brigades: ['A', 'B', 'C'],
    months: {
      '2026-07': {
        month: '2026-07',
        rows: [
          { id: 'r1', brigade: 'A', employeeId: 'e1' },
          { id: 'r2', brigade: 'B', employeeId: 'e2' },
        ],
        plan: {},
        fact: {},
        factOverrides: [],
      },
    },
    employees: [],
    access: {
      users: [],
      roleViews: {} as AppStore['access']['roleViews'],
    },
    ...over,
  } as AppStore
}

describe('timesheetAccessForRole', () => {
  it('gives workshop_master edit + scoped', () => {
    expect(timesheetAccessForRole('workshop_master')).toEqual({
      level: 'edit',
      scoped: true,
    })
  })

  it('gives hr/finance/sysadmin edit all', () => {
    for (const role of ['hr', 'finance', 'sysadmin'] as const) {
      expect(timesheetAccessForRole(role)).toEqual({ level: 'edit', scoped: false })
    }
  })

  it('gives view-all roles view without scope', () => {
    for (const role of ['hr_inspector', 'operations_director', 'chief_engineer'] as const) {
      expect(timesheetAccessForRole(role)).toEqual({ level: 'view', scoped: false })
    }
  })

  it('blocks employee from shared timesheet', () => {
    expect(timesheetAccessForRole('employee')).toEqual({ level: 'none', scoped: false })
  })
})

describe('brigadeInTimesheetScope', () => {
  it('allows any brigade when scope is all', () => {
    expect(brigadeInTimesheetScope('A', 'all')).toBe(true)
  })

  it('checks membership for list scope', () => {
    expect(brigadeInTimesheetScope('A', ['A', 'B'])).toBe(true)
    expect(brigadeInTimesheetScope('C', ['A', 'B'])).toBe(false)
    expect(brigadeInTimesheetScope(null, ['A'])).toBe(false)
  })
})

describe('timesheetAccess brigade scope', () => {
  it('scopes master to account brigades', () => {
    const user = {
      id: 'u1',
      roleId: 'workshop_master',
      defaultBrigades: ['A', 'B'],
      active: true,
    } as AppUser
    const access = timesheetAccess(emptyStore(), user)
    expect(access.level).toBe('edit')
    expect(access.brigades).toEqual(['A', 'B'])
    expect(access.viewBrigades).toEqual(['A', 'B'])
    expect(access.editBrigades).toEqual(['A', 'B'])
    expect(access.scoped).toBe(true)
  })

  it('scopes master via brigadier link when defaultBrigades empty', () => {
    const user = {
      id: 'u1',
      roleId: 'workshop_master',
      login: 'valera@x',
      employeeId: 'emp-valera',
      defaultBrigades: [],
      active: true,
    } as AppUser
    const store = emptyStore({
      brigadiers: { B: 'emp-valera', C: 'emp-other' },
      employees: [
        { id: 'emp-valera', brigade: 'B', active: true, fullName: 'Valera' },
        { id: 'emp-other', brigade: 'C', active: true, fullName: 'Other' },
      ] as AppStore['employees'],
    })
    const access = timesheetAccess(store, user)
    expect(access.scoped).toBe(true)
    expect(access.brigades).toEqual(['B'])
    expect(access.editBrigades).toEqual(['B'])
  })

  it('user timesheetLevel overrides role (technologist can view)', () => {
    const user = {
      id: 'u1',
      roleId: 'technologist',
      active: true,
      timesheetLevel: 'view',
    } as AppUser
    const access = timesheetAccess(emptyStore(), user)
    expect(access.level).toBe('view')
    expect(access.viewBrigades).toBe('all')
    expect(access.editBrigades).toEqual([])
    expect(access.scoped).toBe(false)
  })

  it('supports separate view and edit brigade lists', () => {
    const user = {
      id: 'u1',
      roleId: 'technologist',
      active: true,
      timesheetLevel: 'edit',
      timesheetViewBrigades: ['A', 'B', 'C'],
      timesheetEditBrigades: ['A'],
    } as AppUser
    const access = timesheetAccess(emptyStore(), user)
    expect(access.level).toBe('edit')
    expect(access.viewBrigades).toEqual(['A', 'B', 'C'])
    expect(access.editBrigades).toEqual(['A'])
    expect(access.scoped).toBe(true)
  })

  it('adds covered master brigades to personal view and edit lists', () => {
    const user = {
      id: 'u-valera',
      login: 'master-valera@fibercell.net',
      displayName: 'Valera',
      roleId: 'workshop_master',
      active: true,
      timesheetLevel: 'edit',
      timesheetViewBrigades: ['A'],
      timesheetEditBrigades: ['A'],
    } as AppUser
    const store = emptyStore({
      access: {
        users: [user],
        roleViews: {} as AppStore['access']['roleViews'],
        workshopMasterCoverages: [
          {
            id: 'coverage-weekend',
            number: 'ПМ-2026-002',
            status: 'posted',
            coverUserId: user.id,
            absentUserId: 'u-karlo',
            brigades: ['C'],
            fromDate: '2026-08-14',
            toDate: '2026-08-31',
            createdAt: '2026-08-14T00:00:00.000Z',
          },
        ],
      },
    })

    const access = timesheetAccess(store, user, {
      month: '2026-08',
      dayIso: '2026-08-16',
    })

    expect(access.viewBrigades).toEqual(['A', 'C'])
    expect(access.editBrigades).toEqual(['A', 'C'])
  })
})

describe('canMutateTimesheet', () => {
  it('denies view-only roles', () => {
    const store = emptyStore({
    access: {
      users: [
          {
            id: 'u1',
            roleId: 'operations_director',
            login: 'dir@x',
            displayName: 'Dir',
            active: true,
          } as AppUser,
        ],
        roleViews: {} as AppStore['access']['roleViews'],
      },
    })
    expect(canMutateTimesheet(store, { id: 'u1', name: 'Dir' }, { month: '2026-07', rowId: 'r1' })).toBe(
      false,
    )
  })

  it('allows master only in own brigade', () => {
    const store = emptyStore({
      access: {
        users: [
          {
            id: 'u1',
            roleId: 'workshop_master',
            login: 'm@x',
            displayName: 'Master',
            active: true,
            defaultBrigades: ['A'],
          } as AppUser,
        ],
        roleViews: {} as AppStore['access']['roleViews'],
      },
    })
    expect(canMutateTimesheet(store, { id: 'u1' }, { month: '2026-07', rowId: 'r1' })).toBe(true)
    expect(canMutateTimesheet(store, { id: 'u1' }, { month: '2026-07', rowId: 'r2' })).toBe(false)
    expect(canMutateTimesheet(store, { id: 'u1' }, { month: '2026-07' })).toBe(false)
  })
})

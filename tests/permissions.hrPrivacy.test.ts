import { describe, expect, it } from 'vitest'
import { canEditEmployeeSalary, canViewFullHrPersonnel } from '@/lib/access/permissions'
import type { AccessRoleId, AppUser } from '@/lib/access/types'

function user(roleId: AccessRoleId, active = true): AppUser {
  return {
    id: 'u1',
    login: 't@t.t',
    displayName: 'T',
    roleId,
    passwordHash: '',
    passwordSalt: '',
    active,
    createdAt: '',
    updatedAt: '',
  }
}

describe('canViewFullHrPersonnel', () => {
  it('allows sysadmin, hr, finance', () => {
    expect(canViewFullHrPersonnel(user('sysadmin'))).toBe(true)
    expect(canViewFullHrPersonnel(user('hr'))).toBe(true)
    expect(canViewFullHrPersonnel(user('finance'))).toBe(true)
  })

  it('denies other roles and inactive', () => {
    expect(canViewFullHrPersonnel(user('workshop_master'))).toBe(false)
    expect(canViewFullHrPersonnel(user('office_manager'))).toBe(false)
    expect(canViewFullHrPersonnel(user('operations_director'))).toBe(false)
    expect(canViewFullHrPersonnel(user('technologist'))).toBe(false)
    expect(canViewFullHrPersonnel(user('hr_inspector'))).toBe(false)
    expect(canViewFullHrPersonnel(user('hr', false))).toBe(false)
    expect(canViewFullHrPersonnel(null)).toBe(false)
  })
})

describe('canEditEmployeeSalary', () => {
  it('allows sysadmin, hr, hr inspector, finance', () => {
    expect(canEditEmployeeSalary(user('sysadmin'))).toBe(true)
    expect(canEditEmployeeSalary(user('hr'))).toBe(true)
    expect(canEditEmployeeSalary(user('hr_inspector'))).toBe(true)
    expect(canEditEmployeeSalary(user('finance'))).toBe(true)
  })

  it('denies workshop master, office manager and inactive', () => {
    expect(canEditEmployeeSalary(user('workshop_master'))).toBe(false)
    expect(canEditEmployeeSalary(user('office_manager'))).toBe(false)
    expect(canEditEmployeeSalary(user('hr', false))).toBe(false)
    expect(canEditEmployeeSalary(null)).toBe(false)
  })
})

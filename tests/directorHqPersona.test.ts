import { describe, expect, it } from 'vitest'
import { isDirectorHqPersona } from '@/lib/access/accessPersona'
import type { AccessRoleId, AppUser } from '@/lib/access/types'

function user(roleId: AccessRoleId): AppUser {
  return {
    id: 'u1',
    login: 't@t.t',
    displayName: 'T',
    roleId,
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: '',
    updatedAt: '',
  }
}

describe('isDirectorHqPersona', () => {
  it('is true for the general director login', () => {
    expect(isDirectorHqPersona(user('operations_director'))).toBe(true)
  })

  it('is true when sysadmin previews that cabinet', () => {
    expect(isDirectorHqPersona(user('sysadmin'), 'operations_director')).toBe(true)
  })

  it('is false for sysadmin full access and other roles', () => {
    expect(isDirectorHqPersona(user('sysadmin'), 'full')).toBe(false)
    expect(isDirectorHqPersona(user('sales_dispatcher'))).toBe(false)
    expect(isDirectorHqPersona(user('workshop_master'))).toBe(false)
  })
})

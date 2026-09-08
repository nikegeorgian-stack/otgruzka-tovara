import { describe, expect, it } from 'vitest'
import { canReleaseFinishedGoodsQc } from '@/lib/access/permissions'
import type { AppUser } from '@/lib/access/types'

describe('canReleaseFinishedGoodsQc', () => {
  it('allows active sysadmin (ADM staging principal / full interface)', () => {
    const user = { id: 'u1', roleId: 'sysadmin', active: true } as AppUser
    expect(canReleaseFinishedGoodsQc(user, null)).toBe(true)
  })

  it('allows active otc', () => {
    const user = { id: 'u2', roleId: 'otc', active: true } as AppUser
    expect(canReleaseFinishedGoodsQc(user, null)).toBe(true)
  })

  it('denies inactive users', () => {
    const user = { id: 'u3', roleId: 'sysadmin', active: false } as AppUser
    expect(canReleaseFinishedGoodsQc(user, null)).toBe(false)
  })
})

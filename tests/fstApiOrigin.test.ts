import { describe, expect, it } from 'vitest'
import { isFstApiJsonOk } from '@/lib/cloud/fstApiOrigin'

describe('isFstApiJsonOk', () => {
  it('accepts ok:true only', () => {
    expect(isFstApiJsonOk({ ok: true })).toBe(true)
    expect(isFstApiJsonOk({ ok: false })).toBe(false)
    expect(isFstApiJsonOk({})).toBe(false)
    expect(isFstApiJsonOk(null)).toBe(false)
  })
})

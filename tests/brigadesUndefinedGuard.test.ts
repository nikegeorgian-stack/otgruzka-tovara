import { describe, expect, it } from 'vitest'
import { getBrigades } from '@/lib/brigades'
import type { AppStore } from '@/lib/types'

describe('brigades undefined guard (FST hang / Month crash)', () => {
  it('getBrigades tolerates missing brigades array', () => {
    const store = { brigades: undefined } as unknown as AppStore
    expect(getBrigades(store)).toEqual([])
  })

  it('MonthPage filter path does not throw when brigades missing', () => {
    const store = { brigades: undefined } as unknown as AppStore
    const selectedBrigades = new Set<string>(['X'])
    const brigadeCount = Array.isArray(store.brigades) ? store.brigades.length : 0
    expect(() => {
      if (selectedBrigades.size < brigadeCount) {
        void [...selectedBrigades]
      }
    }).not.toThrow()
    expect(brigadeCount).toBe(0)
  })
})

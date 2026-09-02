import { describe, expect, it } from 'vitest'
import { rollCallPersonVisible } from '../src/lib/rollCallVisible'

describe('rollCallPersonVisible', () => {
  it('hides a rest day unless showOff', () => {
    expect(
      rollCallPersonVisible({
        showOff: false,
        planCode: 'В',
        factCode: 'В',
        isDesignatedBrigadier: false,
        isBrigadierDay: false,
      }),
    ).toBe(false)
  })

  it('always shows the designated brigadier, even on a rest day', () => {
    expect(
      rollCallPersonVisible({
        showOff: false,
        planCode: 'В',
        factCode: '',
        isDesignatedBrigadier: true,
        isBrigadierDay: false,
      }),
    ).toBe(true)
  })

  it('always shows a day-marked brigadier', () => {
    expect(
      rollCallPersonVisible({
        showOff: false,
        planCode: 'В',
        factCode: 'В',
        isDesignatedBrigadier: false,
        isBrigadierDay: true,
      }),
    ).toBe(true)
  })
})

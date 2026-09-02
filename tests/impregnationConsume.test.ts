import { describe, expect, it } from 'vitest'
import { estimateImpregnationConsumeKg } from '@/lib/production/impregnationConsume'

describe('impregnation consume estimate', () => {
  it('computes kg from mp, width and gsm', () => {
    // 100 mp × 2 m × 145 g/m² = 200 m² × 145 / 1000 = 29 kg
    expect(
      estimateImpregnationConsumeKg({
        goodMp: 100,
        rollWidthM: 2,
        grammageGsm: 145,
      }),
    ).toBe(29)
  })

  it('returns 0 without width or gsm', () => {
    expect(estimateImpregnationConsumeKg({ goodMp: 500, rollWidthM: 2 })).toBe(0)
    expect(estimateImpregnationConsumeKg({ goodMp: 500, grammageGsm: 145 })).toBe(0)
  })
})

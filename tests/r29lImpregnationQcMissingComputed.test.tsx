/**
 * R29L — impregnation QC journal must not crash when computed is missing (legacy/partial rows).
 */
import { describe, expect, it } from 'vitest'
import { resolveImpregnationQcComputed } from '@/lib/technologist/calc'

describe('R29L impregnation QC missing computed', () => {
  it('resolves pending computed when row.computed is undefined', () => {
    const computed = resolveImpregnationQcComputed({
      computed: undefined as never,
      gravimetric: {},
      nvTolerancePp: 5,
    })
    expect(computed.nvPct).toBeNull()
    expect(computed.status).toBe('pending')
  })

  it('keeps existing computed when present', () => {
    const computed = resolveImpregnationQcComputed({
      computed: { nvPct: 12.5, absDeviationPp: 0.1, relDeviation: 0.01, status: 'pass' },
      gravimetric: {},
      nvTolerancePp: 5,
    })
    expect(computed.nvPct).toBe(12.5)
    expect(computed.status).toBe('pass')
  })
})

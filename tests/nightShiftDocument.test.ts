import { describe, expect, it } from 'vitest'
import {
  normalizeNightShiftDocument,
  normalizeReasons,
} from '@/lib/nightShift/init'

describe('night shift document reasons', () => {
  it('keeps reasons only for people on the roster', () => {
    const reasons = normalizeReasons(
      { a: ' срочный заказ ', b: '  ', c: 'подмена', other: 'drop' },
      ['a', 'c'],
    )
    expect(reasons).toEqual({ a: 'срочный заказ', c: 'подмена' })
  })

  it('drops empty and unknown ids', () => {
    expect(normalizeReasons({ x: 'ok' }, [])).toBeUndefined()
    expect(normalizeReasons(null, ['a'])).toBeUndefined()
    expect(normalizeReasons({ a: '' }, ['a'])).toBeUndefined()
  })

  it('round-trips through document normalize', () => {
    const doc = normalizeNightShiftDocument({
      id: 'ns1',
      date: '2026-08-14',
      status: 'draft',
      groups: ['line1'],
      employeeIds: ['e1', 'e2'],
      note: 'линия',
      reasons: { e1: 'заказ', e2: '  ', e9: 'чужой' },
    })
    expect(doc?.note).toBe('линия')
    expect(doc?.reasons).toEqual({ e1: 'заказ' })
  })
})

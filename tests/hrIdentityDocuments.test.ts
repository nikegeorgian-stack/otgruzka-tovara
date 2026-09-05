import { describe, expect, it } from 'vitest'
import { HR_DOC_TYPES, HR_MONITORED_DOC_TYPES } from '@/lib/hr/labels'

describe('HR identity document catalog', () => {
  it('offers identity card and permanent residence document types', () => {
    expect(HR_DOC_TYPES).toContain('Удостоверение личности')
    expect(HR_DOC_TYPES).toContain('ПМЖ')
  })

  it('monitors identity card and permanent residence expiry dates', () => {
    expect(HR_MONITORED_DOC_TYPES).toContain('Удостоверение личности')
    expect(HR_MONITORED_DOC_TYPES).toContain('ПМЖ')
  })
})

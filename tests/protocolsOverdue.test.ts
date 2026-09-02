import { describe, expect, it } from 'vitest'
import { deriveAssignmentStatus, normalizeProtocolsStore } from '@/lib/protocols/init'

describe('protocols overdue', () => {
  it('marks open item overdue when dueDate passed', () => {
    expect(deriveAssignmentStatus('in_progress', '2020-01-01', '2026-08-31')).toBe('overdue')
    expect(deriveAssignmentStatus('done', '2020-01-01', '2026-08-31')).toBe('done')
    expect(deriveAssignmentStatus('cancelled', '2020-01-01', '2026-08-31')).toBe('cancelled')
    expect(deriveAssignmentStatus('new', '2099-01-01', '2026-08-31')).toBe('new')
  })

  it('normalize derives overdue on load', () => {
    const store = normalizeProtocolsStore({
      protocols: [
        {
          id: 'p1',
          number: 'ПС-2026-001',
          meetingAt: '2026-01-01T10:00:00.000Z',
          topic: 'Test',
        },
      ],
      items: [
        {
          id: 'i1',
          protocolId: 'p1',
          sortOrder: 1,
          decision: 'd',
          assignmentText: 'a',
          status: 'in_progress',
          dueDate: '2000-01-01',
          ackStatus: 'not_sent',
        },
      ],
    })
    expect(store.items[0]?.status).toBe('overdue')
  })
})

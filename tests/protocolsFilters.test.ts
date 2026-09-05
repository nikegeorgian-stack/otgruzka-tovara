import { describe, expect, it } from 'vitest'
import { filterProtocolItems } from '@/lib/protocols/filters'
import { allocateProtocolNumber } from '@/lib/protocols/protocolNumber'
import type { ProtocolsStore } from '@/lib/protocols/types'
import type { Employee } from '@/lib/types'

describe('protocolNumber', () => {
  it('allocates ПС-YYYY-NNN', () => {
    expect(allocateProtocolNumber(2026, 1)).toEqual({
      number: 'ПС-2026-001',
      nextNumberSeq: 2,
    })
    expect(allocateProtocolNumber(2026, 12).number).toBe('ПС-2026-012')
  })
})

describe('filterProtocolItems', () => {
  const store: ProtocolsStore = {
    protocols: [
      {
        id: 'p1',
        number: 'ПС-2026-001',
        meetingAt: '2026-08-01T10:00:00.000Z',
        topic: 'A',
        participantEmployeeIds: [],
        attachmentIds: [],
        createdAt: '',
        updatedAt: '',
      },
    ],
    items: [
      {
        id: 'i1',
        protocolId: 'p1',
        sortOrder: 1,
        decision: 'd',
        assignmentText: 'do',
        assigneeEmployeeIds: ['e1'],
        dueDate: '2000-01-01',
        priority: 'normal',
        status: 'in_progress',
        attachmentIds: [],
        ackStatus: 'not_sent',
        updatedAt: '',
      },
      {
        id: 'i2',
        protocolId: 'p1',
        sortOrder: 2,
        decision: 'd2',
        assignmentText: 'ok',
        assigneeEmployeeIds: ['e2'],
        dueDate: '2099-01-01',
        priority: 'normal',
        status: 'new',
        attachmentIds: [],
        ackStatus: 'not_sent',
        updatedAt: '',
      },
    ],
    attachments: [],
    notifications: [],
  }

  const employees = [
    { id: 'e1', structuralUnitId: 'u1' },
    { id: 'e2', structuralUnitId: 'u2' },
  ] as Employee[]

  it('filters overdue and by assignee', () => {
    const overdue = filterProtocolItems(store, employees, { overdueOnly: true })
    expect(overdue.map((r) => r.item.id)).toEqual(['i1'])
    expect(overdue[0]?.item.status).toBe('overdue')

    const byEmp = filterProtocolItems(store, employees, { assigneeEmployeeId: 'e2' })
    expect(byEmp.map((r) => r.item.id)).toEqual(['i2'])
  })
})

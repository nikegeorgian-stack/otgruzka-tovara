import { describe, expect, it } from 'vitest'
import { createDefaultStore } from '@/lib/storage'
import { createDefaultProtocolsStore } from '@/lib/protocols/init'
import type { ProtocolItem } from '@/lib/protocols/types'
import { createProtocolsSlice } from '@/store/slices/protocolsSlice'
import type { AppStore } from '@/lib/types'

function baseItem(partial?: Partial<ProtocolItem>): ProtocolItem {
  return {
    id: 'i1',
    protocolId: 'p1',
    sortOrder: 1,
    decision: 'd',
    assignmentText: 'do it',
    assigneeEmployeeIds: ['e1'],
    priority: 'normal',
    status: 'new',
    attachmentIds: [],
    ackStatus: 'not_sent',
    updatedAt: '',
    ...partial,
  }
}

describe('protocol acknowledgement', () => {
  it('send → confirm locks; admin reset clears', () => {
    let store: AppStore = {
      ...createDefaultStore(),
      access: {
        ...createDefaultStore().access,
        users: [
          {
            id: 'admin',
            login: 'admin@x',
            displayName: 'Admin',
            roleId: 'sysadmin',
            active: true,
          },
        ],
      },
      protocols: {
        ...createDefaultProtocolsStore(),
        protocols: [
          {
            id: 'p1',
            number: 'ПС-2026-001',
            meetingAt: '2026-08-01T10:00:00.000Z',
            topic: 'T',
            participantEmployeeIds: [],
            attachmentIds: [],
            createdAt: '',
            updatedAt: '',
          },
        ],
        items: [baseItem()],
      },
    }

    const slice = createProtocolsSlice({
      setStore: (updater) => {
        store = typeof updater === 'function' ? updater(store) : updater
      },
      getStore: () => store,
      getActor: () => ({ id: 'admin', name: 'Admin' }),
    })

    expect(slice.sendProtocolItemForAck('i1', 'e1')).toBe(true)
    let item = store.protocols!.items.find((x) => x.id === 'i1')!
    expect(item.ackStatus).toBe('pending')
    expect(item.status).toBe('sent_for_ack')
    expect(store.protocols!.notifications[0]?.kind).toBe('ack_sent')

    expect(slice.confirmProtocolItemAck('i1', { method: 'in_app' })).toBe(true)
    item = store.protocols!.items.find((x) => x.id === 'i1')!
    expect(item.ackStatus).toBe('acknowledged')
    expect(item.ackLocked).toBe(true)
    expect(item.status).toBe('acknowledged')

    // locked: confirm again fails
    expect(slice.confirmProtocolItemAck('i1')).toBe(false)
    expect(slice.sendProtocolItemForAck('i1', 'e1')).toBe(false)

    expect(
      slice.adminFixProtocolItemAck('i1', {
        reason: 'ошибка',
        unlock: true,
        clearAck: true,
      }),
    ).toBe(true)
    item = store.protocols!.items.find((x) => x.id === 'i1')!
    expect(item.ackStatus).toBe('not_sent')
    expect(item.ackLocked).toBeFalsy()
  })

  it('admin fix requires sysadmin', () => {
    let store: AppStore = {
      ...createDefaultStore(),
      access: {
        ...createDefaultStore().access,
        users: [
          {
            id: 'sec',
            login: 'sec@x',
            displayName: 'Sec',
            roleId: 'secretary',
            active: true,
          },
        ],
      },
      protocols: {
        ...createDefaultProtocolsStore(),
        protocols: [
          {
            id: 'p1',
            number: 'ПС-2026-001',
            meetingAt: '2026-08-01T10:00:00.000Z',
            topic: 'T',
            participantEmployeeIds: [],
            attachmentIds: [],
            createdAt: '',
            updatedAt: '',
          },
        ],
        items: [
          baseItem({
            ackStatus: 'acknowledged',
            ackLocked: true,
            status: 'acknowledged',
          }),
        ],
      },
    }

    const slice = createProtocolsSlice({
      setStore: (updater) => {
        store = typeof updater === 'function' ? updater(store) : updater
      },
      getStore: () => store,
      getActor: () => ({ id: 'sec', name: 'Sec' }),
    })

    expect(
      slice.adminFixProtocolItemAck('i1', { reason: 'x', clearAck: true }),
    ).toBe(false)
  })
})

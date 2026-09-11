import { describe, expect, it } from 'vitest'

import { applyCriticalDomainOverlays } from '@/lib/cloud/applyCriticalDomainOverlays'
import {
  validateG5MasterdataItemUpsertAck,
  type G5AckPayload,
} from '@/lib/planner/g5ServerClient'
import { createDefaultStore } from '@/lib/storage'

describe('R3.1C G5 hard-pull revision baseline', () => {
  it('uses the exact pulled revision and requires the next mutation to advance it', async () => {
    const local = createDefaultStore()
    const originalRequests = local.production.requests
    ;(local.production as { g5CriticalRevision?: number }).g5CriticalRevision = 99

    const pulled = await applyCriticalDomainOverlays(local, {
      revision: 41,
      productionActive: false,
      packagingQcActive: false,
      salesPlanningActive: true,
      sales: { orders: [] },
    })

    expect(
      (pulled.production as { g5CriticalRevision?: number }).g5CriticalRevision,
    ).toBe(41)
    expect(pulled.production.requests).toBe(originalRequests)

    const expected = {
      id: 'item-c',
      code: 'FC-000160',
      name: 'Celloplex 160',
      baseUnit: 'm2',
      categoryId: 'fg',
      warehouseId: 'fg-wh',
    }
    const item = { ...expected, active: true }
    const ack = {
      criticalRevision: 41,
      id: expected.id,
      code: expected.code,
      item,
      masterData: { items: [item] },
    } satisfies G5AckPayload

    expect(validateG5MasterdataItemUpsertAck(ack, 41, expected)).toMatchObject({
      ok: false,
      error: 'masterdata_item_ack_mismatch',
    })
    expect(
      validateG5MasterdataItemUpsertAck({ ...ack, criticalRevision: 42 }, 41, expected),
    ).toEqual({ ok: true, criticalRevision: 42 })
  })
})

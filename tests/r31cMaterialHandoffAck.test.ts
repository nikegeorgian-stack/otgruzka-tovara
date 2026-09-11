import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalG3MaterialHandoffLines,
} from '@/lib/warehouse/g3MaterialHandoffIntegrityCore.mjs'
import {
  g3MaterialHandoffCommandFingerprint,
  validateG3MaterialHandoffAck,
} from '@/lib/warehouse/g3MaterialHandoffAck'

const harness = vi.hoisted(() => ({
  command: vi.fn(),
}))

vi.mock('@/lib/cloud/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  isFirebaseConfigured: () => false,
}))

vi.mock('@/lib/production/g3ServerClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/production/g3ServerClient')>(
    '@/lib/production/g3ServerClient',
  )
  return {
    ...actual,
    isG3WebAuthoritativePath: () => true,
    isG3ProductionDomainActive: () => true,
    g3ProductionCommand: (...args: unknown[]) => harness.command(...args),
  }
})

const ORDER_ID = 'order-canonical-1'
const LINE_ID = 'line-1'
const RESERVATION_ID = 'reservation-1'

function warehouse() {
  return {
    items: [],
    locations: [],
    categories: [],
    documents: [],
    movements: [],
    invoiceRegistry: [],
    auditLog: [],
  }
}

function submittedCommand(kind: 'issue' | 'return') {
  return {
    orderId: ORDER_ID,
    lineId: LINE_ID,
    rawWarehouseId: 'raw-wh',
    reservationDocumentId: kind === 'issue' ? RESERVATION_ID : undefined,
    reason: kind === 'return' ? 'unused' : undefined,
    lines: [
      {
        itemId: 'raw-item',
        quantity: 2,
        batchNo: 'B-1',
        expiryDate: '2027-01-01',
      },
    ],
  }
}

async function handoffAck(kind: 'issue' | 'return') {
  const pairId = `${kind}-pair-1`
  const issueDocumentId = `${kind}-issue-1`
  const receiptDocumentId = `${kind}-receipt-1`
  const issueLineId = `${kind}-issue-line-1`
  const receiptLineId = `${kind}-receipt-line-1`
  const issuePurpose =
    kind === 'issue' ? 'production_issue' : 'production_material_return'
  const receiptPurpose =
    kind === 'issue' ? 'production_receipt' : 'production_material_return'
  const reservation = kind === 'issue' ? RESERVATION_ID : undefined
  const idempotencyKey = `${kind}-business-key`
  const commandType =
    kind === 'issue'
      ? 'production.material.issueToLine'
      : 'production.material.returnFromLine'
  const command = submittedCommand(kind)
  const commandFingerprint = await g3MaterialHandoffCommandFingerprint(
    commandType,
    command,
  )
  if (!commandFingerprint) throw new Error('test fingerprint unavailable')
  const sourceTransferPairIds = kind === 'return' ? ['source-issue-pair'] : undefined
  const sourceCommandFingerprint =
    kind === 'return'
      ? await g3MaterialHandoffCommandFingerprint(
          'production.material.issueToLine',
          submittedCommand('issue'),
        )
      : null
  const sourceDocuments =
    kind === 'return'
      ? [
          {
            id: 'source-issue-document',
            type: 'issue',
            purpose: 'production_issue',
            docRole: 'transfer_issue',
            status: 'posted',
            warehouseId: 'raw-wh',
            transferPairId: 'source-issue-pair',
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: RESERVATION_ID,
            commandFingerprint: sourceCommandFingerprint,
          },
          {
            id: 'source-receipt-document',
            type: 'receipt',
            purpose: 'production_receipt',
            docRole: 'transfer_receipt',
            status: 'posted',
            warehouseId: 'line-wh',
            transferPairId: 'source-issue-pair',
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: RESERVATION_ID,
            commandFingerprint: sourceCommandFingerprint,
          },
        ]
      : []
  const sourceHandoffs =
    kind === 'return'
      ? [
          {
            id: 'source-handoff',
            kind: 'issue',
            orderId: ORDER_ID,
            lineId: LINE_ID,
            rawWarehouseId: 'raw-wh',
            transferPairId: 'source-issue-pair',
            issueDocumentId: 'source-issue-document',
            receiptDocumentId: 'source-receipt-document',
            reservationDocumentId: RESERVATION_ID,
            idempotencyKey: 'source-issue-business-key',
            commandFingerprint: sourceCommandFingerprint,
          },
        ]
      : []
  return {
    ok: true as const,
    data: {
      criticalRevision: 8,
      idempotent: false,
      orderId: ORDER_ID,
      lineId: LINE_ID,
      kind,
      rawWarehouseId: 'raw-wh',
      transferPairId: pairId,
      reservationDocumentId: reservation,
      reason: kind === 'return' ? 'unused' : '',
      sourceTransferPairIds,
      idempotencyKey,
      commandFingerprint,
      documentIds: [issueDocumentId, receiptDocumentId],
      warehouse: {
        productionLineBindings: [
          {
            id: LINE_ID,
            lineId: LINE_ID,
            productionWarehouseId: 'line-wh',
            productionLocationId: 'line-location',
          },
        ],
        documents: [
          ...sourceDocuments,
          {
            id: issueDocumentId,
            number: `${kind}-I`,
            type: 'issue',
            purpose: issuePurpose,
            docRole: 'transfer_issue',
            warehouseId: kind === 'issue' ? 'raw-wh' : 'line-wh',
            date: '2026-09-10',
            status: 'posted',
            transferPairId: pairId,
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: reservation,
            overReserveReason: kind === 'issue' ? undefined : undefined,
            returnReason: kind === 'return' ? 'unused' : undefined,
            sourceTransferPairIds,
            idempotencyKey: `${idempotencyKey}::issue`,
            commandFingerprint,
            lines: [
              {
                lineId: issueLineId,
                itemId: 'raw-item',
                quantity: 2,
                batchNo: 'B-1',
                expiryDate: '2027-01-01',
                locationId: kind === 'return' ? 'line-location' : 'raw-location',
                productionOrderId: ORDER_ID,
                productionLineId: LINE_ID,
              },
            ],
            createdAt: '2026-09-10T08:00:00.000Z',
          },
          {
            id: receiptDocumentId,
            number: `${kind}-R`,
            type: 'receipt',
            purpose: receiptPurpose,
            docRole: 'transfer_receipt',
            warehouseId: kind === 'issue' ? 'line-wh' : 'raw-wh',
            date: '2026-09-10',
            status: 'posted',
            transferPairId: pairId,
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: reservation,
            overReserveReason: kind === 'issue' ? undefined : undefined,
            returnReason: kind === 'return' ? 'unused' : undefined,
            sourceTransferPairIds,
            idempotencyKey: `${idempotencyKey}::receipt`,
            commandFingerprint,
            lines: [
              {
                lineId: receiptLineId,
                itemId: 'raw-item',
                quantity: 2,
                batchNo: 'B-1',
                expiryDate: '2027-01-01',
                locationId: kind === 'issue' ? 'line-location' : undefined,
                productionOrderId: ORDER_ID,
                productionLineId: LINE_ID,
              },
            ],
            createdAt: '2026-09-10T08:00:00.000Z',
          },
        ],
        movements: [
          {
            id: `${kind}-movement-issue-1`,
            documentId: issueDocumentId,
            documentLineId: issueLineId,
            itemId: 'raw-item',
            warehouseId: kind === 'issue' ? 'raw-wh' : 'line-wh',
            locationId: kind === 'return' ? 'line-location' : 'raw-location',
            type: 'issue',
            quantity: 2,
            batchNo: 'B-1',
            expiryDate: '2027-01-01',
            date: '2026-09-10',
            createdAt: '2026-09-10T08:00:00.000Z',
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: reservation,
            transferPairId: pairId,
            commandFingerprint,
            consumesReserve: kind === 'issue' ? true : undefined,
          },
          {
            id: `${kind}-movement-receipt-1`,
            documentId: receiptDocumentId,
            documentLineId: receiptLineId,
            itemId: 'raw-item',
            warehouseId: kind === 'issue' ? 'line-wh' : 'raw-wh',
            locationId: kind === 'issue' ? 'line-location' : undefined,
            type: 'receipt',
            quantity: 2,
            batchNo: 'B-1',
            expiryDate: '2027-01-01',
            date: '2026-09-10',
            createdAt: '2026-09-10T08:00:00.000Z',
            productionOrderId: ORDER_ID,
            productionLineId: LINE_ID,
            reservationDocumentId: reservation,
            transferPairId: pairId,
            commandFingerprint,
          },
        ],
      },
      production: {
        orders: [{ id: ORDER_ID, lineId: LINE_ID, status: 'active' }],
        handoffs: [
          ...sourceHandoffs,
          {
            id: `${kind}-handoff-1`,
            kind,
            orderId: ORDER_ID,
            lineId: LINE_ID,
            rawWarehouseId: 'raw-wh',
            transferPairId: pairId,
            issueDocumentId,
            receiptDocumentId,
            reservationDocumentId: reservation,
            overReserveReason: kind === 'issue' ? undefined : undefined,
            reason: kind === 'return' ? 'unused' : undefined,
            sourceTransferPairIds,
            idempotencyKey,
            commandFingerprint,
            submittedLines: canonicalG3MaterialHandoffLines(command.lines),
          },
        ],
      },
    },
  }
}

beforeEach(() => {
  harness.command.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('R3.1C authoritative material handoff acknowledgement', () => {
  it('allows an equal revision only for an exact idempotent replay', async () => {
    const expected = {
      commandType: 'production.material.issueToLine' as const,
      orderId: ORDER_ID,
      lineId: LINE_ID,
      rawWarehouseId: 'raw-wh',
      reservationDocumentId: RESERVATION_ID,
      lines: submittedCommand('issue').lines,
      idempotencyKey: 'issue-business-key',
      previousCriticalRevision: 8,
    }

    const replay = await handoffAck('issue')
    replay.data.idempotent = true
    expect(await validateG3MaterialHandoffAck(replay.data, expected)).toMatchObject({
      ok: true,
      criticalRevision: 8,
    })

    const nonReplay = await handoffAck('issue')
    expect(await validateG3MaterialHandoffAck(nonReplay.data, expected)).toEqual({
      ok: false,
      error: 'production_material_handoff_ack_mismatch',
    })

    replay.data.criticalRevision = 7
    expect(await validateG3MaterialHandoffAck(replay.data, expected)).toEqual({
      ok: false,
      error: 'production_material_handoff_ack_mismatch',
    })
  })

  it.each(['issue', 'return'] as const)(
    'accepts and mirrors one exact %s pair into warehouse and production',
    async (kind) => {
      const ack = await handoffAck(kind)
      harness.command.mockResolvedValueOnce(ack)
      const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
      let state = {
        warehouse: warehouse(),
        production: {
          g3ProductionDomainActive: true,
          legacyMarker: 'preserve-me',
          handoffs: [{ id: 'stale-soft-handoff' }],
        },
      } as never
      const updates: unknown[] = []
      const setStore = (action: unknown, meta?: unknown) => {
        updates.push(meta)
        state = (
          typeof action === 'function'
            ? (action as (current: typeof state) => typeof state)(state)
            : action
        ) as typeof state
      }
      const slice = createWarehouseSlice({
        setStore: setStore as never,
        getStore: () => state as never,
      })
      const productionOrder = { id: ORDER_ID, lineId: LINE_ID }
      const result =
        kind === 'issue'
          ? await slice.transferProductionOrderMaterials({
              productionOrder,
              rawWarehouseId: 'raw-wh',
              reservationDocumentId: RESERVATION_ID,
              lines: submittedCommand('issue').lines,
              idempotencyKey: 'issue-business-key',
            } as never)
          : await slice.returnProductionOrderMaterials({
              productionOrder,
              rawWarehouseId: 'raw-wh',
              returnReason: 'unused',
              lines: submittedCommand('return').lines,
              idempotencyKey: 'return-business-key',
            } as never)

      expect(result).toEqual({
        ok: true,
        documentIds: ack.data.documentIds,
        transferPairId: ack.data.transferPairId,
        idempotent: false,
      })
      expect(state.warehouse.documents).toEqual(ack.data.warehouse.documents)
      expect(state.warehouse.movements).toEqual(ack.data.warehouse.movements)
      expect(state.production.handoffs).toEqual(ack.data.production.handoffs)
      expect(state.production.g3Handoffs).toEqual(ack.data.production.handoffs)
      expect(state.production.legacyMarker).toBe('preserve-me')
      expect(updates).toEqual([{ origin: 'system' }])
      expect(harness.command).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: `${kind}-business-key`,
          commandType:
            kind === 'issue'
              ? 'production.material.issueToLine'
              : 'production.material.returnFromLine',
          command: expect.objectContaining({
            orderId: ORDER_ID,
            lineId: LINE_ID,
          }),
        }),
      )
    },
  )

  it.each([
    ['wrong top-level line', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.lineId = 'other-line'
    }],
    ['duplicate document ids', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.documentIds = [ack.data.documentIds[0], ack.data.documentIds[0]]
    }],
    ['reversed document ids', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.documentIds = [...ack.data.documentIds].reverse()
    }],
    ['wrong reservation', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.reservationDocumentId = 'other-reservation'
    }],
    ['wrong document purpose', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.documents[0].purpose = 'other'
    }],
    ['missing production handoff', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.production.handoffs = []
    }],
    ['forged echoed fingerprint', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      const forged = `g3-material-handoff:v1:${'0'.repeat(64)}`
      ack.data.commandFingerprint = forged
      ack.data.warehouse.documents.forEach((row) => {
        row.commandFingerprint = forged
      })
      ack.data.warehouse.movements.forEach((row) => {
        row.commandFingerprint = forged
      })
      ack.data.production.handoffs[0].commandFingerprint = forged
    }],
    ['changed submitted lot', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.production.handoffs[0].submittedLines[0].batchNo = 'OTHER-BATCH'
    }],
    ['wrong document line movement link', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.movements[0].documentLineId = 'other-line-id'
    }],
    ['cancelled posted document', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      Object.assign(ack.data.warehouse.documents[0], { cancelled: true })
    }],
    ['cancelled movement', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      Object.assign(ack.data.warehouse.movements[0], { cancelled: true })
    }],
    ['non-finite movement quantity', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.movements[0].quantity = Number.NaN
    }],
    ['wrong production route', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.movements[1].locationId = 'other-location'
    }],
    ['extra document reusing command key', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.documents.push({
        ...structuredClone(ack.data.warehouse.documents[0]),
        id: 'extra-command-document',
        transferPairId: 'other-pair',
      })
    }],
    ['extra movement reusing fingerprint', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.warehouse.movements.push({
        ...structuredClone(ack.data.warehouse.movements[0]),
        id: 'extra-fingerprint-movement',
        documentId: 'other-document',
        documentLineId: 'other-line',
        transferPairId: 'other-pair',
      })
    }],
    ['duplicate handoff projection', (ack: Awaited<ReturnType<typeof handoffAck>>) => {
      ack.data.production.handoffs.push({
        ...structuredClone(ack.data.production.handoffs[0]),
        id: 'duplicate-handoff',
      })
    }],
  ])('rejects %s without mutating either domain', async (_label, mutate) => {
    const ack = await handoffAck('issue')
    mutate(ack)
    harness.command.mockResolvedValueOnce(ack)
    const { createWarehouseSlice } = await import('@/store/slices/warehouseSlice')
    let state = {
      warehouse: warehouse(),
      production: { g3ProductionDomainActive: true, handoffs: [] },
    } as never
    const before = structuredClone(state)
    const setStore = vi.fn((action: (current: typeof state) => typeof state) => {
      state = action(state)
    })
    const slice = createWarehouseSlice({
      setStore: setStore as never,
      getStore: () => state as never,
    })

    const result = await slice.transferProductionOrderMaterials({
      productionOrder: { id: ORDER_ID, lineId: LINE_ID },
      rawWarehouseId: 'raw-wh',
      reservationDocumentId: RESERVATION_ID,
      lines: submittedCommand('issue').lines,
      idempotencyKey: 'issue-business-key',
    } as never)

    expect(result).toEqual({
      ok: false,
      error: 'production_material_handoff_ack_mismatch',
    })
    expect(setStore).not.toHaveBeenCalled()
    expect(state).toEqual(before)
  })

  it('rejects a return pair without exact non-empty source handoff lineage', async () => {
    const ack = await handoffAck('return')
    ack.data.sourceTransferPairIds = undefined
    ack.data.warehouse.documents.forEach((document) => {
      document.sourceTransferPairIds = undefined
    })
    ack.data.production.handoffs[0].sourceTransferPairIds = undefined

    expect(
      await validateG3MaterialHandoffAck(ack.data, {
        commandType: 'production.material.returnFromLine',
        orderId: ORDER_ID,
        lineId: LINE_ID,
        rawWarehouseId: 'raw-wh',
        reason: 'unused',
        lines: submittedCommand('return').lines,
        idempotencyKey: 'return-business-key',
        previousCriticalRevision: 0,
      }),
    ).toEqual({
      ok: false,
      error: 'production_material_handoff_ack_mismatch',
    })
  })
})

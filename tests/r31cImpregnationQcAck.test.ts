import { describe, expect, it } from 'vitest'

import {
  impregnationQcCommandFingerprint,
  validateImpregnationQcMutationAck,
} from '@/lib/production/impregnationQcAck'
import type { AuthoritativeImpregnationQcCommand } from '@/lib/technologist/types'

const command: AuthoritativeImpregnationQcCommand = {
  decisionKey: 'impregnation-qc:run-1:v1',
  decisionRevision: 1,
  productionOrderId: 'order-1',
  productionLineId: 'line-1',
  batchRunId: 'run-1',
  batchReceiptDocumentId: 'receipt-1',
  outputWarehouseItemId: 'impregnation-kg',
  labStatus: 'pending',
  decision: 'approved',
  decisionMethod: 'edu_manual_visual',
  visualOk: true,
  reason: 'Explicit staging rehearsal approval',
}

async function validAck(overrides: Record<string, unknown> = {}) {
  const commandFingerprint = await impregnationQcCommandFingerprint(command)
  const row = {
    id: 'decision-1',
    decisionId: 'decision-1',
    ...command,
    batchIssueDocumentId: 'issue-1',
    batchNo: 'MIX-1',
    outputQuantity: 100,
    commandFingerprint,
    actorUid: 'technologist-1',
    decidedAt: '2026-09-10T10:00:00.000Z',
    effective: true,
  }
  return {
    criticalRevision: 11,
    decisionId: row.id,
    decisionKey: command.decisionKey,
    decisionRevision: command.decisionRevision,
    decision: command.decision,
    labStatus: command.labStatus,
    decisionMethod: command.decisionMethod,
    productionOrderId: command.productionOrderId,
    productionLineId: command.productionLineId,
    batchRunId: command.batchRunId,
    batchNo: row.batchNo,
    batchIssueDocumentId: row.batchIssueDocumentId,
    batchReceiptDocumentId: command.batchReceiptDocumentId,
    outputWarehouseItemId: command.outputWarehouseItemId,
    outputQuantity: row.outputQuantity,
    commandFingerprint,
    actorUid: row.actorUid,
    decidedAt: row.decidedAt,
    effective: true,
    lineReady: true,
    touchesWarehouse: false,
    production: { impregnationQcDecisions: [row] },
    ...overrides,
  }
}

describe('R3.1C impregnation QC authoritative acknowledgement', () => {
  it('accepts one exact, monotonic decision stream', async () => {
    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck(),
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: true, criticalRevision: 11, decisionId: 'decision-1' })
  })

  it('requires a monotonic revision and marks equal revision as replay-only', async () => {
    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck({ criticalRevision: 9 }),
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'critical_revision_stale' })

    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck({ criticalRevision: 10 }),
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'critical_revision_not_advanced' })

    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck({ criticalRevision: 10, idempotent: true }),
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: true, criticalRevision: 10 })
  })

  it('rejects an echoed or changed command without the exact SHA-256', async () => {
    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck({ commandFingerprint: 'a'.repeat(64) }),
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'command_fingerprint_mismatch' })

    await expect(
      validateImpregnationQcMutationAck({
        ack: await validAck(),
        command: { ...command, reason: 'Changed payload' },
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'command_fingerprint_mismatch' })
  })

  it('requires exactly one matching persisted decision, not top-level success alone', async () => {
    const missing = await validAck({ production: { impregnationQcDecisions: [] } })
    await expect(
      validateImpregnationQcMutationAck({
        ack: missing,
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'decision_projection_not_unique' })

    const duplicated = await validAck()
    const decisions = (
      duplicated.production as { impregnationQcDecisions: Record<string, unknown>[] }
    ).impregnationQcDecisions
    duplicated.production = { impregnationQcDecisions: [...decisions, { ...decisions[0] }] }
    await expect(
      validateImpregnationQcMutationAck({
        ack: duplicated,
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'decision_projection_not_unique' })
  })

  it('rejects any claimed warehouse mutation for the no-ledger QC decision', async () => {
    for (const touchesWarehouse of [undefined, true]) {
      await expect(
        validateImpregnationQcMutationAck({
          ack: await validAck({ touchesWarehouse }),
          command,
          previousCriticalRevision: 10,
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: 'warehouse_mutation_not_allowed',
      })
    }
  })

  it('fails deterministically on malformed decision projection rows', async () => {
    for (const impregnationQcDecisions of [null, {}, [null], ['junk'], [[]]]) {
      await expect(
        validateImpregnationQcMutationAck({
          ack: await validAck({ production: { impregnationQcDecisions } }),
          command,
          previousCriticalRevision: 10,
        }),
      ).resolves.toMatchObject({
        ok: false,
        reason: 'decision_projection_shape_invalid',
      })
    }
  })

  it('rejects a persisted decision whose visual evidence differs from the command', async () => {
    const ack = await validAck()
    const row = (
      ack.production as { impregnationQcDecisions: Record<string, unknown>[] }
    ).impregnationQcDecisions[0]
    row.visualOk = false
    await expect(
      validateImpregnationQcMutationAck({
        ack,
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'decision_payload_mismatch' })
  })

  it('rejects an ambiguous effective history even when the selected row echoes', async () => {
    const ack = await validAck()
    const row = (
      ack.production as { impregnationQcDecisions: Record<string, unknown>[] }
    ).impregnationQcDecisions[0]
    ;(ack.production as { impregnationQcDecisions: Record<string, unknown>[] })
      .impregnationQcDecisions.push({
        ...row,
        id: 'foreign-effective',
        decisionId: 'foreign-effective',
        decisionKey: 'impregnation-qc:run-1:v2',
        decisionRevision: 2,
        supersedesDecisionId: 'decision-1',
        supersessionReason: 'forged',
      })
    await expect(
      validateImpregnationQcMutationAck({
        ack,
        command,
        previousCriticalRevision: 10,
      }),
    ).resolves.toMatchObject({ ok: false, reason: 'decision_stream_invalid' })
  })
})

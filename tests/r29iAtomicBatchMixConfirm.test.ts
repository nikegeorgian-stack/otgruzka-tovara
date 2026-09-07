/**
 * R2.9I — atomic mixer confirm: warehouse issue+receipt must survive with formulations.confirmed.
 */
import { describe, expect, it } from 'vitest'
import {
  confirmBatchMix,
  createPendingBatchMix,
  planFormulationBatch,
} from '@/lib/formulations/batch'
import type { FormulationRecipe, FormulationStore } from '@/lib/formulations/types'
import { warehouseTransactionGroupId } from '@/lib/cloud/transactionGroups'
import { warehouseIdempotencyKey } from '@/lib/warehouse/stockSafety'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { applyBatchMixConfirmCritical } from '../server/fst/_g2BatchMixConfirm.mjs'

const WH = 'wh-main'
const DATE = '2026-09-07'

function emptyWh(): WarehouseStore {
  return {
    locations: [{ id: WH, name: 'Основной', active: true }],
    categories: [],
    items: [
      { id: 'i-ll106', name: 'LL 106-50', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000012' },
      { id: 'i-ll145', name: 'LL 145-50', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000013' },
      { id: 'i-cal', name: 'Кальцит', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000014' },
      { id: 'i-dis', name: 'Dispex AA 4140', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000015' },
      { id: 'i-rhe', name: 'Rheovis HS 1212', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000016' },
      { id: 'i-water', name: 'Вода', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000017' },
      { id: 'i-out', name: 'Пропитка OUT', unit: 'кг', warehouseId: WH, active: true, internalCode: 'FC-000026' },
    ],
    documents: [
      {
        id: 'doc-seed',
        type: 'receipt',
        number: 'ПР-SEED',
        date: DATE,
        warehouseId: WH,
        status: 'posted',
        purpose: 'purchase',
        lines: [
          { itemId: 'i-ll106', quantity: 390 },
          { itemId: 'i-ll145', quantity: 150 },
          { itemId: 'i-cal', quantity: 150 },
          { itemId: 'i-dis', quantity: 3 },
          { itemId: 'i-rhe', quantity: 1 },
          { itemId: 'i-water', quantity: 106 },
        ],
        createdAt: `${DATE}T00:00:00.000Z`,
        postedAt: `${DATE}T00:00:00.000Z`,
      } as never,
    ],
    movements: [
      { id: 'm1', type: 'receipt', itemId: 'i-ll106', quantity: 390, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
      { id: 'm2', type: 'receipt', itemId: 'i-ll145', quantity: 150, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
      { id: 'm3', type: 'receipt', itemId: 'i-cal', quantity: 150, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
      { id: 'm4', type: 'receipt', itemId: 'i-dis', quantity: 3, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
      { id: 'm5', type: 'receipt', itemId: 'i-rhe', quantity: 1, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
      { id: 'm6', type: 'receipt', itemId: 'i-water', quantity: 106, warehouseId: WH, documentId: 'doc-seed', at: `${DATE}T00:00:00.000Z`, date: DATE },
    ] as never,
    auditLog: [],
    nextInternalCode: 27,
    accountingByWarehouse: [{ id: 'acc1', warehouseId: WH, status: 'active' }],
  } as WarehouseStore
}

function celloRecipe(): FormulationRecipe {
  return {
    id: 'rec-cello',
    code: 'РП-0003',
    name: 'EDU-CELLO-160-10 FULL-CYCLE',
    status: 'approved',
    version: 1,
    active: true,
    components: [
      { id: 'c1', name: 'LL 106-50', weightKg: 390, warehouseItemId: 'i-ll106' },
      { id: 'c2', name: 'LL 145-50', weightKg: 150, warehouseItemId: 'i-ll145' },
      { id: 'c3', name: 'Кальцит', weightKg: 150, warehouseItemId: 'i-cal' },
      { id: 'c4', name: 'Dispex AA 4140', weightKg: 3, warehouseItemId: 'i-dis' },
      { id: 'c5', name: 'Rheovis HS 1212', weightKg: 1, warehouseItemId: 'i-rhe' },
      { id: 'c6', name: 'Вода', weightKg: 106, warehouseItemId: 'i-water', isWater: true },
    ],
    outputWarehouseItemId: 'i-out',
    totalBatchKg: 800,
  } as FormulationRecipe
}

function bal(wh: WarehouseStore, itemId: string): number {
  let b = 0
  for (const m of wh.movements ?? []) {
    if (m.itemId !== itemId || m.warehouseId !== WH) continue
    const q = Math.abs(Number(m.quantity) || 0)
    if (m.type === 'receipt') b += q
    else if (m.type === 'issue') b -= q
    else b += Number(m.quantity) || 0
  }
  return b
}

describe('R2.9I plan includes warehouse water', () => {
  it('scales all six CELLO components including Вода when linked', () => {
    const plan = planFormulationBatch(celloRecipe(), emptyWh(), 800, WH)
    expect(plan.lines).toHaveLength(6)
    expect(plan.lines.map((l) => l.consumeKg).sort((a, b) => b - a)).toEqual([390, 150, 150, 106, 3, 1])
    expect(plan.lines.some((l) => l.name === 'Вода' && l.consumeKg === 106)).toBe(true)
  })
})

describe('R2.9I local confirmBatchMix atomic', () => {
  it('confirms with one issue (6 lines), one receipt, and debit BOM qtys', () => {
    const wh = emptyWh()
    const formulations: FormulationStore = {
      recipes: [celloRecipe()],
      batchRuns: [],
      nextInternalCode: 1,
    }
    const pending = createPendingBatchMix(
      formulations,
      wh,
      {
        recipeId: 'rec-cello',
        targetVolumeL: 800,
        warehouseId: WH,
        mixedAt: DATE,
        mixedBy: 'u1',
        mixedByName: 'Mixer',
      },
      'ru',
    )
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return
    const runId = pending.result.run.id
    expect(pending.result.run.lines).toHaveLength(6)

    const confirmed = confirmBatchMix(pending.formulations, pending.warehouse, {
      runId,
      keeperId: 'k1',
      keeperName: 'Keeper',
    })
    expect(confirmed.result.ok).toBe(true)
    if (!confirmed.result.ok) return
    expect(confirmed.result.run.status).toBe('confirmed')

    const issues = confirmed.warehouse.documents.filter(
      (d) => d.docRole === 'batch_issue' && d.status === 'posted',
    )
    const receipts = confirmed.warehouse.documents.filter(
      (d) => d.docRole === 'batch_receipt' && d.status === 'posted',
    )
    expect(issues).toHaveLength(1)
    expect(receipts).toHaveLength(1)
    expect(issues[0]!.lines).toHaveLength(6)

    const issueMovs = confirmed.warehouse.movements.filter(
      (m) => m.documentId === issues[0]!.id && m.type === 'issue',
    )
    expect(issueMovs).toHaveLength(6)
    expect(bal(confirmed.warehouse, 'i-ll106')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-ll145')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-cal')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-dis')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-rhe')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-water')).toBe(0)
    expect(bal(confirmed.warehouse, 'i-out')).toBe(800)

    const groupId = warehouseTransactionGroupId({
      kind: 'batch_mix',
      sourceId: runId,
      revision: 'confirm',
    })
    expect(groupId).toBe(`warehouse::batch_mix::${runId}::confirm`)
    expect(
      warehouseIdempotencyKey({
        source: 'batchRun',
        sourceId: runId,
        role: 'batch_issue',
        warehouseId: WH,
      }),
    ).toContain(runId)
  })

  it('fail-closed: stock shortage leaves run pending and warehouse unchanged', () => {
    const wh = emptyWh()
    wh.movements = wh.movements.filter((m) => m.itemId !== 'i-ll106') as never
    const formulations: FormulationStore = {
      recipes: [celloRecipe()],
      batchRuns: [],
      nextInternalCode: 1,
    }
    const pending = createPendingBatchMix(
      formulations,
      wh,
      {
        recipeId: 'rec-cello',
        targetVolumeL: 800,
        warehouseId: WH,
        mixedAt: DATE,
        mixedBy: 'u1',
        mixedByName: 'Mixer',
      },
      'ru',
      { allowNegativeStock: true },
    )
    expect(pending.result.ok).toBe(true)
    if (!pending.result.ok) return
    const beforeDocs = pending.warehouse.documents.length
    const confirmed = confirmBatchMix(pending.formulations, pending.warehouse, {
      runId: pending.result.run.id,
    })
    expect(confirmed.result.ok).toBe(false)
    expect(confirmed.formulations.batchRuns?.[0]?.status).toBe('pending')
    expect(confirmed.warehouse.documents.length).toBe(beforeDocs)
  })
})

describe('R2.9I critical applyBatchMixConfirmCritical', () => {
  it('posts issue+receipt atomically and is idempotent on replay', () => {
    const wh = emptyWh()
    const actor = { uid: 'keeper-1', email: 'k@test' }
    const now = `${DATE}T12:00:00.000Z`
    const runId = 'run-orphan-1'
    const cmd = {
      batchRunId: runId,
      warehouseId: WH,
      date: DATE,
      issueNumber: 'ЗМ-20260907-001-Р',
      receiptNumber: 'ЗМ-20260907-001-П',
      issueLines: [
        { itemId: 'i-ll106', quantity: 390 },
        { itemId: 'i-ll145', quantity: 150 },
        { itemId: 'i-cal', quantity: 150 },
        { itemId: 'i-dis', quantity: 3 },
        { itemId: 'i-rhe', quantity: 1 },
        { itemId: 'i-water', quantity: 106 },
      ],
      receiptLines: [{ itemId: 'i-out', quantity: 800 }],
      comment: 'R29I test',
    }
    const first = applyBatchMixConfirmCritical(wh, cmd, actor, now)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.result.documentIds).toHaveLength(2)
    expect(first.warehouse.documents.filter((d) => d.docRole === 'batch_issue')).toHaveLength(1)
    expect(
      first.warehouse.movements.filter((m) => m.type === 'issue' && m.documentId === first.result.issueDocumentId),
    ).toHaveLength(6)
    expect(bal(first.warehouse, 'i-water')).toBe(0)
    expect(bal(first.warehouse, 'i-out')).toBe(800)

    const replay = applyBatchMixConfirmCritical(first.warehouse, cmd, actor, now)
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.result.idempotentHint).toBe(true)
    expect(replay.result.documentIds).toEqual(first.result.documentIds)
    expect(replay.warehouse.documents.filter((d) => d.docRole === 'batch_issue')).toHaveLength(1)
    expect(bal(replay.warehouse, 'i-ll106')).toBe(0)
  })

  it('refuses partial existing batch docs without inventing a second half', () => {
    const wh = emptyWh()
    wh.documents.push({
      id: 'partial-issue',
      type: 'issue',
      number: 'ЗМ-X-Р',
      date: DATE,
      warehouseId: WH,
      status: 'posted',
      docRole: 'batch_issue',
      batchRunId: 'run-partial',
      lines: [{ itemId: 'i-ll106', quantity: 390 }],
      createdAt: `${DATE}T00:00:00.000Z`,
    } as never)
    const out = applyBatchMixConfirmCritical(
      wh,
      {
        batchRunId: 'run-partial',
        warehouseId: WH,
        date: DATE,
        issueNumber: 'ЗМ-X-Р',
        receiptNumber: 'ЗМ-X-П',
        issueLines: [{ itemId: 'i-ll106', quantity: 390 }],
        receiptLines: [{ itemId: 'i-out', quantity: 800 }],
      },
      { uid: 'k', email: 'k@t' },
      `${DATE}T12:00:00.000Z`,
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toBe('partial_batch_mix_docs')
  })
})

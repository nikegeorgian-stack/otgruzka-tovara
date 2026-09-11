import {
  computeEadCalculation,
  computeEadControl,
  computeImpregnationQc,
  computeIncomingControl,
} from '@/lib/technologist/calc'
import { normalizeShiftHandoff } from '@/lib/technologist/init'
import {
  impregnationQcDecisionKey,
  type EadCalculationRecord,
  type EadControlRecord,
  type ImpregnationQcRecord,
  type IncomingControlRecord,
  type RoomClimateRecord,
  type ShiftHandoffRecord,
  type ShiftHandoffUrgency,
} from '@/lib/technologist/types'
import { recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { type StoreSliceDeps } from '../storeApi'

export function createTechnologistQcSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertEadCalculation(entry: Omit<EadCalculationRecord, 'computed' | 'id' | 'createdAt'> & { id?: string }) {
      const now = new Date().toISOString()
      const computed = computeEadCalculation({
        cellSizeMode: entry.cellSizeMode,
        substrateCellWarp: entry.substrateCellWarp,
        substrateCellWeft: entry.substrateCellWeft,
        openCellWarp: entry.openCellWarp,
        openCellWeft: entry.openCellWeft,
        zones: entry.zones,
      })
      const row: EadCalculationRecord = {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        computed,
        createdAt: now,
      }
      setStore((s) => {
        const list = s.technologistQc.eadCalculations
        const idx = list.findIndex((r) => r.id === row.id)
        const eadCalculations =
          idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, technologistQc: { ...s.technologistQc, eadCalculations } }
      })
    },

    removeEadCalculation(id: string) {
      recordSliceExplicitDelete('technologistQc.eadCalculations', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          eadCalculations: s.technologistQc.eadCalculations.filter((r) => r.id !== id),
        },
      }))
    },

    upsertEadControl(entry: Omit<EadControlRecord, 'computed' | 'id' | 'createdAt'> & { id?: string }) {
      const now = new Date().toISOString()
      const computed = computeEadControl({
        targetGsm: entry.targetGsm,
        leftReadings: entry.leftReadings,
        rightReadings: entry.rightReadings,
      })
      const row: EadControlRecord = { ...entry, id: entry.id ?? crypto.randomUUID(), computed, createdAt: now }
      setStore((s) => {
        const list = s.technologistQc.eadControls
        const idx = list.findIndex((r) => r.id === row.id)
        const eadControls = idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, technologistQc: { ...s.technologistQc, eadControls } }
      })
    },

    removeEadControl(id: string) {
      recordSliceExplicitDelete('technologistQc.eadControls', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          eadControls: s.technologistQc.eadControls.filter((r) => r.id !== id),
        },
      }))
    },

    upsertIncomingControl(
      entry: Omit<IncomingControlRecord, 'computed' | 'id' | 'createdAt'> & { id?: string },
    ) {
      const now = new Date().toISOString()
      const computed = computeIncomingControl({
        kind: entry.kind,
        ph: entry.ph,
        phMin: entry.phMin,
        phMax: entry.phMax,
        drySolidsPct: entry.drySolidsPct,
        passportDrySolidsPct: entry.passportDrySolidsPct,
        grammageGsm: entry.grammageGsm,
        cellWarpMm: entry.cellWarpMm,
        cellWeftMm: entry.cellWeftMm,
        strengthWarpN: entry.strengthWarpN,
        strengthWeftN: entry.strengthWeftN,
      })
      const row: IncomingControlRecord = {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        computed,
        createdAt: now,
      }
      setStore((s) => {
        const list = s.technologistQc.incomingControls
        const idx = list.findIndex((r) => r.id === row.id)
        const incomingControls =
          idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, technologistQc: { ...s.technologistQc, incomingControls } }
      })
    },

    removeIncomingControl(id: string) {
      recordSliceExplicitDelete('technologistQc.incomingControls', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          incomingControls: s.technologistQc.incomingControls.filter((r) => r.id !== id),
        },
      }))
    },

    upsertImpregnationQc(
      entry: Omit<ImpregnationQcRecord, 'computed' | 'id' | 'createdAt'> & { id?: string },
    ) {
      const now = new Date().toISOString()
      const computed = computeImpregnationQc({
        gravimetric: entry.gravimetric,
        theoreticalNvPct: entry.theoreticalNvPct,
        nvTolerancePp: entry.nvTolerancePp,
      })
      const row: ImpregnationQcRecord = {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        computed,
        createdAt: now,
      }
      setStore((s) => {
        const list = s.technologistQc.impregnationQc
        const idx = list.findIndex((r) => r.id === row.id)
        const existing = idx >= 0 ? list[idx] : undefined
        const hasAuthoritativeMetadata = Boolean(
          row.authoritativeDecisionId ||
            row.authoritativeDecisionKey ||
            row.authoritativeCommandFingerprint ||
            row.authoritativeActorUid ||
            row.authoritativeDecidedAt ||
            row.authoritativeCriticalRevision !== undefined ||
            row.decisionRevision !== undefined ||
            row.supersedesDecisionId ||
            row.supersessionReason ||
            row.supersededByDecisionId ||
            row.effective !== undefined,
        )
        const decisionRevision = Number(row.decisionRevision)
        const outputQuantity = Number(row.outputQuantity)
        const isCompleteAuthoritativeAck = Boolean(
          row.authoritativeDecisionId &&
            row.id === row.authoritativeDecisionId &&
            row.batchRunId &&
            row.batchNumber &&
            row.batchIssueDocumentId &&
            row.batchReceiptDocumentId &&
            row.productionOrderId &&
            row.productionLineId &&
            row.outputWarehouseItemId &&
            Number.isFinite(outputQuantity) &&
            outputQuantity > 0 &&
            Number.isInteger(decisionRevision) &&
            decisionRevision >= 1 &&
            row.authoritativeDecisionKey ===
              impregnationQcDecisionKey(row.batchRunId, decisionRevision) &&
            /^[a-f0-9]{64}$/.test(row.authoritativeCommandFingerprint ?? '') &&
            row.authoritativeActorUid &&
            row.authoritativeDecidedAt &&
            (row.labStatus === 'pending' || row.labStatus === 'pass' || row.labStatus === 'fail') &&
            (row.decision === 'approved' || row.decision === 'rejected') &&
            (row.decisionMethod === 'measured' ||
              row.decisionMethod === 'edu_manual_visual') &&
            Number.isInteger(row.authoritativeCriticalRevision) &&
            Number(row.authoritativeCriticalRevision) > 0 &&
            row.effective === true &&
            !row.supersededByDecisionId,
        )
        if (hasAuthoritativeMetadata && !isCompleteAuthoritativeAck) return s
        // An authoritative acknowledgement is append-only local history. Exact
        // replay is a no-op; form values can never rewrite recorded evidence.
        if (existing?.authoritativeDecisionId) return s
        const persistedRow = existing ? { ...row, createdAt: existing.createdAt } : row
        let withSupersededPredecessor = list
        if (isCompleteAuthoritativeAck) {
          const sameBatch = list.filter(
            (record) =>
              record.authoritativeDecisionId && record.batchRunId === row.batchRunId,
          )
          if (decisionRevision === 1) {
            if (row.supersedesDecisionId) return s
          } else {
            if (!row.supersedesDecisionId || !row.supersessionReason?.trim()) return s
            const predecessors = sameBatch.filter(
              (record) => record.authoritativeDecisionId === row.supersedesDecisionId,
            )
            if (predecessors.length === 1) {
              const predecessor = predecessors[0]
              const predecessorOutputQuantity = Number(predecessor.outputQuantity)
              const predecessorIsCompatible =
                predecessor.effective !== false &&
                !predecessor.supersededByDecisionId &&
                Number(predecessor.decisionRevision) === decisionRevision - 1 &&
                predecessor.authoritativeDecisionKey ===
                  impregnationQcDecisionKey(row.batchRunId, decisionRevision - 1) &&
                predecessor.productionOrderId === row.productionOrderId &&
                predecessor.productionLineId === row.productionLineId &&
                predecessor.batchIssueDocumentId === row.batchIssueDocumentId &&
                predecessor.batchReceiptDocumentId === row.batchReceiptDocumentId &&
                predecessor.outputWarehouseItemId === row.outputWarehouseItemId &&
                predecessor.batchNumber === row.batchNumber &&
                Number.isFinite(predecessorOutputQuantity) &&
                predecessorOutputQuantity > 0 &&
                Math.abs(predecessorOutputQuantity - outputQuantity) <= 1e-9 &&
                !sameBatch.some(
                  (record) =>
                    record.authoritativeDecisionId !== predecessor.authoritativeDecisionId &&
                    record.effective !== false &&
                    !record.supersededByDecisionId,
                )
              if (predecessorIsCompatible) {
                withSupersededPredecessor = list.map((record) =>
                  record === predecessor
                    ? {
                        ...record,
                        effective: false,
                        supersededByDecisionId: row.authoritativeDecisionId,
                        supersededAt: row.authoritativeDecidedAt,
                      }
                    : record,
                )
              }
            }
          }
        }
        const impregnationQc =
          idx >= 0
            ? withSupersededPredecessor.map((record, index) =>
                index === idx ? persistedRow : record,
              )
            : [persistedRow, ...withSupersededPredecessor]
        return { ...s, technologistQc: { ...s.technologistQc, impregnationQc } }
      })
    },

    removeImpregnationQc(id: string) {
      let removed = false
      setStore((s) => {
        const record = s.technologistQc.impregnationQc.find((candidate) => candidate.id === id)
        if (!record || record.authoritativeDecisionId) return s
        removed = true
        return {
          ...s,
          technologistQc: {
            ...s.technologistQc,
            impregnationQc: s.technologistQc.impregnationQc.filter((candidate) => candidate.id !== id),
          },
        }
      })
      if (removed) recordSliceExplicitDelete('technologistQc.impregnationQc', id)
      return removed
    },

    addRoomClimateReading(
      entry: Omit<RoomClimateRecord, 'id' | 'createdAt'>,
    ) {
      const row: RoomClimateRecord = {
        ...entry,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      }
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          roomClimateLog: [row, ...s.technologistQc.roomClimateLog],
        },
      }))
    },

    removeRoomClimateReading(id: string) {
      recordSliceExplicitDelete('technologistQc.roomClimateLog', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          roomClimateLog: s.technologistQc.roomClimateLog.filter((r) => r.id !== id),
        },
      }))
    },

    upsertShiftHandoff(
      entry: Omit<ShiftHandoffRecord, 'id' | 'createdAt' | 'updatedAt' | 'acknowledgements'> & {
        id?: string
        acknowledgements?: ShiftHandoffRecord['acknowledgements']
      },
    ) {
      const now = new Date().toISOString()
      const row = normalizeShiftHandoff({
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        acknowledgements: entry.acknowledgements ?? [],
      })
      if (!row) return
      setStore((s) => {
        const list = s.technologistQc.shiftHandoffs ?? []
        const idx = list.findIndex((h) => h.id === row.id)
        const shiftHandoffs =
          idx >= 0
            ? list.map((h, i) =>
                i === idx
                  ? {
                      ...row,
                      createdAt: h.createdAt,
                      acknowledgements: h.acknowledgements,
                      updatedAt: now,
                    }
                  : h,
              )
            : [row, ...list]
        return {
          ...s,
          technologistQc: { ...s.technologistQc, shiftHandoffs },
        }
      })
    },

    acknowledgeShiftHandoff(
      id: string,
      who: { userId?: string; userName: string },
    ) {
      const at = new Date().toISOString()
      setStore((s) => {
        const list = s.technologistQc.shiftHandoffs ?? []
        return {
          ...s,
          technologistQc: {
            ...s.technologistQc,
            shiftHandoffs: list.map((h) => {
              if (h.id !== id || h.status !== 'open') return h
              const already = who.userId
                ? h.acknowledgements.some((a) => a.userId === who.userId)
                : h.acknowledgements.some((a) => a.userName === who.userName)
              if (already) return h
              return {
                ...h,
                updatedAt: at,
                acknowledgements: [
                  ...h.acknowledgements,
                  {
                    userId: who.userId,
                    userName: who.userName,
                    at,
                  },
                ],
              }
            }),
          },
        }
      })
    },

    setShiftHandoffStatus(id: string, status: ShiftHandoffRecord['status']) {
      const at = new Date().toISOString()
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          shiftHandoffs: (s.technologistQc.shiftHandoffs ?? []).map((h) =>
            h.id === id ? { ...h, status, updatedAt: at } : h,
          ),
        },
      }))
    },

    removeShiftHandoff(id: string) {
      recordSliceExplicitDelete('technologistQc.shiftHandoffs', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          shiftHandoffs: (s.technologistQc.shiftHandoffs ?? []).filter((h) => h.id !== id),
        },
      }))
    },

    setShiftHandoffUrgency(id: string, urgency: ShiftHandoffUrgency) {
      const at = new Date().toISOString()
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          shiftHandoffs: (s.technologistQc.shiftHandoffs ?? []).map((h) =>
            h.id === id ? { ...h, urgency, updatedAt: at } : h,
          ),
        },
      }))
    },
  }
}

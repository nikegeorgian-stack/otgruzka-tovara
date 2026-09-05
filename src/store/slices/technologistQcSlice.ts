import {
  computeEadCalculation,
  computeEadControl,
  computeImpregnationQc,
  computeIncomingControl,
} from '@/lib/technologist/calc'
import { normalizeShiftHandoff } from '@/lib/technologist/init'
import type {
  EadCalculationRecord,
  EadControlRecord,
  ImpregnationQcRecord,
  IncomingControlRecord,
  RoomClimateRecord,
  ShiftHandoffRecord,
  ShiftHandoffUrgency,
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
        const impregnationQc =
          idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, technologistQc: { ...s.technologistQc, impregnationQc } }
      })
    },

    removeImpregnationQc(id: string) {
      recordSliceExplicitDelete('technologistQc.impregnationQc', id)
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          impregnationQc: s.technologistQc.impregnationQc.filter((r) => r.id !== id),
        },
      }))
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

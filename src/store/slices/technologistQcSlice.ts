import {
  computeEadCalculation,
  computeEadControl,
  computeImpregnationQc,
  computeIncomingControl,
} from '@/lib/technologist/calc'
import type {
  EadCalculationRecord,
  EadControlRecord,
  ImpregnationQcRecord,
  IncomingControlRecord,
  RoomClimateRecord,
} from '@/lib/technologist/types'
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
      setStore((s) => ({
        ...s,
        technologistQc: {
          ...s.technologistQc,
          roomClimateLog: s.technologistQc.roomClimateLog.filter((r) => r.id !== id),
        },
      }))
    },
  }
}

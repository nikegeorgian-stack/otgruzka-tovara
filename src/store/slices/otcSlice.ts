import {
  addDaysIso,
  computeAlkaliVerdict,
  computeLabTestVerdict,
} from '@/lib/otc/calc'
import { recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import type {
  OtcAlkaliSeries,
  OtcDefectCase,
  OtcLabTest,
  OtcNorm,
  OtcSortingRecord,
} from '@/lib/otc/types'
import { type StoreSliceDeps } from '../storeApi'

export function createOtcSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertOtcNorm(entry: OtcNorm) {
      setStore((s) => {
        const list = s.otc.norms
        const idx = list.findIndex((r) => r.id === entry.id)
        const norms = idx >= 0 ? list.map((r, i) => (i === idx ? entry : r)) : [entry, ...list]
        return { ...s, otc: { ...s.otc, norms } }
      })
    },

    removeOtcNorm(id: string) {
      recordSliceExplicitDelete('otc.norms', id)
      setStore((s) => ({
        ...s,
        otc: { ...s.otc, norms: s.otc.norms.filter((r) => r.id !== id) },
      }))
    },

    upsertOtcLabTest(
      entry: Omit<OtcLabTest, 'computed' | 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ) {
      const now = new Date().toISOString()
      const computed = computeLabTestVerdict({
        value: entry.value,
        valueSecondary: entry.valueSecondary,
        normMin: entry.normMin,
        normMax: entry.normMax,
      })
      setStore((s) => {
        const list = s.otc.labTests
        const id = entry.id ?? crypto.randomUUID()
        const prev = list.find((r) => r.id === id)
        const row: OtcLabTest = {
          ...entry,
          id,
          computed,
          createdAt: entry.createdAt ?? prev?.createdAt ?? now,
          updatedAt: now,
        }
        const idx = list.findIndex((r) => r.id === row.id)
        const labTests = idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, otc: { ...s.otc, labTests } }
      })
    },

    removeOtcLabTest(id: string) {
      recordSliceExplicitDelete('otc.labTests', id)
      setStore((s) => ({
        ...s,
        otc: { ...s.otc, labTests: s.otc.labTests.filter((r) => r.id !== id) },
      }))
    },

    upsertOtcAlkaliSeries(
      entry: Omit<OtcAlkaliSeries, 'computed' | 'id' | 'createdAt' | 'dueDate'> & {
        id?: string
        createdAt?: string
        dueDate?: string
      },
    ) {
      const now = new Date().toISOString()
      const dueDate =
        entry.dueDate ??
        (entry.soakDate ? addDaysIso(entry.soakDate, 28) : undefined)
      const computed = computeAlkaliVerdict({
        strengthBefore: entry.strengthBefore,
        strengthAfter: entry.strengthAfter,
        strengthBeforeSecondary: entry.strengthBeforeSecondary,
        strengthAfterSecondary: entry.strengthAfterSecondary,
        residualMinPct: entry.residualMinPct,
        phase: entry.phase,
      })
      setStore((s) => {
        const list = s.otc.alkaliSeries
        const id = entry.id ?? crypto.randomUUID()
        const prev = list.find((r) => r.id === id)
        const row: OtcAlkaliSeries = {
          ...entry,
          id,
          dueDate,
          computed,
          createdAt: entry.createdAt ?? prev?.createdAt ?? now,
          updatedAt: now,
        }
        const idx = list.findIndex((r) => r.id === row.id)
        const alkaliSeries =
          idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, otc: { ...s.otc, alkaliSeries } }
      })
    },

    removeOtcAlkaliSeries(id: string) {
      recordSliceExplicitDelete('otc.alkaliSeries', id)
      setStore((s) => ({
        ...s,
        otc: { ...s.otc, alkaliSeries: s.otc.alkaliSeries.filter((r) => r.id !== id) },
      }))
    },

    upsertOtcSorting(
      entry: Omit<OtcSortingRecord, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ) {
      const now = new Date().toISOString()
      const row: OtcSortingRecord = {
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
        createdAt: entry.createdAt ?? now,
      }
      setStore((s) => {
        const list = s.otc.sorting
        const idx = list.findIndex((r) => r.id === row.id)
        const sorting = idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, otc: { ...s.otc, sorting } }
      })
    },

    removeOtcSorting(id: string) {
      recordSliceExplicitDelete('otc.sorting', id)
      setStore((s) => ({
        ...s,
        otc: { ...s.otc, sorting: s.otc.sorting.filter((r) => r.id !== id) },
      }))
    },

    upsertOtcDefect(
      entry: Omit<OtcDefectCase, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ) {
      const now = new Date().toISOString()
      setStore((s) => {
        const list = s.otc.defects
        const id = entry.id ?? crypto.randomUUID()
        const prev = list.find((r) => r.id === id)
        const row: OtcDefectCase = {
          ...entry,
          id,
          photos: (entry.photos ?? []).slice(0, 6),
          createdAt: entry.createdAt ?? prev?.createdAt ?? now,
          updatedAt: now,
        }
        const idx = list.findIndex((r) => r.id === row.id)
        const defects = idx >= 0 ? list.map((r, i) => (i === idx ? row : r)) : [row, ...list]
        return { ...s, otc: { ...s.otc, defects } }
      })
    },

    removeOtcDefect(id: string) {
      recordSliceExplicitDelete('otc.defects', id)
      setStore((s) => ({
        ...s,
        otc: { ...s.otc, defects: s.otc.defects.filter((r) => r.id !== id) },
      }))
    },
  }
}

import {
  applyWastewaterTransition,
  type WastewaterTransition,
  type WastewaterTransitionPatch,
} from '@/lib/wastewater/transitions'
import {
  allocateWastewaterInternalCode,
  emptyWastewaterCube,
  isWastewaterCubeNumberTaken,
  nextWastewaterCubeNumber,
  normalizeWastewaterStore,
  parseWastewaterCubeNumber,
  parseWastewaterInternalCodeNum,
} from '@/lib/wastewater/init'
import type { WastewaterCube } from '@/lib/wastewater/types'
import { type StoreSliceDeps } from '../storeApi'

export function createWastewaterSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertWastewaterCube(
      entry: Omit<WastewaterCube, 'createdAt' | 'updatedAt' | 'id'> & {
        id?: string
        createdAt?: string
      },
    ) {
      const now = new Date().toISOString()
      setStore((s) => {
        const ww = normalizeWastewaterStore(s.wastewater)
        const cubeNumber = parseWastewaterCubeNumber(entry.cubeNumber)
        if (cubeNumber == null) return s
        if (isWastewaterCubeNumberTaken(ww, cubeNumber, entry.id)) return s
        const row: WastewaterCube = {
          ...entry,
          cubeNumber,
          internalCode:
            ww.cubes.find((c) => c.id === entry.id)?.internalCode ||
            entry.internalCode ||
            allocateWastewaterInternalCode(ww),
          id: entry.id ?? crypto.randomUUID(),
          createdAt: entry.createdAt ?? now,
          updatedAt: now,
        }
        const idx = ww.cubes.findIndex((c) => c.id === row.id)
        const cubes =
          idx >= 0 ? ww.cubes.map((c, i) => (i === idx ? row : c)) : [row, ...ww.cubes]
        const nextCubeNumber = Math.max(
          ww.nextCubeNumber,
          ...cubes.map((c) => c.cubeNumber + 1),
          1,
        )
        const nextInternalCode = Math.max(
          ww.nextInternalCode ?? 1,
          parseWastewaterInternalCodeNum(row.internalCode) + 1,
          1,
        )
        return { ...s, wastewater: { cubes, nextCubeNumber, nextInternalCode } }
      })
    },

    createWastewaterCube(input: {
      wasteType: string
      color: string
      locationNote?: string
      fillStartDate?: string
      note?: string
      createdByName?: string
      cubeNumber?: number
    }) {
      setStore((s) => {
        const ww = normalizeWastewaterStore(s.wastewater)
        const requested = input.cubeNumber != null ? parseWastewaterCubeNumber(input.cubeNumber) : null
        const cubeNumber =
          requested != null && !isWastewaterCubeNumberTaken(ww, requested)
            ? requested
            : nextWastewaterCubeNumber(ww)
        const internalCode = allocateWastewaterInternalCode(ww)
        const cube = emptyWastewaterCube(cubeNumber, internalCode, input.createdByName)
        cube.wasteType = input.wasteType.trim()
        cube.color = input.color.trim()
        cube.locationNote = input.locationNote?.trim() || undefined
        cube.fillStartDate = input.fillStartDate?.slice(0, 10) || cube.fillStartDate
        cube.note = input.note?.trim() || undefined
        return {
          ...s,
          wastewater: {
            cubes: [cube, ...ww.cubes],
            nextCubeNumber: cubeNumber + 1,
            nextInternalCode: parseWastewaterInternalCodeNum(internalCode) + 1,
          },
        }
      })
    },

    applyWastewaterCubeTransition(
      id: string,
      action: WastewaterTransition,
      patch: WastewaterTransitionPatch = {},
    ): { ok: boolean; error?: string } {
      let result: { ok: boolean; error?: string } = { ok: true }
      setStore((s) => {
        const ww = normalizeWastewaterStore(s.wastewater)
        const current = ww.cubes.find((c) => c.id === id)
        if (!current) {
          result = { ok: false, error: 'not_found' }
          return s
        }
        const applied = applyWastewaterTransition(current, action, patch)
        if (!applied.ok) {
          result = { ok: false, error: applied.error }
          return s
        }
        result = { ok: true }
        return {
          ...s,
          wastewater: {
            ...ww,
            cubes: ww.cubes.map((c) => (c.id === id ? applied.cube : c)),
          },
        }
      })
      return result
    },

    removeWastewaterCube(id: string) {
      setStore((s) => ({
        ...s,
        wastewater: {
          ...normalizeWastewaterStore(s.wastewater),
          cubes: s.wastewater.cubes.filter((c) => c.id !== id),
        },
      }))
    },
  }
}

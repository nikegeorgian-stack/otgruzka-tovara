import { newId } from '@/lib/production/files'
import type { WastewaterCube, WastewaterCubeStatus, WastewaterStore } from './types'
import { WASTEWATER_CUBE_STATUSES } from './types'

const VALID_STATUSES = new Set<WastewaterCubeStatus>(WASTEWATER_CUBE_STATUSES)

export function formatWastewaterInternalCode(n: number): string {
  return `SW-${String(Math.max(1, Math.floor(n))).padStart(6, '0')}`
}

export function parseWastewaterInternalCodeNum(code: string | undefined): number {
  const m = /^SW-(\d+)$/i.exec(code?.trim() ?? '')
  return m ? Number(m[1]) : 0
}

function normalizeCube(c: WastewaterCube, fallbackInternalCode?: string): WastewaterCube {
  const status = VALID_STATUSES.has(c.status) ? c.status : 'filling'
  const statusBeforeClose =
    c.statusBeforeClose && VALID_STATUSES.has(c.statusBeforeClose)
      ? c.statusBeforeClose
      : undefined
  return {
    id: c.id || newId(),
    cubeNumber: Number(c.cubeNumber) > 0 ? Number(c.cubeNumber) : 1,
    internalCode: c.internalCode?.trim() || fallbackInternalCode || '',
    wasteType: c.wasteType?.trim() ?? '',
    color: c.color?.trim() ?? '',
    massKg: Number.isFinite(Number(c.massKg)) && c.massKg != null ? Number(c.massKg) : undefined,
    fillStartDate: c.fillStartDate?.slice(0, 10) || undefined,
    fillEndDate: c.fillEndDate?.slice(0, 10) || undefined,
    status,
    statusBeforeClose,
    locationNote: c.locationNote?.trim() || undefined,
    usageNote: c.usageNote?.trim() || undefined,
    dryResiduePct:
      c.dryResiduePct != null && Number.isFinite(Number(c.dryResiduePct))
        ? Number(c.dryResiduePct)
        : undefined,
    usedFromDate: c.usedFromDate?.slice(0, 10) || undefined,
    usedToDate: c.usedToDate?.slice(0, 10) || undefined,
    usedMassKg:
      Number.isFinite(Number(c.usedMassKg)) && c.usedMassKg != null
        ? Number(c.usedMassKg)
        : undefined,
    note: c.note?.trim() || undefined,
    createdAt: c.createdAt || new Date().toISOString(),
    updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
    createdByName: c.createdByName?.trim() || undefined,
    closedAt: c.closedAt || undefined,
  }
}

export function createDefaultWastewaterStore(): WastewaterStore {
  return { cubes: [], nextCubeNumber: 1, nextInternalCode: 1 }
}

export function allocateWastewaterInternalCode(store: WastewaterStore): string {
  const fromField = store.nextInternalCode ?? 1
  const maxExisting = store.cubes.reduce(
    (max, c) => Math.max(max, parseWastewaterInternalCodeNum(c.internalCode)),
    0,
  )
  return formatWastewaterInternalCode(Math.max(fromField, maxExisting + 1, 1))
}

export function normalizeWastewaterStore(raw: WastewaterStore | undefined): WastewaterStore {
  if (!raw?.cubes?.length) {
    return {
      cubes: [],
      nextCubeNumber: Math.max(1, raw?.nextCubeNumber ?? 1),
      nextInternalCode: Math.max(1, raw?.nextInternalCode ?? 1),
    }
  }
  let nextInternal = Math.max(1, raw.nextInternalCode ?? 1)
  const cubes = raw.cubes.map((c) => {
    if (c.internalCode?.trim()) {
      nextInternal = Math.max(nextInternal, parseWastewaterInternalCodeNum(c.internalCode) + 1)
      return normalizeCube(c)
    }
    const code = formatWastewaterInternalCode(nextInternal++)
    return normalizeCube(c, code)
  })
  const maxNum = cubes.reduce((max, c) => Math.max(max, c.cubeNumber), 0)
  return {
    cubes,
    nextCubeNumber: Math.max(raw.nextCubeNumber ?? 1, maxNum + 1, 1),
    nextInternalCode: Math.max(nextInternal, raw.nextInternalCode ?? 1, 1),
  }
}

export function nextWastewaterCubeNumber(store: WastewaterStore): number {
  const fromField = store.nextCubeNumber
  const maxExisting = store.cubes.reduce((max, c) => Math.max(max, c.cubeNumber), 0)
  return Math.max(fromField, maxExisting + 1, 1)
}

export function isWastewaterCubeNumberTaken(
  store: WastewaterStore,
  cubeNumber: number,
  excludeId?: string,
): boolean {
  return store.cubes.some((c) => c.cubeNumber === cubeNumber && c.id !== excludeId)
}

export function parseWastewaterCubeNumber(raw: string | number | undefined): number | null {
  const n = Math.round(Number(String(raw ?? '').replace(',', '.')))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

export function emptyWastewaterCube(
  cubeNumber: number,
  internalCode: string,
  createdByName?: string,
): WastewaterCube {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)
  return {
    id: newId(),
    cubeNumber,
    internalCode,
    wasteType: '',
    color: '',
    fillStartDate: today,
    status: 'filling',
    createdAt: now,
    updatedAt: now,
    createdByName,
  }
}

/** Учёт кубов сточных вод на линии пропитки */

export type WastewaterCubeStatus =
  | 'filling'
  | 'waiting'
  | 'drain_zone'
  | 'in_use'
  | 'used'
  | 'unsuitable'

export type WastewaterCube = {
  id: string
  /** Порядковый номер куба (на линии) */
  cubeNumber: number
  /** Внутренний код SW-000001 (не меняется) */
  internalCode: string
  /** Статус до закрытия (для отмены «Не пригоден») */
  statusBeforeClose?: WastewaterCubeStatus
  /** Тип стока: сетка, ратл, мембрана… */
  wasteType: string
  /** Цвет сточных вод */
  color: string
  /** Масса после наполнения, кг */
  massKg?: number
  /** YYYY-MM-DD */
  fillStartDate?: string
  fillEndDate?: string
  status: WastewaterCubeStatus
  /** Где стоит: «возле 2 линии», «зона сливов»… */
  locationNote?: string
  /** Даты/объём использования в пропитке (свободный текст) */
  usageNote?: string
  /** Сухой остаток, % */
  dryResiduePct?: number
  usedFromDate?: string
  usedToDate?: string
  usedMassKg?: number
  note?: string
  createdAt: string
  updatedAt: string
  createdByName?: string
  closedAt?: string
}

export type WastewaterStore = {
  cubes: WastewaterCube[]
  nextCubeNumber: number
  /** Следующий номер для internalCode (SW-000001…) */
  nextInternalCode?: number
}

export const WASTEWATER_CUBE_STATUSES: WastewaterCubeStatus[] = [
  'filling',
  'waiting',
  'drain_zone',
  'in_use',
  'used',
  'unsuitable',
]

export const WASTEWATER_ACTIVE_STATUSES: WastewaterCubeStatus[] = [
  'filling',
  'waiting',
  'drain_zone',
  'in_use',
]

export function isWastewaterCubeArchived(c: WastewaterCube): boolean {
  return c.status === 'used' || c.status === 'unsuitable'
}

/** Номер куба можно менять, пока он не в активном использовании */
export function isWastewaterCubeNumberEditable(c: WastewaterCube): boolean {
  return c.status !== 'used' && c.status !== 'in_use'
}

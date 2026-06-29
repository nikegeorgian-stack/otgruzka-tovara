import { recipeDryBatchKg, recipeTotalBatchKg } from '@/lib/formulations/calc'
import type { FormulationRecipe } from '@/lib/formulations/types'
import type {
  CellSizeInputMode,
  EadCalculationComputed,
  EadControlComputed,
  EadZoneKey,
  GravimetricTriple,
  ImpregnationQcComputed,
  IncomingControlComputed,
  IncomingMaterialKind,
  QcPassStatus,
} from './types'

const ZONES: EadZoneKey[] = ['edgeLeft', 'middle', 'edgeRight']

export function roundN(n: number, digits = 4): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

export function average(nums: (number | undefined | null)[]): number | null {
  const valid = nums.filter((n): n is number => n != null && Number.isFinite(n))
  if (!valid.length) return null
  return roundN(valid.reduce((a, b) => a + b, 0) / valid.length)
}

/**
 * Размер ячейки, мм (из «EAD Расчет.xlsx»):
 * - instrument: AVERAGE(3 замера) / 100 / 3 / 20
 * - manual: AVERAGE(3 замера) / 20
 */
export function calcCellSizeMm(
  readings: number[],
  mode: CellSizeInputMode,
): number | null {
  const avg = average(readings)
  if (avg == null) return null
  if (mode === 'instrument') return roundN(avg / 100 / 3 / 20, 3)
  return roundN(avg / 20, 3)
}

/**
 * H1 — доля испарившейся влаги при сушке: (m1−m2)/(m1−m0).
 * Органическое содержание на материале = 1 − H1 = (m2−m0)/(m1−m0).
 */
export function calcH1({ m0, m1, m2 }: GravimetricTriple): number | null {
  if (m0 == null || m1 == null || m2 == null) return null
  const denom = m1 - m0
  if (denom <= 0) return null
  // H1 — доля в диапазоне [0;1]; защита от «грязных» навесок (m2>m1 или m2<m0).
  const raw = (m1 - m2) / denom
  return roundN(Math.min(1, Math.max(0, raw)), 6)
}

export function calcOrganicFraction(h1: number | null): number | null {
  if (h1 == null) return null
  return roundN(1 - h1, 6)
}

export function computeEadCalculation(args: {
  cellSizeMode: CellSizeInputMode
  substrateCellWarp: number[]
  substrateCellWeft: number[]
  openCellWarp: number[]
  openCellWeft: number[]
  zones: Record<EadZoneKey, GravimetricTriple>
}): EadCalculationComputed {
  const zoneH1 = Object.fromEntries(
    ZONES.map((z) => [z, calcH1(args.zones[z])]),
  ) as Record<EadZoneKey, number | null>

  const h1Values = ZONES.map((z) => zoneH1[z]).filter((v): v is number => v != null)
  const avgH1 = average(h1Values)
  /** Как в Excel: среднее H1 по зонам; остаточная влажность = 1 − H̄ */
  const avgOrganicContent = avgH1 != null ? roundN(avgH1, 6) : null
  const avgResidualMoisture = avgH1 != null ? roundN(1 - avgH1, 6) : null

  return {
    substrateCellWarpMm: calcCellSizeMm(args.substrateCellWarp, args.cellSizeMode),
    substrateCellWeftMm: calcCellSizeMm(args.substrateCellWeft, args.cellSizeMode),
    openCellWarpMm: calcCellSizeMm(args.openCellWarp, args.cellSizeMode),
    openCellWeftMm: calcCellSizeMm(args.openCellWeft, args.cellSizeMode),
    zoneH1,
    avgOrganicContent,
    avgResidualMoisture,
  }
}

/** Навеска г/м²: AVERAGE(замеры) / 10 (из «EAD Контроль.xlsx») */
export function calcPickupGsm(readings: number[]): number | null {
  const avg = average(readings)
  if (avg == null) return null
  return roundN(avg / 10, 2)
}

export function computeEadControl(args: {
  targetGsm: number
  leftReadings: number[]
  rightReadings: number[]
}): EadControlComputed {
  const leftAvgGsm = calcPickupGsm(args.leftReadings)
  const rightAvgGsm = calcPickupGsm(args.rightReadings)
  const parts = [leftAvgGsm, rightAvgGsm].filter((v): v is number => v != null)
  const overallAvgGsm = parts.length ? roundN(average(parts)!, 2) : null

  let deviationGsm: number | null = null
  let deviationPct: number | null = null
  let status: QcPassStatus = 'pending'

  if (overallAvgGsm != null && args.targetGsm > 0) {
    deviationGsm = roundN(overallAvgGsm - args.targetGsm, 2)
    deviationPct = roundN((deviationGsm / args.targetGsm) * 100, 2)
    status = Math.abs(deviationPct) <= 5 ? 'pass' : 'fail'
  }

  return { leftAvgGsm, rightAvgGsm, overallAvgGsm, deviationGsm, deviationPct, status }
}

export function computeIncomingControl(args: {
  kind: IncomingMaterialKind
  ph?: number
  phMin?: number
  phMax?: number
  drySolidsPct?: number
  passportDrySolidsPct?: number
  grammageGsm?: number
  cellWarpMm?: number
  cellWeftMm?: number
  strengthWarpN?: number
  strengthWeftN?: number
}): IncomingControlComputed {
  let drySolidsDeviationPct: number | null = null
  let phInRange: boolean | null = null
  let status: QcPassStatus = 'pending'
  const parts: string[] = []

  if (args.kind === 'chemistry') {
    if (args.ph != null && args.phMin != null && args.phMax != null) {
      phInRange = args.ph >= args.phMin && args.ph <= args.phMax
      parts.push(`pH ${args.ph} (${args.phMin}–${args.phMax})`)
    } else if (args.ph != null) {
      parts.push(`pH ${args.ph}`)
    }
    if (args.drySolidsPct != null) {
      parts.push(`${args.drySolidsPct}% сух. ост.`)
      if (args.passportDrySolidsPct != null && args.passportDrySolidsPct > 0) {
        drySolidsDeviationPct = roundN(
          ((args.passportDrySolidsPct - args.drySolidsPct) / args.passportDrySolidsPct) * 100,
          2,
        )
        parts.push(`откл. ${drySolidsDeviationPct}% от паспорта`)
      }
    }
    if (phInRange === false) status = 'fail'
    else if (phInRange === true || args.drySolidsPct != null) status = 'pass'
  } else if (args.kind === 'fabric') {
    if (args.grammageGsm != null) parts.push(`${args.grammageGsm} г/м²`)
    if (args.cellWarpMm != null && args.cellWeftMm != null) {
      parts.push(`${args.cellWarpMm}×${args.cellWeftMm} мм`)
    }
    if (args.strengthWarpN != null) parts.push(`О: ${args.strengthWarpN} Н`)
    if (args.strengthWeftN != null) parts.push(`У: ${args.strengthWeftN} Н`)
    if (parts.length) status = 'pass'
  }

  return {
    drySolidsDeviationPct,
    phInRange,
    status,
    summary: parts.join('. ') || '—',
  }
}

/**
 * NV (сухой остаток пропитки), %: (m2−m0)/m1×100 — «Пропитка.xlsx»
 */
export function calcNvPct({ m0, m1, m2 }: GravimetricTriple): number | null {
  if (m0 == null || m1 == null || m2 == null || m1 <= 0) return null
  return roundN(((m2 - m0) / m1) * 100, 2)
}

export function theoreticalNvFromRecipe(recipe: FormulationRecipe): number | null {
  const dry = recipeDryBatchKg(recipe)
  const total = recipeTotalBatchKg(recipe)
  if (total <= 0) return null
  return roundN((dry / total) * 100, 2)
}

export function computeImpregnationQc(args: {
  gravimetric: GravimetricTriple
  theoreticalNvPct?: number
  nvTolerancePp: number
}): ImpregnationQcComputed {
  const nvPct = calcNvPct(args.gravimetric)
  let absDeviationPp: number | null = null
  let relDeviation: number | null = null
  let status: QcPassStatus = 'pending'

  if (nvPct != null && args.theoreticalNvPct != null) {
    absDeviationPp = roundN(Math.abs(nvPct - args.theoreticalNvPct), 2)
    if (args.theoreticalNvPct > 0) {
      relDeviation = roundN(absDeviationPp / args.theoreticalNvPct, 4)
    }
    status = absDeviationPp <= args.nvTolerancePp ? 'pass' : 'fail'
  } else if (nvPct != null) {
    status = 'pass'
  }

  return { nvPct, absDeviationPp, relDeviation, status }
}

export function qcStatusLabel(status: QcPassStatus, locale: 'ru' | 'ka'): string {
  if (status === 'pass') return locale === 'ka' ? 'შესაბამისი' : 'Соответствует'
  if (status === 'fail') return locale === 'ka' ? 'არასაკმარისი' : 'Не соответствует'
  return locale === 'ka' ? 'მოლოდინში' : 'Ожидает'
}

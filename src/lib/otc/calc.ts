import type {
  OtcAlkaliSeries,
  OtcLabTest,
  OtcLabTestComputed,
  OtcNorm,
  OtcPassStatus,
  OtcProductKind,
  OtcTestKind,
} from './types'

export function addDaysIso(dateYmd: string, days: number): string {
  const d = new Date(`${dateYmd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return dateYmd
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function residualStrengthPct(
  before: number | undefined,
  after: number | undefined,
): number | null {
  if (before == null || after == null || !(before > 0)) return null
  return Math.round((after / before) * 1000) / 10
}

export function compareToNorm(
  value: number | undefined,
  min?: number,
  max?: number,
): OtcPassStatus {
  if (value == null || !Number.isFinite(value)) return 'pending'
  if (min != null && Number.isFinite(min) && value < min) return 'fail'
  if (max != null && Number.isFinite(max) && value > max) return 'fail'
  if (min == null && max == null) return 'pending'
  return 'pass'
}

export function computeLabTestVerdict(input: {
  value?: number
  valueSecondary?: number
  normMin?: number
  normMax?: number
}): OtcLabTestComputed {
  const primary = compareToNorm(input.value, input.normMin, input.normMax)
  const secondary =
    input.valueSecondary != null
      ? compareToNorm(input.valueSecondary, input.normMin, input.normMax)
      : null

  let status: OtcPassStatus = primary
  if (secondary === 'fail' || primary === 'fail') status = 'fail'
  else if (primary === 'pending' || secondary === 'pending') status = 'pending'
  else status = 'pass'

  const parts: string[] = []
  if (input.value != null) parts.push(String(input.value))
  if (input.valueSecondary != null) parts.push(`/ ${input.valueSecondary}`)
  if (input.normMin != null || input.normMax != null) {
    const range =
      input.normMin != null && input.normMax != null
        ? `${input.normMin}…${input.normMax}`
        : input.normMin != null
          ? `≥ ${input.normMin}`
          : `≤ ${input.normMax}`
    parts.push(`(норма ${range})`)
  }

  return {
    status,
    summary:
      status === 'pass'
        ? `Соответствует${parts.length ? `: ${parts.join(' ')}` : ''}`
        : status === 'fail'
          ? `Не соответствует${parts.length ? `: ${parts.join(' ')}` : ''}`
          : 'Ожидает данных / нормы',
  }
}

export function computeAlkaliVerdict(
  series: Pick<
    OtcAlkaliSeries,
    | 'strengthBefore'
    | 'strengthAfter'
    | 'strengthBeforeSecondary'
    | 'strengthAfterSecondary'
    | 'residualMinPct'
    | 'phase'
  >,
): OtcLabTestComputed {
  const residualPrimary = residualStrengthPct(series.strengthBefore, series.strengthAfter)
  const residualSecondary = residualStrengthPct(
    series.strengthBeforeSecondary,
    series.strengthAfterSecondary,
  )

  const residuals = [residualPrimary, residualSecondary].filter(
    (v): v is number => v != null,
  )
  if (residuals.length === 0) {
    return {
      status: series.phase === 'closed' || series.phase === 'after' ? 'pending' : 'pending',
      summary:
        series.phase === 'soaking'
          ? 'В растворе — ожидает разрыва после старения'
          : series.phase === 'before'
            ? 'Зафиксирована прочность «до» — нужна закладка'
            : 'Недостаточно данных для остаточной прочности',
      residualPct: null,
    }
  }

  const worst = Math.min(...residuals)
  const minPct = series.residualMinPct
  const status: OtcPassStatus =
    Number.isFinite(minPct) && worst >= minPct ? 'pass' : Number.isFinite(minPct) ? 'fail' : 'pending'

  return {
    status,
    residualPct: worst,
    summary:
      status === 'pass'
        ? `Остаточная прочность ${worst}% ≥ ${minPct}% — соответствует`
        : status === 'fail'
          ? `Остаточная прочность ${worst}% < ${minPct}% — не соответствует`
          : `Остаточная прочность ${worst}% (норма не задана)`,
  }
}

export function findNorm(
  norms: OtcNorm[],
  productKind: OtcProductKind,
  testKind: OtcTestKind,
): OtcNorm | undefined {
  return norms.find((n) => n.active && n.productKind === productKind && n.testKind === testKind)
}

export function applyNormToLabDraft(
  norms: OtcNorm[],
  productKind: OtcProductKind,
  testKind: OtcTestKind,
): Pick<OtcLabTest, 'normId' | 'normMin' | 'normMax' | 'unit'> {
  const n = findNorm(norms, productKind, testKind)
  if (!n) return { unit: defaultUnit(testKind) }
  return {
    normId: n.id,
    normMin: n.min,
    normMax: n.max,
    unit: n.unit || defaultUnit(testKind),
  }
}

export function defaultUnit(testKind: OtcTestKind): string {
  switch (testKind) {
    case 'tensile_strength':
      return 'N'
    case 'mass_per_area':
      return 'г/м²'
    case 'mesh_size':
      return 'мм'
    case 'loss_on_ignition':
      return '%'
    case 'fabric_width':
      return 'см'
    case 'threads_per_10cm':
      return 'нит./10 см'
    case 'water_resistance_w1':
      return 'класс'
    case 'alkali_resistance':
      return '%'
    default:
      return ''
  }
}

export function alkaliOverdue(series: OtcAlkaliSeries, todayYmd: string): boolean {
  if (series.phase !== 'soaking' || !series.dueDate) return false
  return series.dueDate <= todayYmd
}

export function localTodayYmd(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

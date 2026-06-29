import { emptyPackagingRow, emptyProductionRequest } from '@/lib/production/init'
import { newId } from '@/lib/production/files'
import { summarizeRequest } from '@/lib/production/stats'
import type { ProductionLineId, ProductionRequest } from '@/lib/production/types'

export function previousDayIso(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** Сводка вчерашней проведённой выработки по линиям 1 и 2. */
export function yesterdayProductionSummary(
  requests: ProductionRequest[],
  todayDate: string,
): { lineId: ProductionLineId; factMp: number; productNames: string[] }[] {
  const y = previousDayIso(todayDate)
  const rows: { lineId: ProductionLineId; factMp: number; productNames: string[] }[] = []

  for (const lineId of ['1', '2'] as ProductionLineId[]) {
    const dayReqs = requests.filter(
      (r) =>
        r.date === y &&
        r.lineId === lineId &&
        r.status === 'posted' &&
        r.shift === 'day',
    )
    let factMp = 0
    const names = new Set<string>()
    for (const r of dayReqs) {
      const s = summarizeRequest(r)
      factMp += s.factMp - (s.byCategory.defect?.qtyMp ?? 0)
      for (const seg of r.planSegments) {
        if (seg.productName) names.add(seg.productName)
      }
    }
    if (factMp > 0) {
      rows.push({ lineId, factMp, productNames: [...names] })
    }
  }
  return rows
}

/** Черновик заявки упаковки на сегодня из вчерашней выработки. */
export function buildPackRequestFromYesterday(
  requests: ProductionRequest[],
  todayDate: string,
  brigades: string[],
): ProductionRequest | null {
  const summary = yesterdayProductionSummary(requests, todayDate)
  if (!summary.length) return null

  const existing = requests.find(
    (r) => r.date === todayDate && r.lineId === 'pack' && r.shift === 'day',
  )
  if (existing?.status === 'posted' || existing?.status === 'saved') return null

  const base =
    existing ??
    emptyProductionRequest(todayDate, 'pack', 'day', brigades[0] ?? '')

  const rolls = summary.flatMap((row) =>
    row.productNames.length
      ? row.productNames.map((name) => ({
          ...emptyPackagingRow(),
          id: newId(),
          name,
          planQty: Math.round((row.factMp / row.productNames.length) * 10) / 10,
        }))
      : [
          {
            ...emptyPackagingRow(),
            id: newId(),
            name: `Линия ${row.lineId} RATL`,
            planQty: row.factMp,
          },
        ],
  )

  const note = `Из выработки ${previousDayIso(todayDate)}`

  return {
    ...base,
    fromPlanner: true,
    plannerSourceNote: note,
    packaging: {
      thermoFilm: base.packaging?.thermoFilm ?? '',
      stretch: base.packaging?.stretch ?? '',
      rolls,
      boxes: base.packaging?.boxes?.length
        ? base.packaging.boxes
        : [emptyPackagingRow()],
      pallets: base.packaging?.pallets?.length
        ? base.packaging.pallets
        : [emptyPackagingRow()],
    },
    status: base.status === 'posted' ? 'posted' : 'draft',
    updatedAt: new Date().toISOString(),
  }
}

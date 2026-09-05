import { dayDateKey } from '@/lib/dates'
import { isTransferredOut } from '@/lib/dayTransfer'
import { factWorkedHours } from '@/lib/factExtra'
import { getFactMark } from '@/lib/stats'
import type { MonthSheet } from '@/lib/types'

/** Пропитка / линия — фиксированная доплата за каждую ночную смену. */
const LINE_BRIGADE_RE = /пропитк|impregnat|გაჟღენთ/i

export function brigadeGetsNightLineFixed(brigade: string): boolean {
  return LINE_BRIGADE_RE.test(brigade)
}

/** Сколько ночных смен (код Н с отработанными часами) в строке табеля. */
export function countFactNightShifts(
  sheet: MonthSheet,
  rowId: string,
  year: number,
  month: number,
  asOfDate?: string,
): number {
  const days = new Date(year, month, 0).getDate()
  let n = 0
  for (let d = 1; d <= days; d++) {
    const key = dayDateKey(year, month, d)
    if (asOfDate && key > asOfDate) continue
    if (isTransferredOut(sheet, rowId, key)) continue
    const code = getFactMark(sheet, rowId, key)
    if (code !== 'Н') continue
    if (factWorkedHours(sheet, rowId, key, code) > 0) n += 1
  }
  return n
}

export function computeNightLineFixedPay(opts: {
  sheet: MonthSheet
  rowId: string
  brigade: string
  year: number
  month: number
  fixedGel: number
  asOfDate?: string
}): { nights: number; amount: number } {
  if (!brigadeGetsNightLineFixed(opts.brigade) || opts.fixedGel <= 0) {
    return { nights: 0, amount: 0 }
  }
  const nights = countFactNightShifts(
    opts.sheet,
    opts.rowId,
    opts.year,
    opts.month,
    opts.asOfDate,
  )
  return { nights, amount: Math.round(nights * opts.fixedGel) }
}

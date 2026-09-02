import { isWorkCode } from '@/lib/factExtra'
import type { DayCode } from '@/lib/types'

/** Кого показывать в перекличке дня: рабочие коды, либо бригадир (даже в выходной). */
export function rollCallPersonVisible(opts: {
  showOff: boolean
  planCode: DayCode
  factCode: DayCode
  isDesignatedBrigadier: boolean
  isBrigadierDay: boolean
}): boolean {
  if (opts.showOff) return true
  if (opts.isDesignatedBrigadier || opts.isBrigadierDay) return true
  return isWorkCode(opts.planCode) || isWorkCode(opts.factCode)
}

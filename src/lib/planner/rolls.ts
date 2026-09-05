/** Сколько рулонов нужно на объём заказа (п.м ÷ п.м в рулоне, вверх). */
export function estimatedOrderedRolls(
  qtyMp: number,
  metersPerRoll?: number,
): number | undefined {
  if (!(qtyMp > 0) || !(metersPerRoll && metersPerRoll > 0)) return undefined
  return Math.ceil(qtyMp / metersPerRoll)
}

export function qtyMpFromRolls(rolls: number, metersPerRoll?: number): number | undefined {
  if (!(rolls > 0) || !(metersPerRoll && metersPerRoll > 0)) return undefined
  return rolls * metersPerRoll
}

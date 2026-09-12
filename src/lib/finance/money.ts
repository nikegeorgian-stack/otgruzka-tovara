/** GEL amounts are persisted in lari, rounded to the nearest tetri. */
export function roundMoney(value: number): number {
  return (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100
}

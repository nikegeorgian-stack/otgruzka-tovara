export function monthKeyFromDate(dateIso: string): string {
  return dateIso.slice(0, 7)
}

export function isWarehousePeriodClosed(
  closedMonths: string[] | undefined,
  dateIso: string,
): boolean {
  if (!closedMonths?.length) return false
  return closedMonths.includes(monthKeyFromDate(dateIso))
}

export function toggleClosedMonth(
  closedMonths: string[] | undefined,
  month: string,
  closed: boolean,
): string[] {
  const set = new Set(closedMonths ?? [])
  if (closed) set.add(month)
  else set.delete(month)
  return [...set].sort()
}

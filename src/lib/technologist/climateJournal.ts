import type { RoomClimateRecord } from './types'

export function groupRoomClimateByDate(
  records: RoomClimateRecord[],
): [string, RoomClimateRecord[]][] {
  const sorted = [...records].sort((a, b) => {
    const byDate = b.measuredDate.localeCompare(a.measuredDate)
    if (byDate !== 0) return byDate
    return b.measuredTime.localeCompare(a.measuredTime)
  })
  const map = new Map<string, RoomClimateRecord[]>()
  for (const row of sorted) {
    const list = map.get(row.measuredDate) ?? []
    list.push(row)
    map.set(row.measuredDate, list)
  }
  return [...map.entries()]
}

export function formatClimateDateLabel(iso: string, locale: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

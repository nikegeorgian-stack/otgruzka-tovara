export type SortDir = 'asc' | 'desc'

export type TableSortState<K extends string> = {
  key: K | null
  dir: SortDir
}

export function toggleTableSort<K extends string>(
  current: TableSortState<K>,
  key: K,
): TableSortState<K> {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  }
  return { key, dir: 'asc' }
}

export function applyTableSort<T, K extends string>(
  items: T[],
  sort: TableSortState<K>,
  compare: (a: T, b: T, key: K) => number,
): T[] {
  if (!sort.key) return items
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => mul * compare(a, b, sort.key!))
}

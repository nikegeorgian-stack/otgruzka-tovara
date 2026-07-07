import { useMemo, useState } from 'react'
import { buildAsOfIso } from '@/lib/asOf/snapshot'

export type AsOfScope = 'all' | 'output'

export type UseAsOfSnapshotOptions = {
  /** Начальная дата (YYYY-MM-DD) */
  initialDate?: string
  /** Начальное время HH:mm */
  initialTime?: string
  initialEnabled?: boolean
  initialScope?: AsOfScope
}

export function useAsOfSnapshot(opts: UseAsOfSnapshotOptions = {}) {
  const today = new Date().toISOString().slice(0, 10)
  const [enabled, setEnabled] = useState(opts.initialEnabled ?? false)
  const [date, setDate] = useState(opts.initialDate ?? today)
  const [time, setTime] = useState(opts.initialTime ?? '23:59')
  const [scope, setScope] = useState<AsOfScope>(opts.initialScope ?? 'all')

  const asOfIso = useMemo(
    () => (enabled ? buildAsOfIso(date, time) : null),
    [enabled, date, time],
  )

  return {
    enabled,
    setEnabled,
    date,
    setDate,
    time,
    setTime,
    scope,
    setScope,
    asOfIso,
  }
}

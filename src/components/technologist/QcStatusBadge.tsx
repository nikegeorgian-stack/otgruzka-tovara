import type { QcPassStatus } from '@/lib/technologist/types'

type Props = { status: QcPassStatus; label?: string }

export function QcStatusBadge({ status, label }: Props) {
  const cls =
    status === 'pass'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'fail'
        ? 'bg-red-100 text-red-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={`inline-flex rounded-sm px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label ?? status}
    </span>
  )
}

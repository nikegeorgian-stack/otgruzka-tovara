import { useI18n } from '@/context/I18nContext'
import { monthProblems } from '@/lib/problems'
import type { AppStore, MonthSheet } from '@/lib/types'

type Props = { store: AppStore; sheet: MonthSheet }

export function MonthProblemsBar({ store, sheet }: Props) {
  const { tf } = useI18n()
  const problems = monthProblems(store, sheet)
  if (!problems.length) return null

  return (
    <div className="flex flex-wrap gap-2 rounded-sm border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs">
      {problems.map((p) => (
        <span
          key={p.id}
          className={`rounded-sm px-2.5 py-0.5 font-medium ${
            p.severity === 'warn'
              ? 'bg-amber-200 text-amber-950'
              : 'bg-sky-100 text-sky-900'
          }`}
        >
          {tf(p.messageKey, { count: p.count ?? 0 })}
        </span>
      ))}
    </div>
  )
}

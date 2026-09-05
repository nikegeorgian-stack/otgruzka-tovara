import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import {
  collectDocumentMonitorRows,
  type DocMonitorCategory,
  type DocMonitorRow,
} from '@/lib/hr/documentMonitor'
import type { Employee } from '@/lib/types'

type Props = {
  open: boolean
  onClose: () => void
  employees: Employee[]
  onOpenEmployee: (id: string) => void
  /** Только иностранцы (для вкладки инспектора) */
  foreignOnly?: boolean
  /** Стартовая категория: договоры / архив / разрешения */
  initialCategory?: DocMonitorCategory
}

export function HrDocumentsMonitorDialog({
  open,
  onClose,
  employees,
  onOpenEmployee,
  foreignOnly = false,
  initialCategory = 'all',
}: Props) {
  const { t } = useI18n()
  const [filter, setFilter] = useState<'all' | 'overdue' | 'expiring'>('all')
  const [category, setCategory] = useState<DocMonitorCategory>(initialCategory)
  const [showOk, setShowOk] = useState(false)

  const rows = useMemo(() => {
    const all = collectDocumentMonitorRows(employees, {
      onlyProblems: !showOk,
      foreignOnly,
      category,
    })
    if (filter === 'all') return all
    return all.filter((r) => r.severity === filter)
  }, [employees, filter, showOk, foreignOnly, category])

  const overdue = rows.filter((r) => r.severity === 'overdue').length
  const expiring = rows.filter((r) => r.severity === 'expiring').length

  function severityClass(r: DocMonitorRow) {
    if (r.severity === 'overdue') return 'border-red-200 bg-red-50/80'
    if (r.severity === 'expiring') return 'border-amber-200 bg-amber-50/70'
    return 'border-stone-200 bg-white'
  }

  function sourceBadge(r: DocMonitorRow) {
    if (r.source === 'contract') return t('hr.docMonitor.source.contract')
    if (r.source === 'document') return t('hr.docMonitor.source.document')
    return t('hr.docMonitor.source.permit')
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t('hr.docMonitor.title')}
      subtitle={t('hr.docMonitor.subtitle')}
      size="lg"
      footer={
        <button
          type="button"
          className="rounded-md border border-stone-200 px-4 py-2 text-sm"
          onClick={onClose}
        >
          {t('planner.cancel')}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          ['all', 'hr.docMonitor.cat.all'],
          ['contracts', 'hr.docMonitor.cat.contracts'],
          ['documents', 'hr.docMonitor.cat.documents'],
          ['permits', 'hr.docMonitor.cat.permits'],
        ] as const).map(([id, key]) => (
          <button
            key={id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              category === id ? 'bg-teal-800 text-white' : 'bg-teal-50 text-teal-900'
            }`}
            onClick={() => setCategory(id)}
          >
            {t(key)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            filter === 'all' ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-700'
          }`}
          onClick={() => setFilter('all')}
        >
          {t('hr.docMonitor.filterAll')} ({rows.length})
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            filter === 'overdue' ? 'bg-red-700 text-white' : 'bg-red-50 text-red-800'
          }`}
          onClick={() => setFilter('overdue')}
        >
          {t('hr.docMonitor.filterOverdue')} ({overdue})
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            filter === 'expiring' ? 'bg-amber-700 text-white' : 'bg-amber-50 text-amber-900'
          }`}
          onClick={() => setFilter('expiring')}
        >
          {t('hr.docMonitor.filterExpiring')} ({expiring})
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={showOk}
            onChange={(e) => setShowOk(e.target.checked)}
          />
          {t('hr.docMonitor.showOk')}
        </label>
      </div>

      <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
        {rows.length === 0 && (
          <li className="rounded-md border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-500">
            {t('hr.docMonitor.empty')}
          </li>
        )}
        {rows.map((r) => (
          <li
            key={r.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2.5 ${severityClass(r)}`}
          >
            <div className="min-w-0">
              <button
                type="button"
                className="text-left text-sm font-semibold text-ink hover:text-teal-800 hover:underline"
                onClick={() => {
                  onOpenEmployee(r.employeeId)
                  onClose()
                }}
              >
                {r.employeeName}
              </button>
              <p className="text-xs text-stone-600">
                <span className="mr-1 rounded bg-stone-200/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-stone-700">
                  {sourceBadge(r)}
                </span>
                {r.docType}
                {r.number ? ` · № ${r.number}` : ''}
                {r.title !== r.docType ? ` · ${r.title}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-stone-500">
                {t('hr.foreign.until')}: {r.expiresAt}
                {r.days !== null && (
                  <>
                    {' '}
                    (
                    {r.severity === 'overdue'
                      ? `−${Math.abs(r.days)}`
                      : r.days}{' '}
                    {t('hrInspector.days')})
                  </>
                )}
              </p>
            </div>
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                r.severity === 'overdue'
                  ? 'bg-red-700 text-white'
                  : r.severity === 'expiring'
                    ? 'bg-amber-600 text-white'
                    : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {r.severity === 'overdue'
                ? t('hr.docMonitor.badgeOverdue')
                : r.severity === 'expiring'
                  ? t('hr.docMonitor.badgeExpiring')
                  : t('hr.docMonitor.badgeOk')}
            </span>
          </li>
        ))}
      </ul>
    </AppDialog>
  )
}

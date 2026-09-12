import { useMemo } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import type { TimesheetEntryDocument } from '@/lib/timesheetEntries/types'

type Props = {
  doc: TimesheetEntryDocument
  employeeNameById?: Map<string, string>
  canVoid?: boolean
  onVoid?: (documentId: string) => boolean
  onClose: () => void
}

export function TimesheetEntryDocModal({
  doc,
  employeeNameById,
  canVoid,
  onVoid,
  onClose,
}: Props) {
  const { t } = useI18n()
  const rows = useMemo(() => doc.applied ?? doc.changes, [doc])

  return (
    <AppDialog
      open
      title={`${doc.number} · ${t('timesheetEntry.docType')}`}
      onClose={onClose}
      ephemeral
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('planner.cancel')}
          </Button>
          {canVoid && doc.status === 'posted' && onVoid ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (onVoid(doc.id)) onClose()
              }}
            >
              {t('timesheetEntry.void')}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-3 px-4 py-3 text-sm sm:px-5">
        <p className="text-stone-600">
          {t('timesheetEntry.month')}: <span className="font-medium text-ink">{doc.month}</span>
          {' · '}
          {t(`timesheetEntry.status.${doc.status}`)}
        </p>
        <p className="text-xs text-stone-500">
          {doc.postedByName ?? doc.createdByName ?? '—'}
          {doc.postedAt ? ` · ${doc.postedAt.slice(0, 16).replace('T', ' ')}` : ''}
        </p>
        {doc.skipped ? (
          <p className="text-xs text-amber-700">
            {t('timesheetEntry.skipped')}: {doc.skipped}
          </p>
        ) : null}
        {doc.voidDetail ? (
          <p className="text-xs text-stone-500">{doc.voidDetail}</p>
        ) : null}
        <div className="max-h-72 overflow-auto rounded-sm border border-grid">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-[10px] uppercase text-stone-500">
              <tr>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.date')}</th>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.person')}</th>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.mode')}</th>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.brigade')}</th>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.before')}</th>
                <th className="px-2 py-1.5">{t('timesheetEntry.col.after')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-stone-400">
                    —
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={`${r.rowId}-${r.dateKey}-${r.mode}-${i}`}
                    className="border-t border-grid/60"
                  >
                    <td className="px-2 py-1.5 tabular-nums">{r.dateKey.slice(8)}</td>
                    <td className="px-2 py-1.5">
                      {(r.employeeId && employeeNameById?.get(r.employeeId)) || '—'}
                    </td>
                    <td className="px-2 py-1.5">{r.mode === 'plan' ? 'П' : 'Ф'}</td>
                    <td className="px-2 py-1.5">{r.brigade ?? '—'}</td>
                    <td className="px-2 py-1.5 font-mono">{r.before || '·'}</td>
                    <td className="px-2 py-1.5 font-mono">{r.after || '·'}{r.confirmFact && r.before === r.after && <span className="ml-2 text-xs font-sans">{t(doc.status === 'void' ? 'month.draftReview.confirmationVoided' : 'month.draftReview.confirmFact')}</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppDialog>
  )
}

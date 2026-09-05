import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import type { Locale } from '@/i18n/types'
import type { TimesheetDraftChange } from '@/lib/timesheetDraft'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  changes: TimesheetDraftChange[]
  onSave: () => void
  onDiscard: () => void
  onClose: () => void
}

function rowLabel(
  store: AppStore,
  month: string,
  rowId: string,
  locale: Locale,
): string {
  const sheet = store.months[month]
  const row = sheet?.rows.find((r) => r.id === rowId)
  if (!row) return rowId
  if (row.employeeId) {
    const emp = store.employees.find((e) => e.id === row.employeeId)
    if (emp) return employeeName(emp, locale)
  }
  return row.brigade ? `${row.brigade} · ${rowId.slice(0, 6)}` : rowId
}

export function TimesheetDraftReviewModal({
  store,
  month,
  changes,
  onSave,
  onDiscard,
  onClose,
}: Props) {
  const { t, tf, locale } = useI18n()

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('month.draftReview.title')}
      subtitle={tf('month.draftReview.subtitle', { count: changes.length, month })}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('month.draftReview.back')}
          </Button>
          <Button variant="danger" size="sm" onClick={onDiscard}>
            {t('month.draftReview.discard')}
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} data-coach="month:draftSave">
            {t('month.draftReview.save')}
          </Button>
        </div>
      }
    >
      <div className="max-h-[min(60vh,28rem)] overflow-auto px-5 py-3">
        {changes.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">{t('month.draftReview.empty')}</p>
        ) : (
          <table className="fc-table w-full text-sm">
            <thead>
              <tr>
                <th>{t('month.draftReview.col.person')}</th>
                <th>{t('month.draftReview.col.date')}</th>
                <th>{t('month.draftReview.col.layer')}</th>
                <th>{t('month.draftReview.col.change')}</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((ch) => (
                <tr key={`${ch.mode}-${ch.rowId}-${ch.dateKey}`}>
                  <td className="max-w-[10rem] truncate">{rowLabel(store, month, ch.rowId, locale)}</td>
                  <td className="whitespace-nowrap tabular-nums">{ch.dateKey.slice(5)}</td>
                  <td>
                    {ch.mode === 'plan'
                      ? t('month.deck.layerPlan')
                      : t('month.deck.layerFact')}
                  </td>
                  <td className="font-mono text-xs">
                    {(ch.before || '·') + ' → ' + (ch.after || '·')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-stone-500">{t('month.draftReview.hint')}</p>
      </div>
    </AppDialog>
  )
}

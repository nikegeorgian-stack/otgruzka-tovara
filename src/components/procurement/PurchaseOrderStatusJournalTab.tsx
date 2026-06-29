import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge'
import { useI18n } from '@/context/I18nContext'
import type { PurchaseOrderStatusChange } from '@/lib/procurement/types'

type Props = {
  entries: PurchaseOrderStatusChange[]
  canRefreshFromCarrier?: boolean
  refreshing?: boolean
  onRefreshFromCarrier?: () => void
}

export function PurchaseOrderStatusJournalTab({
  entries,
  canRefreshFromCarrier,
  refreshing,
  onRefreshFromCarrier,
}: Props) {
  const { t, locale } = useI18n()

  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="space-y-3">
      {canRefreshFromCarrier && onRefreshFromCarrier && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={refreshing}
            onClick={onRefreshFromCarrier}
          >
            {refreshing
              ? t('procurement.tracking.syncing')
              : t('procurement.tracking.refreshJournal')}
          </button>
          <span className="text-xs text-stone-500">{t('procurement.tracking.refreshJournalHint')}</span>
        </div>
      )}

      {!sorted.length ? (
        <p className="text-sm text-stone-400">{t('procurement.statusJournal.empty')}</p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-grid bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5">{t('procurement.statusJournal.colAt')}</th>
                <th className="px-3 py-2.5">{t('procurement.statusJournal.colFrom')}</th>
                <th className="px-3 py-2.5">{t('procurement.statusJournal.colTo')}</th>
                <th className="px-3 py-2.5">{t('procurement.statusJournal.colNote')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr key={entry.id} className="border-t border-grid/60">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-stone-600">
                    {new Date(entry.at).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2.5">
                    {entry.fromStatus ? (
                      <OrderStatusBadge status={entry.fromStatus} />
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <OrderStatusBadge status={entry.toStatus} />
                  </td>
                  <td className="max-w-[16rem] px-3 py-2.5 text-xs text-stone-600">
                    {entry.note ?? (
                      <span className="text-stone-300">
                        {!entry.fromStatus ? t('procurement.statusJournal.initial') : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

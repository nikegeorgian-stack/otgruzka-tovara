import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import {
  itemRenameRequestJournal,
  openItemRenameRequests,
} from '@/lib/warehouse/itemRenameRequests'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Tab = 'open' | 'journal'

type Props = {
  warehouse: WarehouseStore
  keeperId?: string
  keeperName?: string
  onResolve: (
    requestId: string,
    status: 'accepted' | 'rejected',
    opts?: { keeperNote?: string; keeperId?: string; keeperName?: string },
  ) => void
}

export function WarehouseItemRenameRequestsPanel({
  warehouse,
  keeperId,
  keeperName,
  onResolve,
}: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('open')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')

  const open = useMemo(() => openItemRenameRequests(warehouse), [warehouse])
  const journal = useMemo(() => itemRenameRequestJournal(warehouse), [warehouse])

  if (open.length === 0 && journal.length === 0) return null

  const tabs = [
    { id: 'open' as const, label: t('warehouse.renameRequests.tabOpen'), count: open.length },
    { id: 'journal' as const, label: t('warehouse.renameRequests.tabJournal'), count: journal.length },
  ]

  return (
    <Card
      title={t('warehouse.renameRequests.title')}
      description={t('warehouse.renameRequests.hint')}
      className="border-sky-200 bg-sky-50/30"
    >
      <TabBar tabs={tabs} value={tab} onChange={setTab} className="mb-4" />

      {tab === 'open' && (
        <ul className="space-y-3">
          {open.length === 0 ? (
            <p className="py-4 text-center text-sm text-stone-500">
              {t('warehouse.renameRequests.emptyOpen')}
            </p>
          ) : (
            open.map((req) => (
              <li key={req.id} className="rounded-sm border border-sky-200 bg-white p-4">
                <p className="text-sm text-stone-500">
                  {req.requestedByName} · {req.createdAt.slice(0, 10)}
                </p>
                <p className="mt-1 text-sm">
                  <span className="text-stone-400 line-through">{req.previousName}</span>
                  <span className="mx-2 text-stone-300">→</span>
                  <span className="font-semibold text-ink">{req.proposedName}</span>
                </p>
                {(req.proposedUnit || req.proposedSku) && (
                  <p className="mt-1 text-xs text-stone-500">
                    {[req.proposedUnit, req.proposedSku ? `SKU ${req.proposedSku}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                {req.note && <p className="mt-2 text-sm text-stone-600">{req.note}</p>}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onResolve(req.id, 'accepted', { keeperId, keeperName })}
                  >
                    {t('warehouse.renameRequests.accept')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRejectId(req.id)}>
                    {t('warehouse.renameRequests.reject')}
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      {tab === 'journal' && (
        <div className="overflow-x-auto">
          <table className="fc-table w-full text-sm">
            <thead>
              <tr>
                <th>{t('warehouse.renameRequests.colDate')}</th>
                <th>{t('warehouse.renameRequests.colChange')}</th>
                <th>{t('warehouse.renameRequests.colAuthor')}</th>
                <th>{t('warehouse.renameRequests.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {journal.map((req) => (
                <tr key={req.id}>
                  <td className="whitespace-nowrap text-stone-500">
                    {(req.resolvedAt ?? req.createdAt).slice(0, 10)}
                  </td>
                  <td>
                    <span className="text-stone-400">{req.previousName}</span>
                    <span className="mx-1">→</span>
                    <span className="font-medium">{req.proposedName}</span>
                  </td>
                  <td className="text-xs">
                    {req.requestedByName}
                    {req.resolvedByName ? ` / ${req.resolvedByName}` : ''}
                  </td>
                  <td>
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
                        req.status === 'accepted'
                          ? 'bg-teal-100 text-teal-900'
                          : req.status === 'rejected'
                            ? 'bg-stone-200 text-stone-700'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {t(`warehouse.renameRequests.status.${req.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-sm bg-white p-5 shadow-sm">
            <h3 className="font-bold text-ink">{t('warehouse.renameRequests.rejectTitle')}</h3>
            <textarea
              className="mt-3 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              rows={3}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder={t('warehouse.renameRequests.rejectPh')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRejectId(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onResolve(rejectId, 'rejected', {
                    keeperNote: rejectNote.trim() || undefined,
                    keeperId,
                    keeperName,
                  })
                  setRejectId(null)
                  setRejectNote('')
                }}
              >
                {t('warehouse.renameRequests.reject')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

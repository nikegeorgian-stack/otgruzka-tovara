import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import {
  buildWarehouseDocsPackage,
  downloadExportPackage,
} from '@/lib/export/balancePackage'
import { buildRsQueues, type RsQueueKind } from '@/lib/warehouse/rsQueue'
import type { AppStore } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  store: AppStore
  warehouse: WarehouseStore
  onMarkExported?: (documentIds: string[]) => void
  onOpenDocument?: (documentId: string) => void
}

const KINDS: RsQueueKind[] = [
  'invoice_unposted',
  'receipt_no_rs',
  'not_exported',
  'production_docs',
  'loading_docs',
]

export function WarehouseRsQueuePanel({
  store,
  warehouse,
  onMarkExported,
  onOpenDocument,
}: Props) {
  const { t, locale } = useI18n()
  const [filter, setFilter] = useState<RsQueueKind | 'all'>('all')
  const rows = useMemo(() => buildRsQueues(warehouse), [warehouse])
  const visible = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)

  function exportProduction() {
    const pkg = buildWarehouseDocsPackage(store, locale, { kind: 'production_docs' })
    downloadExportPackage(pkg, 'production')
    const ids = pkg.documents.map((d) => d.id)
    if (ids.length) onMarkExported?.(ids)
  }

  function exportLoading() {
    const pkg = buildWarehouseDocsPackage(store, locale, { kind: 'loading_docs' })
    downloadExportPackage(pkg, 'loading')
    const ids = pkg.documents.map((d) => d.id)
    if (ids.length) onMarkExported?.(ids)
  }

  function exportSelectedNotExported() {
    const ids = rows
      .filter((r) => r.kind === 'not_exported' && r.document)
      .map((r) => r.document!.id)
    if (!ids.length) return
    const pkg = buildWarehouseDocsPackage(store, locale, {
      kind: 'warehouse_docs',
      documentIds: ids,
    })
    downloadExportPackage(pkg, 'warehouse_pending')
    onMarkExported?.(ids)
  }

  return (
    <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            {t('warehouse.rsQueue.title')}
          </h3>
          <p className="mt-1 text-sm text-stone-500">{t('warehouse.rsQueue.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={exportProduction}>
            {t('warehouse.rsQueue.exportProduction')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={exportLoading}>
            {t('warehouse.rsQueue.exportLoading')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={exportSelectedNotExported}>
            {t('warehouse.rsQueue.exportPending')}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        <button
          type="button"
          className={`rounded-sm px-2 py-1 text-xs font-medium ${
            filter === 'all' ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600'
          }`}
          onClick={() => setFilter('all')}
        >
          {t('warehouse.rsQueue.filterAll')} ({rows.length})
        </button>
        {KINDS.map((k) => {
          const n = rows.filter((r) => r.kind === k).length
          return (
            <button
              key={k}
              type="button"
              className={`rounded-sm px-2 py-1 text-xs font-medium ${
                filter === k ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600'
              }`}
              onClick={() => setFilter(k)}
            >
              {t(`warehouse.rsQueue.kind.${k}`)} ({n})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">{t('warehouse.rsQueue.empty')}</p>
      ) : (
        <ul className="mt-3 max-h-72 divide-y divide-stone-100 overflow-y-auto text-sm">
          {visible.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium text-ink">{r.label}</div>
                <div className="text-xs text-stone-500">
                  {t(`warehouse.rsQueue.kind.${r.kind}`)}
                  {r.date ? ` · ${r.date}` : ''}
                </div>
              </div>
              {r.document && onOpenDocument ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenDocument(r.document!.id)}
                >
                  {t('warehouse.rsQueue.open')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

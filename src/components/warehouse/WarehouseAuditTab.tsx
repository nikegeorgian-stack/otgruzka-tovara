import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { exportWarehouseAuditExcel } from '@/lib/warehouse/importExport'
import type { WarehouseStore } from '@/lib/warehouse/types'

export function WarehouseAuditTab({ warehouse }: { warehouse: WarehouseStore }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)

  const actionLabel = useMemo<Record<string, string>>(
    () => ({
      item_change: t('warehouse.audit.itemChange'),
      item_archive: t('warehouse.audit.itemArchive'),
      movement_add: t('warehouse.audit.movementAdd'),
      movement_delete: t('warehouse.audit.movementDelete'),
      document_post: t('warehouse.audit.documentPost'),
      document_cancel: t('warehouse.audit.documentCancel'),
      inventory: t('warehouse.audit.inventory'),
      daily_issue: t('warehouse.audit.dailyIssue'),
      batch_mix: t('warehouse.audit.batchMix'),
      item_request: t('warehouse.audit.itemRequest'),
      item_rename: t('warehouse.audit.itemRename'),
      import: t('warehouse.audit.import'),
    }),
    [t],
  )
  const labelFor = (action: string) => actionLabel[action] ?? action

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...warehouse.auditLog]
      .reverse()
      .filter((e) => {
        const day = e.at.slice(0, 10)
        if (from && day < from) return false
        if (to && day > to) return false
        if (q) {
          const hay = `${labelFor(e.action)} ${e.detail}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        return true
      })
      .slice(0, 500)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouse.auditLog, query, from, to, actionLabel])

  async function handleExport() {
    setBusy(true)
    try {
      await exportWarehouseAuditExcel(
        filtered.map((e) => ({ at: e.at, action: e.action, detail: e.detail })),
        labelFor,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder={t('warehouse.audit.search')}
          className="min-w-[14rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          type="date"
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-stone-400">—</span>
        <input
          type="date"
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          className="btn-add-outline px-3 py-2 text-sm disabled:opacity-50"
          disabled={!filtered.length || busy}
          onClick={() => void handleExport()}
        >
          {busy ? '…' : t('warehouse.audit.export')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-sm border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center text-sm text-stone-500">
          {warehouse.auditLog.length ? t('warehouse.audit.nothing') : t('warehouse.audit.empty')}
        </p>
      ) : (
        <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
          <div className="max-h-[34rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-grid bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-4 py-3 w-36">{t('warehouse.audit.when')}</th>
                  <th className="px-3 py-3 w-32">{t('warehouse.audit.action')}</th>
                  <th className="px-3 py-3">{t('warehouse.audit.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b border-grid/60">
                    <td className="px-4 py-2 whitespace-nowrap text-stone-500">
                      {e.at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold uppercase text-teal-800">
                      {labelFor(e.action)}
                    </td>
                    <td className="px-3 py-2">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { ProductionKeeperModal } from '@/components/production/ProductionKeeperModal'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { buildPackRequestFromYesterday } from '@/lib/production/packFromYesterday'
import { summarizeRequest } from '@/lib/production/stats'
import {
  PRODUCTION_LINES,
  type ProductionRequest,
} from '@/lib/production/types'
import type { Employee } from '@/lib/types'

type Props = {
  requests: ProductionRequest[]
  employees: Employee[]
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  keeperName?: string
  onSaveRequest: (r: ProductionRequest) => void
  onPostRequest: (id: string, postedBy?: string) => {
    ok: boolean
    messageKey?: string
  }
}

export function ProductionRequestsPanel({
  requests,
  employees,
  brigades,
  brigadeNamesKa,
  keeperName,
  onSaveRequest,
  onPostRequest,
}: Props) {
  const { t, locale } = useI18n()
  const [editRequest, setEditRequest] = useState<ProductionRequest | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  const queue = useMemo(
    () =>
      [...requests]
        .filter((r) => r.status === 'saved')
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            a.lineId.localeCompare(b.lineId),
        ),
    [requests],
  )

  const lineTitle = (id: ProductionRequest['lineId']) => {
    const line = PRODUCTION_LINES.find((l) => l.id === id)
    return line ? (locale === 'ka' ? line.labelKa : line.labelRu) : id
  }

  function handlePost(req: ProductionRequest) {
    onSaveRequest(req)
    const res = onPostRequest(req.id, keeperName)
    if (res.ok) {
      setNotice(t('production.post.warehouseOk'))
      setEditRequest(null)
    } else {
      setNotice(t(res.messageKey ?? 'production.post.unknown'))
    }
  }

  function createPackFromYesterday() {
    const built = buildPackRequestFromYesterday(requests, today, brigades)
    if (!built) {
      setNotice(t('production.packYesterdayEmpty'))
      return
    }
    onSaveRequest({ ...built, status: 'saved', savedAt: new Date().toISOString() })
    setNotice(t('production.packYesterdayCreated'))
  }

  return (
    <section className="mb-4 rounded-sm border border-teal-200 bg-teal-50/50 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-teal-950">{t('warehouse.production.title')}</h3>
          <p className="mt-1 text-xs text-teal-800">{t('warehouse.production.hint')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={createPackFromYesterday}>
          {t('production.packYesterdayBtn')}
        </Button>
      </div>

      {notice && (
        <p className="mt-3 rounded-sm border border-teal-200 bg-white px-3 py-2 text-sm text-teal-900">
          {notice}
        </p>
      )}

      {queue.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">{t('warehouse.production.empty')}</p>
      ) : (
        <div className="mt-4 overflow-auto rounded-sm border border-teal-100 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2 text-left">{t('production.date')}</th>
                <th className="px-3 py-2 text-left">{t('production.line')}</th>
                <th className="px-3 py-2 text-left">{t('production.brigade')}</th>
                <th className="px-3 py-2 text-right">{t('production.planLabel')}</th>
                <th className="px-3 py-2 text-right">{t('production.factLabel')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => {
                const s = summarizeRequest(r)
                return (
                  <tr key={r.id} className="border-t border-grid">
                    <td className="px-3 py-2 font-mono text-xs">{r.date}</td>
                    <td className="px-3 py-2">{lineTitle(r.lineId)}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.brigadeName
                        ? brigadeLabel(r.brigadeName, brigadeNamesKa, locale)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {s.planMp}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {s.factMp}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-xs font-semibold text-teal-700 hover:underline"
                        onClick={() => setEditRequest(r)}
                      >
                        {t('warehouse.production.fill')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editRequest && (
        <ProductionKeeperModal
          request={editRequest}
          employees={employees}
          brigadeNamesKa={brigadeNamesKa}
          onClose={() => setEditRequest(null)}
          onSave={(req) => {
            onSaveRequest(req)
            setEditRequest(req)
            setNotice(t('production.savedDraft'))
          }}
          onPost={handlePost}
        />
      )}
    </section>
  )
}

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { useI18n } from '@/context/I18nContext'
import { openItemRequests } from '@/lib/warehouse/itemRequests'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  keeperName?: string
  onResolveRequest: (
    requestId: string,
    status: 'fulfilled' | 'rejected',
    opts?: { fulfilledItemId?: string; keeperNote?: string; keeperName?: string },
  ) => void
}

export function WarehouseItemRequestsPanel({
  warehouse,
  keeperName,
  onResolveRequest,
}: Props) {
  const { t } = useI18n()
  const open = useMemo(() => openItemRequests(warehouse), [warehouse])

  if (open.length === 0) return null

  return (
    <Card
      title={t('warehouse.itemRequests.title')}
      description={t('warehouse.itemRequests.hint')}
      className="border-amber-200 bg-amber-50/40"
    >
      <ul className="space-y-3">
        {open.map((req) => (
          <RequestRow
            key={req.id}
            warehouse={warehouse}
            request={req}
            keeperName={keeperName}
            onResolve={onResolveRequest}
          />
        ))}
      </ul>
    </Card>
  )
}

function RequestRow({
  warehouse,
  request,
  keeperName,
  onResolve,
}: {
  warehouse: WarehouseStore
  request: NonNullable<WarehouseStore['itemRequests']>[number]
  keeperName?: string
  onResolve: Props['onResolveRequest']
}) {
  const { t } = useI18n()
  const [linkId, setLinkId] = useState('')

  const chemistryItems = useMemo(
    () =>
      warehouse.items
        .filter((i) => i.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [warehouse.items],
  )

  return (
    <li className="rounded-sm border border-amber-200 bg-white p-4">
      <div>
        <p className="font-semibold text-ink">{request.name}</p>
        <p className="mt-1 text-xs text-stone-500">
          {request.unit}
          {request.recipeCode ? ` · ${request.recipeCode}` : ''}
          {' · '}
          {request.requestedByName}
          {' · '}
          {request.createdAt.slice(0, 10)}
        </p>
        {request.note && <p className="mt-1 text-sm text-stone-600">{request.note}</p>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <FormField label={t('warehouse.itemRequests.linkExisting')} className="min-w-[200px] flex-1">
          <select className="fc-input" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">—</option>
            {chemistryItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.internalCode})
              </option>
            ))}
          </select>
        </FormField>
        <Button
          variant="primary"
          size="sm"
          disabled={!linkId}
          onClick={() =>
            onResolve(request.id, 'fulfilled', {
              fulfilledItemId: linkId,
              keeperName,
            })
          }
        >
          {t('warehouse.itemRequests.fulfill')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onResolve(request.id, 'rejected', { keeperName })}
        >
          {t('warehouse.itemRequests.reject')}
        </Button>
      </div>
    </li>
  )
}

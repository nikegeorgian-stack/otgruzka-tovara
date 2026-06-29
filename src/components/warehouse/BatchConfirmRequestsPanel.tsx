import { Fragment, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import type { PostBatchMixResult } from '@/lib/formulations/batch'
import type { FormulationBatchRun } from '@/lib/formulations/types'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  runs: FormulationBatchRun[]
  keeperId?: string
  keeperName?: string
  allowNegativeStock?: boolean
  onConfirm: (
    runId: string,
    keeper?: { id?: string; name?: string },
    options?: { allowNegativeStock?: boolean },
  ) => PostBatchMixResult
  onReject: (
    runId: string,
    keeper?: { id?: string; name?: string },
    reason?: string,
  ) => PostBatchMixResult
}

export function BatchConfirmRequestsPanel({
  warehouse,
  runs,
  keeperId,
  keeperName,
  allowNegativeStock = false,
  onConfirm,
  onReject,
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const pending = useMemo(
    () =>
      [...runs]
        .filter((r) => (r.status ?? 'confirmed') === 'pending')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [runs],
  )

  const itemName = (id: string) =>
    warehouse.items.find((i) => i.id === id)?.name ?? id

  if (pending.length === 0) return null

  function summary(run: FormulationBatchRun): string {
    const issue = run.lines
      .map((l) => `${l.name}: ${formatQty(l.consumeKg)} кг`)
      .join('\n')
    const receipt = `${itemName(run.outputWarehouseItemId)}: ${formatQty(run.outputKg)} кг`
    return `${t('warehouse.batchConfirm.issueTitle')}:\n${issue}\n\n${t('warehouse.batchConfirm.receiptTitle')}:\n${receipt}`
  }

  async function handleConfirm(run: FormulationBatchRun) {
    const keeperBalances = computeAllBalances(warehouse, run.warehouseId)
    const shortages = run.lines.filter(
      (l) => (keeperBalances.get(l.warehouseItemId)?.available ?? 0) < l.consumeKg - 1e-6,
    )
    let message = `${t('warehouse.batchConfirm.confirmAsk')}\n\n${summary(run)}`
    if (shortages.length > 0 && allowNegativeStock) {
      message += `\n\n⚠ ${t('warehouse.batchConfirm.shortageWarn')}`
    }
    const ok = await confirm({ message, danger: shortages.length > 0 })
    if (!ok) return
    const res = onConfirm(run.id, { id: keeperId, name: keeperName }, { allowNegativeStock })
    setNotice(
      res.ok
        ? t('warehouse.batchConfirm.confirmedOk')
        : `${t('warehouse.batchConfirm.error')}: ${res.error}`,
    )
  }

  async function handleReject(run: FormulationBatchRun) {
    const ok = await confirm({
      message: `${t('warehouse.batchConfirm.rejectAsk')} ${run.documentNumber}?`,
      danger: true,
    })
    if (!ok) return
    const res = onReject(run.id, { id: keeperId, name: keeperName })
    setNotice(
      res.ok
        ? t('warehouse.batchConfirm.rejectedOk')
        : `${t('warehouse.batchConfirm.error')}: ${res.error}`,
    )
  }

  return (
    <section className="rounded-sm border border-amber-300 bg-amber-50/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-amber-950">
            {t('warehouse.batchConfirm.title')}
            <span className="ml-2 rounded-sm bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
              {pending.length}
            </span>
          </h3>
          <p className="mt-1 text-xs text-amber-800">{t('warehouse.batchConfirm.hint')}</p>
        </div>
      </div>

      {notice && (
        <p className="mt-3 rounded-sm border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
          {notice}
        </p>
      )}

      <div className="mt-4 overflow-auto rounded-sm border border-amber-100 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2 text-left">{t('warehouse.batchConfirm.doc')}</th>
              <th className="px-3 py-2 text-left">{t('warehouse.batchConfirm.code')}</th>
              <th className="px-3 py-2 text-left">{t('warehouse.batchConfirm.recipe')}</th>
              <th className="px-3 py-2 text-right">{t('warehouse.batchConfirm.volume')}</th>
              <th className="px-3 py-2 text-left">{t('warehouse.batchConfirm.mixedBy')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {pending.map((run) => (
              <Fragment key={run.id}>
                <tr className="border-t border-grid align-top">
                  <td className="px-3 py-2 font-mono text-xs">{run.documentNumber}</td>
                  <td className="px-3 py-2 font-mono text-xs">{run.internalCode ?? '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium text-amber-900 hover:underline"
                      onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                    >
                      {run.recipeCode} · {run.recipeName}
                    </button>
                    <div className="text-xs text-stone-500">{run.mixedAt}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{run.targetVolumeL} л</td>
                  <td className="px-3 py-2 text-xs">{run.mixedByName}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="primary" onClick={() => handleConfirm(run)}>
                        {t('warehouse.batchConfirm.confirm')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleReject(run)}>
                        {t('warehouse.batchConfirm.reject')}
                      </Button>
                    </div>
                  </td>
                </tr>
                {expanded === run.id && (
                  <tr className="border-t border-grid bg-amber-50/40">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-red-700">
                            {t('warehouse.batchConfirm.issueTitle')}
                          </div>
                          <ul className="space-y-0.5 text-xs">
                            {run.lines.map((l) => (
                              <li key={l.componentId} className="flex justify-between gap-3">
                                <span>{l.name}</span>
                                <span className="font-mono">{formatQty(l.consumeKg)} кг</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-semibold uppercase text-teal-700">
                            {t('warehouse.batchConfirm.receiptTitle')}
                          </div>
                          <div className="flex justify-between gap-3 text-xs">
                            <span>{itemName(run.outputWarehouseItemId)}</span>
                            <span className="font-mono">{formatQty(run.outputKg)} кг</span>
                          </div>
                          {run.colorVariant && (
                            <div className="mt-1 text-xs text-stone-500">
                              {locale === 'ka' ? 'ფერი' : 'Цвет'}: {run.labelSnapshot?.colorLabel ?? run.colorVariant}
                            </div>
                          )}
                        </div>
                      </div>
                      {run.comment && (
                        <p className="mt-2 text-xs text-stone-600">{run.comment}</p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

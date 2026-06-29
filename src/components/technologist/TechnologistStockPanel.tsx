import { useMemo, useState } from 'react'
import { TechnologistRenameProposalModal } from '@/components/technologist/TechnologistRenameProposalModal'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { maxBatchesFromStock, recipeTotalBatchKg } from '@/lib/formulations/calc'
import { filterFormulationComponentItems } from '@/lib/formulations/warehouseSync'
import type { FormulationStore } from '@/lib/formulations/types'
import { openItemRenameRequests } from '@/lib/warehouse/itemRenameRequests'
import type { CreateItemRenameRequestInput } from '@/lib/warehouse/itemRenameRequests'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  formulations: FormulationStore
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  operatorId?: string
  operatorName?: string
  onProposeRename: (input: CreateItemRenameRequestInput) => { ok: boolean; error?: string }
}

export function TechnologistStockPanel({
  formulations,
  warehouse,
  categoryNames,
  operatorId,
  operatorName,
  onProposeRename,
}: Props) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState(warehouse.locations[0]?.id ?? '')
  const [renameItem, setRenameItem] = useState<WarehouseItem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const balances = useMemo(
    () => computeAllBalances(warehouse, warehouseId || undefined),
    [warehouse, warehouseId],
  )

  const chemistryItems = useMemo(
    () => filterFormulationComponentItems(warehouse.items, categoryNames),
    [warehouse.items, categoryNames],
  )

  const pendingRenameIds = useMemo(
    () => new Set(openItemRenameRequests(warehouse).map((r) => r.itemId)),
    [warehouse],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return chemistryItems
      .filter((item) => {
        if (!q) return true
        return (
          item.name.toLowerCase().includes(q) ||
          item.internalCode.toLowerCase().includes(q) ||
          (item.sku?.toLowerCase().includes(q) ?? false)
        )
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [chemistryItems, search])

  const recipeCapacity = useMemo(() => {
    return formulations.recipes
      .filter((r) => r.active)
      .map((recipe) => ({
        id: recipe.id,
        code: recipe.code,
        name: recipe.name,
        batches: maxBatchesFromStock(recipe, balances) ?? 0,
        baseL: recipeTotalBatchKg(recipe),
      }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [formulations.recipes, balances])

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-sm border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900">
          {notice}
        </p>
      )}

      <Card title={t('technologist.nomenclatureTitle')} description={t('technologist.nomenclatureHint')}>
        <div className="mb-4 flex flex-wrap gap-3">
          <Input
            className="max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('technologist.recipeSearchStock')}
          />
          <select
            className="fc-input max-w-xs"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouse.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="fc-table w-full text-sm">
            <thead>
              <tr>
                <th>{t('technologist.col.item')}</th>
                <th className="text-right">{t('technologist.col.stock')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-stone-500">
                    {t('technologist.nomenclatureEmpty')}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const avail = balances.get(item.id)?.available ?? 0
                  const pending = pendingRenameIds.has(item.id)
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="font-medium text-ink">{item.name}</div>
                        <div className="text-xs text-stone-500">
                          {item.internalCode}
                          {item.sku ? ` · ${item.sku}` : ''} · {item.unit}
                        </div>
                        {pending && (
                          <span className="mt-1 inline-flex rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                            {t('technologist.renamePending')}
                          </span>
                        )}
                      </td>
                      <td
                        className={`text-right tabular-nums font-medium ${
                          avail <= 0 ? 'text-red-700' : 'text-teal-800'
                        }`}
                      >
                        {formatQty(avail)} {item.unit}
                      </td>
                      <td className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={pending}
                          onClick={() => setRenameItem(item)}
                        >
                          {t('technologist.renamePropose')}
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {recipeCapacity.length > 0 && (
        <Card title={t('technologist.capacityTitle')} description={t('technologist.capacityHint')}>
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('formulation.col.code')}</th>
                  <th>{t('formulation.col.name')}</th>
                  <th className="text-right">{t('technologist.col.baseVolume')}</th>
                  <th className="text-right">{t('formulation.col.stockBatches')}</th>
                </tr>
              </thead>
              <tbody>
                {recipeCapacity.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.code}</td>
                    <td>{r.name}</td>
                    <td className="text-right tabular-nums">{Math.round(r.baseL)} л</td>
                    <td
                      className={`text-right tabular-nums font-semibold ${
                        r.batches > 0 ? 'text-teal-800' : 'text-red-700'
                      }`}
                    >
                      {r.batches}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {renameItem && (
        <TechnologistRenameProposalModal
          item={renameItem}
          operatorId={operatorId}
          operatorName={operatorName}
          onSubmit={(input) => {
            const result = onProposeRename(input)
            if (result.ok) setNotice(t('technologist.renameSent'))
            return result
          }}
          onClose={() => setRenameItem(null)}
        />
      )}
    </div>
  )
}

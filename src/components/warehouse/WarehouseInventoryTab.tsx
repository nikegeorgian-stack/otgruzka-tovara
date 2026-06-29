import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { TabBar } from '@/components/ui/TabBar'
import { WarehouseInventoryPrintPanel } from '@/components/warehouse/WarehouseInventoryPrintPanel'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { computeAllBalances, formatQty } from '@/lib/warehouse/stock'
import type { WarehousePageProps } from './warehouseTypes'

type InvMode = 'print' | 'revision' | 'opening' | 'single'

type Props = Pick<
  WarehousePageProps,
  'warehouse' | 'onRunInventory' | 'onPostInventoryRevision' | 'onPostOpeningBalances' | 'printMeta'
> & {
  warehouseId: string
}

export function WarehouseInventoryTab({
  warehouse,
  warehouseId,
  onRunInventory,
  onPostInventoryRevision,
  onPostOpeningBalances,
  printMeta,
}: Props) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const balances = useMemo(
    () => computeAllBalances(warehouse, whId || undefined),
    [warehouse, whId],
  )

  const [mode, setMode] = useState<InvMode>('print')
  const [notice, setNotice] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [search, setSearch] = useState('')
  const [onlyDiff, setOnlyDiff] = useState(false)

  // Single item
  const [itemId, setItemId] = useState(warehouse.items.find((i) => i.active)?.id ?? '')
  const [counted, setCounted] = useState('')

  // Revision / opening counts keyed by itemId
  const [counts, setCounts] = useState<Record<string, string>>({})

  const activeItems = useMemo(
    () =>
      warehouse.items
        .filter((i) => i.active && (!whId || i.warehouseId === whId))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [warehouse.items, whId],
  )

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return activeItems.filter((item) => {
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        item.internalCode?.toLowerCase().includes(q) ||
        item.sku?.toLowerCase().includes(q)
      )
    })
  }, [activeItems, search])

  const revisionRows = useMemo(() => {
    return filteredItems
      .map((item) => {
        const book = balances.get(item.id)?.balance ?? 0
        const raw = counts[item.id]
        const fact = raw === undefined || raw === '' ? undefined : Number(raw.replace(',', '.'))
        const diff = fact !== undefined && !Number.isNaN(fact) ? fact - book : undefined
        return { item, book, fact, diff }
      })
      .filter((row) => !onlyDiff || (row.diff !== undefined && Math.abs(row.diff) > 1e-9))
  }, [filteredItems, balances, counts, onlyDiff])

  const openingRows = useMemo(() => {
    return filteredItems
      .filter((item) => Math.abs(balances.get(item.id)?.balance ?? 0) < 1e-9)
      .map((item) => {
        const raw = counts[item.id]
        const qty = raw === undefined || raw === '' ? undefined : Number(raw.replace(',', '.'))
        return { item, qty }
      })
  }, [filteredItems, balances, counts])

  const item = warehouse.items.find((i) => i.id === itemId)
  const current = balances.get(itemId)?.balance ?? 0

  function setCount(itemId: string, value: string) {
    setCounts((prev) => ({ ...prev, [itemId]: value }))
  }

  function submitSingle(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(counted.replace(',', '.'))
    if (!itemId || Number.isNaN(n) || n < 0) return
    onRunInventory({ itemId, warehouseId: whId, counted: n, date, comment: comment || undefined })
    setCounted('')
    setNotice(t('warehouse.inventory.singleDone'))
  }

  async function submitRevision() {
    const lines = revisionRows
      .filter((r) => r.fact !== undefined && !Number.isNaN(r.fact!) && r.fact! >= 0)
      .map((r) => ({ itemId: r.item.id, counted: r.fact! }))
    if (lines.length === 0) {
      setNotice(t('warehouse.inventory.revisionEmpty'))
      return
    }
    if (!(await confirm({ message: tf('warehouse.inventory.revisionConfirm', { count: lines.length }) }))) {
      return
    }
    const result = onPostInventoryRevision({
      warehouseId: whId,
      date,
      comment: comment || undefined,
      lines,
    })
    setNotice(
      tf('warehouse.inventory.revisionDone', {
        applied: result.applied,
        unchanged: result.unchanged,
        skipped: result.skipped,
      }),
    )
    setCounts({})
  }

  async function submitOpening() {
    const lines = openingRows
      .filter((r) => r.qty !== undefined && !Number.isNaN(r.qty!) && r.qty! > 0)
      .map((r) => ({ itemId: r.item.id, quantity: r.qty! }))
    if (lines.length === 0) {
      setNotice(t('warehouse.inventory.openingEmpty'))
      return
    }
    if (!(await confirm({ message: tf('warehouse.inventory.openingConfirm', { count: lines.length }) }))) {
      return
    }
    const result = onPostOpeningBalances({
      warehouseId: whId,
      date,
      comment: comment || undefined,
      lines,
    })
    setNotice(
      tf('warehouse.inventory.openingDone', {
        applied: result.applied,
        skipped: result.skipped,
      }),
    )
    setCounts({})
  }

  function fillBookAsFact() {
    const next: Record<string, string> = { ...counts }
    for (const item of filteredItems) {
      const book = balances.get(item.id)?.balance ?? 0
      next[item.id] = String(book)
    }
    setCounts(next)
  }

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-end gap-3 rounded-sm border border-grid bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-stone-500">
          {t('warehouse.date')}
          <input
            type="date"
            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-semibold text-stone-500">
          {t('warehouse.comment')}
          <input
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={
              mode === 'print'
                ? t('warehouse.inventory.printCommentPh')
                : mode === 'opening'
                  ? t('warehouse.inventory.openingCommentPh')
                  : t('warehouse.inventory.revisionCommentPh')
            }
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
        {mode !== 'single' && mode !== 'print' && (
          <label className="min-w-[10rem] flex-1 text-xs font-semibold text-stone-500">
            {t('warehouse.search')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
      </div>

      <TabBar
        tabs={(
          [
            ['print', 'warehouse.inventory.tabPrint'],
            ['revision', 'warehouse.inventory.tabRevision'],
            ['opening', 'warehouse.inventory.tabOpening'],
            ['single', 'warehouse.inventory.tabSingle'],
          ] as const
        ).map(([id, key]) => ({ id, label: t(key) }))}
        value={mode}
        onChange={setMode}
      />

      {mode === 'print' && (
        <WarehouseInventoryPrintPanel
          warehouse={warehouse}
          date={date}
          comment={comment}
          site={printMeta?.site}
          responsible={printMeta?.responsible}
        />
      )}

      {mode === 'single' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form
            onSubmit={submitSingle}
            className="space-y-4 rounded-sm border border-grid bg-white p-5 shadow-sm"
          >
            <h3 className="font-bold text-ink">{t('warehouse.inventory.title')}</h3>
            <p className="text-sm text-stone-500">{t('warehouse.inventory.hint')}</p>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.col.name')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                {activeItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm">
              {t('warehouse.inventory.current')}:{' '}
              <span className="font-bold tabular-nums">
                {formatQty(current)} {item?.unit ?? ''}
              </span>
            </p>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.inventory.counted')} *
              <input
                type="text"
                inputMode="decimal"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-sm bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
            >
              {t('warehouse.inventory.apply')}
            </button>
          </form>
          <RecentInventoryLog warehouse={warehouse} />
        </div>
      )}

      {mode === 'revision' && (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{t('warehouse.inventory.revisionTitle')}</h3>
              <p className="mt-1 text-sm text-stone-500">
                {t('warehouse.inventory.revisionHint')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-stone-500">
                <input
                  type="checkbox"
                  checked={onlyDiff}
                  onChange={(e) => setOnlyDiff(e.target.checked)}
                />
                {t('warehouse.inventory.onlyDiff')}
              </label>
              <button
                type="button"
                className="rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-paper-dark"
                onClick={fillBookAsFact}
              >
                {t('warehouse.inventory.fillBook')}
              </button>
              <button
                type="button"
                className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                onClick={submitRevision}
              >
                {t('warehouse.inventory.revisionApply')}
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                  <th className="border border-grid px-2 py-2 text-left">№</th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.internalCode')}
                  </th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.name')}
                  </th>
                  <th className="border border-grid px-2 py-2">{t('warehouse.col.unit')}</th>
                  <th className="border border-grid px-2 py-2 text-right">
                    {t('warehouse.inventory.current')}
                  </th>
                  <th className="border border-grid px-2 py-2 text-right">
                    {t('warehouse.inventory.counted')}
                  </th>
                  <th className="border border-grid px-2 py-2 text-right">
                    {t('warehouse.inventory.diff')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {revisionRows.map((row, idx) => {
                  const hasDiff =
                    row.diff !== undefined && Math.abs(row.diff) > 1e-9
                  return (
                    <tr
                      key={row.item.id}
                      className={hasDiff ? 'bg-amber-50/60' : undefined}
                    >
                      <td className="border border-grid px-2 py-1 text-center font-mono text-xs">
                        {idx + 1}
                      </td>
                      <td className="border border-grid px-2 py-1 font-mono text-xs">
                        {row.item.internalCode}
                      </td>
                      <td className="border border-grid px-2 py-1">{row.item.name}</td>
                      <td className="border border-grid px-2 py-1 text-center text-xs">
                        {row.item.unit}
                      </td>
                      <td className="border border-grid px-2 py-1 text-right font-mono">
                        {formatQty(row.book)}
                      </td>
                      <td className="border border-grid p-0">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-full border-0 bg-transparent px-2 py-1.5 text-right font-mono"
                          value={counts[row.item.id] ?? ''}
                          onChange={(e) => setCount(row.item.id, e.target.value)}
                        />
                      </td>
                      <td
                        className={`border border-grid px-2 py-1 text-right font-mono ${
                          hasDiff
                            ? row.diff! > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                            : 'text-stone-400'
                        }`}
                      >
                        {row.diff !== undefined && !Number.isNaN(row.diff)
                          ? (row.diff > 0 ? '+' : '') + formatQty(row.diff)
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {revisionRows.length === 0 && (
            <p className="mt-4 text-center text-sm text-stone-400">
              {t('warehouse.inventory.noItems')}
            </p>
          )}
        </div>
      )}

      {mode === 'opening' && (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{t('warehouse.inventory.openingTitle')}</h3>
              <p className="mt-1 text-sm text-stone-500">
                {t('warehouse.inventory.openingHint')}
              </p>
            </div>
            <button
              type="button"
              className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              onClick={submitOpening}
            >
              {t('warehouse.inventory.openingApply')}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                  <th className="border border-grid px-2 py-2 text-left">№</th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.internalCode')}
                  </th>
                  <th className="border border-grid px-2 py-2 text-left">
                    {t('warehouse.col.name')}
                  </th>
                  <th className="border border-grid px-2 py-2">{t('warehouse.col.unit')}</th>
                  <th className="border border-grid px-2 py-2 text-right">
                    {t('warehouse.inventory.openingQty')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {openingRows.map((row, idx) => (
                  <tr key={row.item.id}>
                    <td className="border border-grid px-2 py-1 text-center font-mono text-xs">
                      {idx + 1}
                    </td>
                    <td className="border border-grid px-2 py-1 font-mono text-xs">
                      {row.item.internalCode}
                    </td>
                    <td className="border border-grid px-2 py-1">{row.item.name}</td>
                    <td className="border border-grid px-2 py-1 text-center text-xs">
                      {row.item.unit}
                    </td>
                    <td className="border border-grid p-0">
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full border-0 bg-transparent px-2 py-1.5 text-right font-mono"
                        value={counts[row.item.id] ?? ''}
                        onChange={(e) => setCount(row.item.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openingRows.length === 0 && (
            <p className="mt-4 text-center text-sm text-stone-400">
              {t('warehouse.inventory.openingAllSet')}
            </p>
          )}
        </div>
      )}

      {mode !== 'single' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <RecentInventoryLog warehouse={warehouse} />
        </div>
      )}
    </div>
  )
}

function RecentInventoryLog({
  warehouse,
}: {
  warehouse: Pick<WarehousePageProps['warehouse'], 'auditLog'>
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="font-bold text-ink">{t('warehouse.inventory.recent')}</h3>
      <ul className="mt-3 max-h-80 space-y-2 overflow-auto text-sm">
        {[...warehouse.auditLog]
          .filter((e) => e.action === 'inventory')
          .slice(-25)
          .reverse()
          .map((e) => (
            <li key={e.id} className="border-b border-grid/60 pb-2">
              <span className="text-stone-400">
                {e.at.slice(0, 16).replace('T', ' ')}
              </span>
              <p>{e.detail}</p>
            </li>
          ))}
      </ul>
    </div>
  )
}

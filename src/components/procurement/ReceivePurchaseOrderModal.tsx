import { useMemo, useState } from 'react'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { useI18n } from '@/context/I18nContext'
import type { ReceiveOrderOpts } from '@/lib/procurement/receive'
import type { PurchaseOrder } from '@/lib/procurement/types'

type Props = {
  order: PurchaseOrder
  onClose: () => void
  onConfirm: (
    opts: ReceiveOrderOpts,
  ) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
}

export function ReceivePurchaseOrderModal({ order, onClose, onConfirm }: Props) {
  const { t } = useI18n()
  const remainingLines = useMemo(
    () =>
      order.lines
        .map((l) => ({
          line: l,
          remaining: Math.max(0, l.quantity - l.receivedQty),
        }))
        .filter((x) => x.remaining > 0),
    [order.lines],
  )

  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const { line, remaining } of remainingLines) {
      init[line.id] = String(remaining)
    }
    return init
  })
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setAllRemaining() {
    const next: Record<string, string> = {}
    for (const { line, remaining } of remainingLines) {
      next[line.id] = String(remaining)
    }
    setQtys(next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const lineQtys: Record<string, number> = {}
    let any = false
    for (const { line, remaining } of remainingLines) {
      const raw = qtys[line.id]?.replace(',', '.') ?? ''
      const n = Number(raw)
      if (!raw.trim() || Number.isNaN(n) || n <= 0) continue
      if (n > remaining + 1e-9) {
        setError(t('procurement.receive.errOverRemain'))
        return
      }
      lineQtys[line.id] = n
      any = true
    }
    if (!any) {
      setError(t('procurement.receive.errNothing'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      const res = await onConfirm({ date, lineQtys })
      if (!res.ok) {
        setError(t(res.error ?? 'procurement.receive.errNothing'))
        return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalBackdrop
      open
      onClose={onClose}
      ephemeral
      panelClassName="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-sm bg-white shadow-sm"
    >
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-grid px-5 py-4">
          <h3 className="text-lg font-bold text-ink">{t('procurement.receive.title')}</h3>
          <p className="mt-1 font-mono text-xs text-teal-700">{order.orderNumber}</p>
          <p className="mt-1 text-sm text-stone-500">{t('procurement.receive.partialHint')}</p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-5 py-4">
          <label className="block text-sm">
            <span className="text-xs font-medium text-stone-500">{t('procurement.receive.date')}</span>
            <input
              type="date"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>

          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs font-medium text-teal-800 hover:underline"
              onClick={setAllRemaining}
            >
              {t('procurement.receive.fillAll')}
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-grid text-left text-xs uppercase text-stone-500">
                <th className="py-2 pr-2">{t('procurement.col.item')}</th>
                <th className="py-2 pr-2 text-right">{t('procurement.receive.remain')}</th>
                <th className="py-2 text-right">{t('procurement.receive.qty')}</th>
              </tr>
            </thead>
            <tbody>
              {remainingLines.map(({ line, remaining }) => (
                <tr key={line.id} className="border-b border-grid/60">
                  <td className="py-2 pr-2">
                    <span className="font-medium text-ink">{line.name}</span>
                    {line.unit ? (
                      <span className="ml-1 text-xs text-stone-400">{line.unit}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-stone-600">
                    {remaining}
                  </td>
                  <td className="py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-24 rounded-sm border border-grid px-2 py-1 text-right text-sm"
                      value={qtys[line.id] ?? ''}
                      onChange={(e) =>
                        setQtys((prev) => ({ ...prev, [line.id]: e.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {error ? (
            <p className="rounded-sm bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-grid px-5 py-3">
          <button
            type="button"
            className="rounded-sm border border-grid px-4 py-2 text-sm"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-sm bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {t('procurement.receive.action')}
          </button>
        </div>
      </form>
    </ModalBackdrop>
  )
}

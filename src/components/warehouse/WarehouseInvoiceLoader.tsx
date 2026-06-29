import { useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { isInvoiceAlreadyPosted } from '@/lib/warehouse/documents'
import {
  applyInvoiceToItems,
  findInvoiceByKey,
  invoiceDisplayNumber,
  normalizeInvoiceKey,
  parseInvoiceFile,
} from '@/lib/warehouse/georgianInvoice'
import type { GeorgianInvoice, WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'

export type InvoiceLoadResult = {
  invoice: GeorgianInvoice
  number: string
  date: string
  counterparty: string
  invoiceKey: string
  sellerTin?: string
  lines: { itemId: string; quantity: number }[]
  unmatched: string[]
}

type Props = {
  warehouse: WarehouseStore
  items: WarehouseItem[]
  onLoad: (result: InvoiceLoadResult) => void
  onRegistryUpdate: (registry: GeorgianInvoice[]) => void
}

export function WarehouseInvoiceLoader({
  warehouse,
  items,
  onLoad,
  onRegistryUpdate,
}: Props) {
  const { t } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<{ type: 'error' | 'info'; message: string } | null>(null)

  function applyInvoice(invoice: GeorgianInvoice) {
    if (isInvoiceAlreadyPosted(warehouse, invoice.key)) {
      setNotice({ type: 'error', message: t('warehouse.invoice.alreadyPosted') })
      return
    }
    const { matched, unmatched } = applyInvoiceToItems(invoice, items)
    if (!matched.length) {
      setNotice({
        type: 'error',
        message: t('warehouse.invoice.noMatches'),
      })
      return
    }

    const displayNo = invoiceDisplayNumber(invoice)
    onLoad({
      invoice,
      number: displayNo,
      date: invoice.date ?? new Date().toISOString().slice(0, 10),
      counterparty: invoice.sellerName ?? '',
      invoiceKey: invoice.key,
      sellerTin: invoice.sellerTin,
      lines: matched.map((m) => ({ itemId: m.itemId, quantity: m.quantity })),
      unmatched: unmatched.map((u) => u.name),
    })

    const msg =
      unmatched.length > 0
        ? t('warehouse.invoice.partialMatch').replace('{n}', String(unmatched.length))
        : t('warehouse.invoice.loaded')
    setNotice({ type: unmatched.length ? 'info' : 'info', message: msg })
  }

  function lookupRegistry() {
    setNotice(null)
    const key = normalizeInvoiceKey(query)
    if (!key) {
      setNotice({ type: 'error', message: t('warehouse.invoice.enterNumber') })
      return
    }

    const found = findInvoiceByKey(warehouse.invoiceRegistry, query)
    if (!found) {
      setNotice({ type: 'error', message: t('warehouse.invoice.notFound') })
      return
    }

    applyInvoice(found)
  }

  async function onFile(file: File) {
    setNotice(null)
    try {
      const text = await file.text()
      const parsed = parseInvoiceFile(text, file.name)
      if (!parsed.length) {
        setNotice({ type: 'error', message: t('warehouse.invoice.parseEmpty') })
        return
      }

      const map = new Map(warehouse.invoiceRegistry.map((i) => [i.key, i]))
      for (const inv of parsed) {
        map.set(inv.key, { ...inv, id: map.get(inv.key)?.id ?? inv.id })
      }
      const nextRegistry = [...map.values()]
      onRegistryUpdate(nextRegistry)

      const key = normalizeInvoiceKey(query)
      const target =
        (key ? parsed.find((p) => p.key === key) : undefined) ??
        (parsed.length === 1 ? parsed[0] : undefined)

      if (target) {
        setQuery(invoiceDisplayNumber(target))
        applyInvoice(target)
        setNotice({
          type: 'info',
          message: t('warehouse.invoice.imported').replace('{n}', String(parsed.length)),
        })
      } else {
        setNotice({
          type: 'info',
          message: t('warehouse.invoice.importedMany').replace('{n}', String(parsed.length)),
        })
      }
    } catch {
      setNotice({ type: 'error', message: t('warehouse.invoice.parseError') })
    }
  }

  const registryCount = warehouse.invoiceRegistry.length

  return (
    <div className="rounded-sm border border-teal-200 bg-teal-50/40 p-4">
      <h4 className="text-sm font-bold text-teal-900">{t('warehouse.invoice.title')}</h4>
      <p className="mt-1 text-xs text-teal-800/80">{t('warehouse.invoice.hint')}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="min-w-[12rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          placeholder={t('warehouse.invoice.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              lookupRegistry()
            }
          }}
        />
        <button
          type="button"
          className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          onClick={lookupRegistry}
        >
          {t('warehouse.invoice.load')}
        </button>
        <button
          type="button"
          className="rounded-sm border border-teal-600 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
          onClick={() => fileRef.current?.click()}
        >
          {t('warehouse.invoice.importFile')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.xml,application/json,text/xml"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
      </div>

      <p className="mt-2 text-[11px] text-teal-700/70">
        {t('warehouse.invoice.registryCount')}: {registryCount}
      </p>

      {notice && (
        <div className="mt-3">
          <FormNotice type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
        </div>
      )}
    </div>
  )
}

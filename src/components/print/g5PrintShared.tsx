import type { ReactNode } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { useI18n } from '@/context/I18nContext'
import type { G5PrintMetaRow, G5PrintSignaturePlace } from '@/lib/print/g5SalesOrderPrint'

const META_LABEL_KEYS: Record<string, string> = {
  customer: 'g5.print.meta.customer',
  supplier: 'g5.print.meta.supplier',
  revision: 'g5.print.meta.revision',
  status: 'g5.print.meta.status',
  priority: 'g5.print.meta.priority',
  actor: 'g5.print.meta.actor',
  time: 'g5.print.meta.time',
  currency: 'g5.print.meta.currency',
  approvedBy: 'g5.print.meta.approvedBy',
  approvedAt: 'g5.print.meta.approvedAt',
  changeReason: 'g5.print.meta.changeReason',
  purchaseOrder: 'g5.print.meta.purchaseOrder',
  warehouse: 'g5.print.meta.warehouse',
  location: 'g5.print.meta.location',
  warehouseDocument: 'g5.print.meta.warehouseDocument',
  originalDoc: 'g5.print.meta.originalDoc',
  kind: 'g5.print.meta.kind',
  reason: 'g5.print.meta.reason',
}

export function G5PrintBanner({ text }: { text: string }) {
  return (
    <div
      className="mb-3 border border-black px-2 py-1 text-center text-xs font-bold tracking-widest"
      style={{ borderWidth: '1px' }}
      aria-label={text}
    >
      {text}
    </div>
  )
}

export function G5PrintSheetChrome({
  title,
  docNumber,
  docDate,
  banner,
  children,
}: {
  title: string
  docNumber?: string
  docDate?: string
  banner?: string
  children: ReactNode
}) {
  return (
    <article className="print-sheet-page print-sheet-page--portrait">
      <div className="print-sheet-content mx-auto max-w-[210mm] bg-white p-6 text-[11px] text-black">
        <header className="print-sheet-header mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-black pb-2">
          <FiberCellBrand variant="print" />
          <div className="min-w-0 text-right">
            <h1 className="print-title text-sm font-bold uppercase tracking-wide">{title}</h1>
            {docNumber ? (
              <p className="mt-0.5 text-xs text-stone-600">
                № {docNumber}
                {docDate ? ` · ${docDate}` : ''}
              </p>
            ) : null}
          </div>
        </header>
        {banner ? <G5PrintBanner text={banner} /> : null}
        {children}
      </div>
    </article>
  )
}

export function G5PrintMetaTable({ rows }: { rows: G5PrintMetaRow[] }) {
  const { t } = useI18n()
  if (rows.length === 0) return null
  return (
    <table className="mb-3 w-full border-collapse text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.label}-${r.value}`} className="border-b border-stone-200">
            <th className="w-[36%] py-0.5 pr-2 text-left font-medium text-stone-500 align-top">
              {t(META_LABEL_KEYS[r.label] ?? r.label)}
            </th>
            <td className="py-0.5 align-top text-ink">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function G5PrintSignatures({
  places,
  actorName,
  at,
}: {
  places: G5PrintSignaturePlace[]
  actorName?: string
  at?: string
}) {
  const { t } = useI18n()
  return (
    <footer className="mt-6 print-sheet-footer">
      {(actorName || at) && (
        <p className="mb-3 text-xs text-stone-600">
          {t('g5.print.electronic')}: {actorName || '—'}
          {at ? ` · ${at}` : ''}
        </p>
      )}
      <div className="grid grid-cols-3 gap-4 text-xs">
        {places.map((p) => (
          <div key={p.roleKey} className="border-t border-dashed border-stone-500 pt-6">
            <div className="font-medium">{t(p.roleKey)}</div>
            <div className="mt-1 text-stone-600">{p.name || t('g5.print.sign.blank')}</div>
          </div>
        ))}
      </div>
    </footer>
  )
}

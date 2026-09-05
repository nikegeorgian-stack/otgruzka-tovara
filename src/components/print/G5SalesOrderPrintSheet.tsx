import { useI18n } from '@/context/I18nContext'
import type { G5SalesOrderPrintModel } from '@/lib/print/g5SalesOrderPrint'
import { G5PrintMetaTable, G5PrintSheetChrome, G5PrintSignatures } from './g5PrintShared'

type Props = {
  model: G5SalesOrderPrintModel
  /** Gate commercial price columns (overrides model.showPrices when false). */
  showCommercial?: boolean
}

export function G5SalesOrderPrintSheet({ model, showCommercial }: Props) {
  const { t } = useI18n()
  const showPrices = showCommercial !== false && model.showPrices

  return (
    <G5PrintSheetChrome
      title={t('g5.print.salesOrder.title')}
      docNumber={model.docNumber}
      docDate={model.at?.slice(0, 10)}
      banner={model.banner}
    >
      <G5PrintMetaTable rows={model.metaRows} />

      <table className="mb-3 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-1">№</th>
            <th className="py-1 pr-1">{t('g5.print.col.code')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.name')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.unit')}</th>
            <th className="py-1 pr-1 text-right">{t('g5.print.col.qty')}</th>
            <th className="py-1 pr-1 text-right">{t('g5.print.col.shipped')}</th>
            <th className="py-1 pr-1 text-right">{t('g5.print.col.remaining')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.shipDate')}</th>
            {showPrices ? <th className="py-1 text-right">{t('g5.print.col.price')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((ln, i) => (
            <tr key={ln.lineId} className="border-b border-stone-300 align-top">
              <td className="py-0.5 pr-1">{i + 1}</td>
              <td className="py-0.5 pr-1">{ln.productCodeSnapshot || '—'}</td>
              <td className="py-0.5 pr-1">{ln.productNameSnapshot || '—'}</td>
              <td className="py-0.5 pr-1">{ln.unit}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{ln.qty}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{ln.shippedQty}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{ln.remainingQty}</td>
              <td className="py-0.5 pr-1">{ln.requestedShipDate || '—'}</td>
              {showPrices ? (
                <td className="py-0.5 text-right tabular-nums">
                  {ln.unitPrice != null ? `${ln.unitPrice}${ln.currency ? ` ${ln.currency}` : ''}` : '—'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      <G5PrintSignatures places={model.signaturePlaces} actorName={model.actorName} at={model.at} />
    </G5PrintSheetChrome>
  )
}

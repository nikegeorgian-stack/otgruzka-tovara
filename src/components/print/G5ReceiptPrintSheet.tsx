import { useI18n } from '@/context/I18nContext'
import type { G5ReceiptPrintModel } from '@/lib/print/g5ReceiptPrint'
import { G5PrintMetaTable, G5PrintSheetChrome, G5PrintSignatures } from './g5PrintShared'

type Props = {
  model: G5ReceiptPrintModel
  showCommercial?: boolean
}

export function G5ReceiptPrintSheet({ model, showCommercial }: Props) {
  const { t } = useI18n()
  const showPrices = showCommercial !== false && model.showPrices

  return (
    <G5PrintSheetChrome
      title={t('g5.print.receipt.title')}
      docNumber={model.docNumber}
      docDate={model.at?.slice(0, 10)}
    >
      <G5PrintMetaTable rows={model.metaRows} />

      <table className="mb-3 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1 pr-1">№</th>
            <th className="py-1 pr-1">{t('g5.print.col.code')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.name')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.unit')}</th>
            <th className="py-1 pr-1 text-right">{t('g5.print.col.received')}</th>
            <th className="py-1 pr-1 text-right">{t('g5.print.col.remainingPo')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.batch')}</th>
            <th className="py-1 pr-1">{t('g5.print.col.expiry')}</th>
            {showPrices ? <th className="py-1 text-right">{t('g5.print.col.price')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {model.lines.map((ln, i) => (
            <tr key={ln.lineId} className="border-b border-stone-300 align-top">
              <td className="py-0.5 pr-1">{i + 1}</td>
              <td className="py-0.5 pr-1">{ln.itemCodeSnapshot || '—'}</td>
              <td className="py-0.5 pr-1">{ln.itemNameSnapshot || '—'}</td>
              <td className="py-0.5 pr-1">{ln.unit}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{ln.receivedQty}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{ln.remainingPoQty}</td>
              <td className="py-0.5 pr-1">{ln.batchNo || '—'}</td>
              <td className="py-0.5 pr-1">{ln.expiryDate || '—'}</td>
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

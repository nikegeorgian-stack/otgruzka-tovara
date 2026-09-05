import { useI18n } from '@/context/I18nContext'
import type { G5ReversalPrintModel } from '@/lib/print/g5ReversalPrint'
import { G5PrintMetaTable, G5PrintSheetChrome, G5PrintSignatures } from './g5PrintShared'

type Props = {
  model: G5ReversalPrintModel
  showCommercial?: boolean
}

export function G5ReversalPrintSheet({ model, showCommercial }: Props) {
  const { t } = useI18n()
  const showPrices = showCommercial !== false && model.showPrices
  const bannerLabel =
    model.banner === 'СТОРНО' ? t('g5.print.reversal.storno') : t('g5.print.reversal.change')

  return (
    <G5PrintSheetChrome
      title={t('g5.print.reversal.title')}
      docNumber={model.docNumber}
      docDate={model.at?.slice(0, 10)}
      banner={bannerLabel}
    >
      <G5PrintMetaTable rows={model.metaRows} />

      {model.lines.length > 0 ? (
        <table className="mb-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-1">№</th>
              <th className="py-1 pr-1">{t('g5.print.col.code')}</th>
              <th className="py-1 pr-1">{t('g5.print.col.name')}</th>
              <th className="py-1 pr-1">{t('g5.print.col.unit')}</th>
              <th className="py-1 pr-1 text-right">{t('g5.print.col.qty')}</th>
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
                <td className="py-0.5 pr-1 text-right tabular-nums">{ln.qty}</td>
                {showPrices ? (
                  <td className="py-0.5 text-right tabular-nums">
                    {ln.unitPrice != null
                      ? `${ln.unitPrice}${ln.currency ? ` ${ln.currency}` : ''}`
                      : '—'}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <G5PrintSignatures places={model.signaturePlaces} actorName={model.actorName} at={model.at} />
    </G5PrintSheetChrome>
  )
}

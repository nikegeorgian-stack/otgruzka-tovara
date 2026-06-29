import { useI18n } from '@/context/I18nContext'
import { formatReceiptMoney, type ReceiptPrintModel } from '@/lib/warehouse/printDocument'
import { formatQty } from '@/lib/warehouse/stock'

type Props = {
  model: ReceiptPrintModel
}

export function WarehouseReceiptPrintSheet({ model }: Props) {
  const { t } = useI18n()

  return (
    <article className="warehouse-receipt-page print-sheet-page">
      <div className="warehouse-receipt-content print-sheet-content">
        <header className="warehouse-receipt-brand">
          <div>
            <div className="warehouse-receipt-brand-mark">FiberCell</div>
            <div className="warehouse-receipt-brand-sub">{model.orgLine}</div>
          </div>
        </header>

        <h1 className="warehouse-receipt-title">{t('warehouse.print.receiptTitle')}</h1>
        <p className="warehouse-receipt-no">
          {t('warehouse.print.receiptNo')}{' '}
          <strong>{model.number}</strong> {t('warehouse.print.fromDate')}{' '}
          <strong>{model.dateFormatted}</strong>
        </p>

        <dl className="warehouse-receipt-meta">
          {model.purpose ? (
            <div>
              <dt>{t('warehouse.doc.purpose')}</dt>
              <dd>{t(`warehouse.doc.purpose.${model.purpose}`)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('warehouse.location')}</dt>
            <dd>{model.warehouseName}</dd>
          </div>
          <div>
            <dt>{t('warehouse.doc.counterparty')}</dt>
            <dd>{model.counterparty}</dd>
          </div>
          {model.contractNumber ? (
            <div>
              <dt>{t('warehouse.doc.contract')}</dt>
              <dd>{model.contractNumber}</dd>
            </div>
          ) : null}
          {model.invoiceKey ? (
            <div>
              <dt>{t('warehouse.doc.invoiceKey')}</dt>
              <dd>{model.invoiceKey}</dd>
            </div>
          ) : null}
          {model.keeperName ? (
            <div>
              <dt>{t('warehouse.doc.keeper')}</dt>
              <dd>{model.keeperName}</dd>
            </div>
          ) : null}
          {model.productionRequestLabel ? (
            <div>
              <dt>{t('warehouse.doc.productionRequest')}</dt>
              <dd>{model.productionRequestLabel}</dd>
            </div>
          ) : null}
        </dl>

        <table className="warehouse-receipt-table">
          <thead>
            <tr>
              <th>{t('warehouse.print.colNo')}</th>
              <th>{t('warehouse.col.name')}</th>
              <th>{t('warehouse.col.category')}</th>
              <th>{t('warehouse.col.unit')}</th>
              <th>{t('warehouse.quantity')}</th>
              <th>{t('warehouse.price')}</th>
              <th>{t('warehouse.col.sum')}</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.map((line) => (
              <tr key={line.idx}>
                <td className="c">{line.idx}</td>
                <td>
                  {line.name}
                  {line.sku ? <span className="warehouse-receipt-sku">{line.sku}</span> : null}
                </td>
                <td className="c">{line.category}</td>
                <td className="c">{line.unit}</td>
                <td className="r num">{formatQty(line.qty)}</td>
                <td className="r num">{line.price ? formatReceiptMoney(line.price) : '—'}</td>
                <td className="r num">{line.sum ? formatReceiptMoney(line.sum) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="warehouse-receipt-totals">
          <div className="warehouse-receipt-totals-box">
            <div className="warehouse-receipt-totals-row">
              <span>{t('warehouse.print.lineCount')}</span>
              <strong>{model.lineCount}</strong>
            </div>
            <div className="warehouse-receipt-totals-row">
              <span>{t('warehouse.print.qtyTotal')}</span>
              <strong>{formatQty(model.totalQty)}</strong>
            </div>
            <div className="warehouse-receipt-totals-row">
              <span>{t('warehouse.doc.total')}</span>
              <strong>{formatReceiptMoney(model.totalSum)} ₾</strong>
            </div>
          </div>
        </div>

        {model.comment ? (
          <p className="warehouse-receipt-note">
            <strong>{t('warehouse.comment')}:</strong> {model.comment}
          </p>
        ) : null}

        <div className="warehouse-receipt-signatures">
          <div className="warehouse-receipt-sig">
            <div className="warehouse-receipt-sig-role">{t('warehouse.print.receivedBy')}</div>
            <div className="warehouse-receipt-sig-name">{model.receivedBy || '\u00A0'}</div>
          </div>
          <div className="warehouse-receipt-sig">
            <div className="warehouse-receipt-sig-role">{t('warehouse.print.deliveredBy')}</div>
            <div className="warehouse-receipt-sig-name">{'\u00A0'}</div>
          </div>
          <div className="warehouse-receipt-sig">
            <div className="warehouse-receipt-sig-role">{t('print.signAccountant')}</div>
            <div className="warehouse-receipt-sig-name">{model.accountant || '\u00A0'}</div>
          </div>
        </div>

        <p className="warehouse-receipt-footer">
          {t('warehouse.print.generated')} · {model.generatedAt}
        </p>
      </div>
    </article>
  )
}

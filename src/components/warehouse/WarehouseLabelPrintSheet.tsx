import { BRAND } from '@/lib/brand'
import type { LabelModel } from '@/lib/warehouse/labelCodes'

type Props = {
  labels: LabelModel[]
}

export function WarehouseLabelPrintSheet({ labels }: Props) {
  return (
    <div className="warehouse-labels-page">
      <div className="warehouse-labels-grid">
        {labels.map((label, idx) => (
          <article
            key={`${label.item.id}-${idx}`}
            className="warehouse-label"
            aria-label={label.item.name}
          >
            <header className="warehouse-label-brand">
              <img src={BRAND.mark} alt="" className="warehouse-label-logo" aria-hidden />
              <div className="warehouse-label-brand-text">
                <span className="warehouse-label-brand-name">FiberCell</span>
                {label.site ? <span className="warehouse-label-site">{label.site}</span> : null}
              </div>
            </header>

            <p className="warehouse-label-name">{label.item.name}</p>
            <p className="warehouse-label-meta">
              {[label.categoryName, label.item.unit, label.locationName].filter(Boolean).join(' · ')}
            </p>

            <div className="warehouse-label-ids">
              <span className="warehouse-label-code">{label.item.internalCode}</span>
              {label.item.sku ? (
                <span className="warehouse-label-sku">SKU {label.item.sku}</span>
              ) : null}
            </div>

            {(label.qrDataUrl || label.barcodeSvg) && (
              <div
                className={`warehouse-label-codes${label.qrDataUrl && label.barcodeSvg ? ' warehouse-label-codes--both' : ''}`}
              >
                {label.qrDataUrl ? (
                  <img src={label.qrDataUrl} alt="" className="warehouse-label-qr" />
                ) : null}
                {label.barcodeSvg ? (
                  <div
                    className="warehouse-label-barcode"
                    dangerouslySetInnerHTML={{ __html: label.barcodeSvg }}
                  />
                ) : null}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

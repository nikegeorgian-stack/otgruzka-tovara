import { BRAND } from '@/lib/brand'
import { formatMixDate, type CubeLabelModel } from '@/lib/formulations/cubeLabel'

type Props = {
  labels: CubeLabelModel[]
  locale: 'ru' | 'ka'
}

export function FormulationCubeLabelSheet({ labels, locale }: Props) {
  return (
    <div className="cube-labels-page cube-labels-page--mix">
      <div className="cube-labels-grid cube-labels-grid--mix">
        {labels.map((label) => {
          const { run, colorSwatch } = label
          return (
            <article
              key={run.id}
              className="cube-label cube-label--mix"
              aria-label={label.productTitle}
            >
              {colorSwatch ? (
                <span
                  className="cube-label-colorbar"
                  style={{ background: colorSwatch.fill }}
                  aria-hidden
                />
              ) : null}

              <header className="cube-label-brand">
                <img src={BRAND.mark} alt="" className="cube-label-logo" aria-hidden />
                <div className="cube-label-brand-text">
                  <span className="cube-label-brand-name">FiberCell</span>
                  <span className="cube-label-kicker">
                    {locale === 'ka' ? 'პროპიტკა' : 'Пропитка'}
                  </span>
                </div>
                <span className="cube-label-doc">{run.documentNumber}</span>
              </header>

              <h2 className="cube-label-product">{label.productTitle}</h2>

              {colorSwatch ? (
                <div
                  className="cube-label-color cube-label-color--mix"
                  style={{
                    background: colorSwatch.fill,
                    color: colorSwatch.text,
                    borderColor: colorSwatch.border,
                  }}
                >
                  <div className="cube-label-color-text">
                    <span className="cube-label-color-tag">
                      {locale === 'ka' ? 'ფერი' : 'Цвет'}
                    </span>
                    <span className="cube-label-color-name">{label.colorLabel}</span>
                  </div>
                  {label.variantCode ? (
                    <span className="cube-label-color-code">{label.variantCode}</span>
                  ) : null}
                </div>
              ) : null}

              <div className="cube-label-specs">
                {label.grammage ? (
                  <span className="cube-label-chip">
                    {label.grammage} г/м²
                  </span>
                ) : null}
                <span className="cube-label-chip cube-label-chip--volume">
                  {run.targetVolumeL} л
                </span>
              </div>

              {label.labelText ? (
                <p className="cube-label-purpose">{label.labelText}</p>
              ) : null}

              <dl className="cube-label-meta">
                <div>
                  <dt>{locale === 'ka' ? 'თარიღი' : 'Дата'}</dt>
                  <dd>{formatMixDate(run.mixedAt, locale)}</dd>
                </div>
                <div>
                  <dt>{locale === 'ka' ? 'ტექნ.' : 'Технолог'}</dt>
                  <dd>{run.mixedByName}</dd>
                </div>
                {run.shiftBrigade ? (
                  <div>
                    <dt>{locale === 'ka' ? 'ბრიგ.' : 'Смена'}</dt>
                    <dd>{run.shiftBrigade}</dd>
                  </div>
                ) : null}
                {label.warehouseName ? (
                  <div>
                    <dt>{locale === 'ka' ? 'საწყ.' : 'Склад'}</dt>
                    <dd>{label.warehouseName}</dd>
                  </div>
                ) : null}
              </dl>

              {label.qrDataUrl || label.barcodeDataUrl ? (
                <div className="cube-label-qr-wrap">
                  {label.qrDataUrl ? (
                    <img src={label.qrDataUrl} alt="" className="cube-label-qr" />
                  ) : null}
                  <div className="cube-label-qr-text">
                    {label.internalCode ? (
                      <>
                        {label.barcodeDataUrl ? (
                          <img
                            src={label.barcodeDataUrl}
                            alt=""
                            className="cube-label-barcode"
                          />
                        ) : null}
                        <span className="cube-label-qr-doc">{label.internalCode}</span>
                      </>
                    ) : (
                      <span className="cube-label-qr-doc">{run.documentNumber}</span>
                    )}
                  </div>
                </div>
              ) : null}

              <footer className="cube-label-footer">
                {label.site
                  ? `${label.site} · `
                  : ''}
                {locale === 'ka' ? 'პროპიტკის შემადგენლობა' : 'Пропиточный состав'}
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}

import { BRAND } from '@/lib/brand'
import { formatMixDate, type CubeLabelModel } from '@/lib/formulations/cubeLabel'

type Props = {
  labels: CubeLabelModel[]
  locale: 'ru' | 'ka'
}

export function FormulationCubeLabelSheet({ labels, locale }: Props) {
  return (
    <div className="cube-labels-page cube-labels-page--doc">
      {labels.map((label) => {
        const { run, colorSwatch } = label
        return (
          <article
            key={run.id}
            className="cube-label cube-label--doc"
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
                  {locale === 'ka' ? 'პროპიტკის შემადგენლობა' : 'Пропиточный состав'}
                </span>
              </div>
              <span className="cube-label-doc">{run.documentNumber}</span>
            </header>

            <h2 className="cube-label-product">{label.productTitle}</h2>

            {colorSwatch ? (
              <div
                className="cube-label-color"
                style={{
                  background: colorSwatch.fill,
                  color: colorSwatch.text,
                  borderColor: colorSwatch.border,
                }}
              >
                <div className="cube-label-color-text">
                  <span className="cube-label-color-tag">
                    {locale === 'ka' ? 'ფერი' : 'Цвет состава'}
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
                  <span className="cube-label-chip-key">
                    {locale === 'ka' ? 'გრამაჟი' : 'Грамаж'}
                  </span>
                  <span className="cube-label-chip-val">{label.grammage} г/м²</span>
                </span>
              ) : null}
              <span className="cube-label-chip cube-label-chip--volume">
                <span className="cube-label-chip-key">
                  {locale === 'ka' ? 'მოცულობა' : 'Объём'}
                </span>
                <span className="cube-label-chip-val">{run.targetVolumeL} л</span>
              </span>
            </div>

            {label.labelText ? <p className="cube-label-purpose">{label.labelText}</p> : null}

            <dl className="cube-label-meta">
              <div>
                <dt>{locale === 'ka' ? 'თარიღი' : 'Дата изготовления'}</dt>
                <dd>{formatMixDate(run.mixedAt, locale)}</dd>
              </div>
              <div>
                <dt>{locale === 'ka' ? 'ტექნოლოგი' : 'Технолог'}</dt>
                <dd>{run.mixedByName}</dd>
              </div>
              {run.shiftBrigade ? (
                <div>
                  <dt>{locale === 'ka' ? 'ბრიგადა' : 'Бригада / смена'}</dt>
                  <dd>{run.shiftBrigade}</dd>
                </div>
              ) : null}
              {label.warehouseName ? (
                <div>
                  <dt>{locale === 'ka' ? 'საწყობი' : 'Склад'}</dt>
                  <dd>{label.warehouseName}</dd>
                </div>
              ) : null}
              {label.site ? (
                <div>
                  <dt>{locale === 'ka' ? 'ობიექტი' : 'Объект'}</dt>
                  <dd>{label.site}</dd>
                </div>
              ) : null}
              {run.shiftNote ? (
                <div className="cube-label-meta-wide">
                  <dt>{locale === 'ka' ? 'შენიშვნა' : 'Примечание смены'}</dt>
                  <dd>{run.shiftNote}</dd>
                </div>
              ) : null}
            </dl>

            {label.qrDataUrl || label.barcodeDataUrl ? (
              <div className="cube-label-qr-wrap">
                {label.qrDataUrl ? (
                  <img src={label.qrDataUrl} alt="" className="cube-label-qr" />
                ) : null}
                <div className="cube-label-qr-text">
                  <span className="cube-label-qr-hint">
                    {locale === 'ka' ? 'პარტიის კოდი' : 'Код партии'}
                  </span>
                  <span className="cube-label-qr-doc">{run.documentNumber}</span>
                  {label.barcodeDataUrl ? (
                    <>
                      <img
                        src={label.barcodeDataUrl}
                        alt=""
                        className="cube-label-barcode"
                      />
                      <span className="cube-label-qr-doc">{label.internalCode}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            <footer className="cube-label-footer">
              {locale === 'ka'
                ? 'პროპიტკა · რეცეპტის გარეშე'
                : 'Пропиточный состав · без состава рецепта'}
            </footer>
          </article>
        )
      })}
    </div>
  )
}

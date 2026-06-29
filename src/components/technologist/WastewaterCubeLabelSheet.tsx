import { BRAND } from '@/lib/brand'
import { formatWwDate, type WastewaterCubeLabelModel } from '@/lib/wastewater/cubeLabel'
import { formatQty } from '@/lib/warehouse/stock'

type Props = {
  labels: WastewaterCubeLabelModel[]
  locale: 'ru' | 'ka'
}

export function WastewaterCubeLabelSheet({ labels, locale }: Props) {
  return (
    <div className="cube-labels-page">
      <div className="cube-labels-grid">
        {labels.map((label) => {
          const { cube, fields } = label
          const title =
            fields.includeWasteType && cube.wasteType
              ? cube.wasteType
              : locale === 'ka'
                ? 'სტочные воды'
                : 'Сточные воды'

          return (
            <article key={cube.id} className="cube-label" aria-label={title}>
              <header className="cube-label-brand">
                <img src={BRAND.mark} alt="" className="cube-label-logo" aria-hidden />
                <div className="cube-label-brand-text">
                  <span className="cube-label-brand-name">FiberCell</span>
                  {label.site ? <span className="cube-label-site">{label.site}</span> : null}
                </div>
                {fields.includeInternalCode ? (
                  <span className="cube-label-doc">{cube.internalCode}</span>
                ) : fields.includeNumber ? (
                  <span className="cube-label-doc">№{cube.cubeNumber}</span>
                ) : null}
              </header>

              <h2 className="cube-label-product">{title}</h2>

              <div className="cube-label-specs">
                {fields.includeNumber ? (
                  <span className="cube-label-chip">
                    {locale === 'ka' ? '№' : 'Куб №'}
                    {cube.cubeNumber}
                  </span>
                ) : null}
                {fields.includeColor && cube.color ? (
                  <span className="cube-label-chip">{cube.color}</span>
                ) : null}
                {fields.includeStatus ? (
                  <span className="cube-label-chip">{label.statusLabel}</span>
                ) : null}
                {fields.includeMass && cube.massKg != null ? (
                  <span className="cube-label-chip cube-label-chip--volume">
                    {formatQty(cube.massKg)} {locale === 'ka' ? 'კგ' : 'кг'}
                  </span>
                ) : null}
              </div>

              <dl className="cube-label-meta">
                {fields.includeInternalCode ? (
                  <div>
                    <dt>{locale === 'ka' ? 'კოდი' : 'Внутр. код'}</dt>
                    <dd>{cube.internalCode}</dd>
                  </div>
                ) : null}
                {fields.includeLocation && cube.locationNote ? (
                  <div>
                    <dt>{locale === 'ka' ? 'მდებარეობა' : 'Где стоит'}</dt>
                    <dd>{cube.locationNote}</dd>
                  </div>
                ) : null}
                {fields.includeFillDates && cube.fillStartDate ? (
                  <div>
                    <dt>{locale === 'ka' ? 'შევსება' : 'Наполнение'}</dt>
                    <dd>
                      {formatWwDate(cube.fillStartDate, locale)}
                      {cube.fillEndDate
                        ? ` — ${formatWwDate(cube.fillEndDate, locale)}`
                        : ''}
                    </dd>
                  </div>
                ) : null}
              </dl>

              {label.qrDataUrl ? (
                <div className="cube-label-qr-wrap">
                  <img src={label.qrDataUrl} alt="" className="cube-label-qr" />
                  <span className="cube-label-qr-hint">
                    {fields.includeInternalCode
                      ? cube.internalCode
                      : locale === 'ka'
                        ? 'QR კოდი'
                        : 'QR-код'}
                  </span>
                </div>
              ) : null}

              <footer className="cube-label-footer">
                {locale === 'ka' ? 'სტочные воды · კუბი' : 'Сточные воды · куб'}
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}

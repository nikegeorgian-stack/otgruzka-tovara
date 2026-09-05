import type { ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'

type Props = {
  title: string
  subtitle?: string
  tone: 'plan' | 'fact'
  headerAction?: ReactNode
  children: ReactNode
}

export function TimesheetSection({ title, subtitle, tone, headerAction, children }: Props) {
  const { t } = useI18n()
  return (
    <section className={`ts-section ts-section--${tone}`}>
      <div className="ts-section__head">
        <div className="ts-section__titles">
          <span className="ts-section__eyebrow">
            {tone === 'plan' ? t('month.deck.layerPlan') : t('month.deck.layerFact')}
          </span>
          <h3 className="ts-section__title">{title}</h3>
          {subtitle ? <p className="ts-section__sub">{subtitle}</p> : null}
        </div>
        <div className="ts-section__actions">
          {headerAction}
          <span className="ts-section__badge">
            {tone === 'plan' ? t('section.editable') : t('section.factOut')}
          </span>
        </div>
      </div>
      <div className="ts-section__body">{children}</div>
    </section>
  )
}

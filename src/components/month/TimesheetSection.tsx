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
    <section
      className={`overflow-hidden rounded-sm border shadow-sm ${
        tone === 'plan'
          ? 'border-sky-200/80 bg-sky-50'
          : 'border-emerald-200/80 bg-emerald-50'
      }`}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b px-4 py-3 ${
          tone === 'plan'
            ? 'border-sky-200/60 bg-sky-100/50'
            : 'border-emerald-200/60 bg-emerald-100/40'
        }`}
      >
        <div>
          <h3
            className={`text-sm font-bold uppercase tracking-[0.15em] ${
              tone === 'plan' ? 'text-sky-900' : 'text-emerald-900'
            }`}
          >
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-stone-600">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {headerAction}
          <span
            className={`rounded-sm px-2.5 py-0.5 text-[10px] font-bold uppercase ${
              tone === 'plan'
                ? 'bg-sky-200/80 text-sky-900'
                : 'bg-emerald-200/80 text-emerald-900'
            }`}
          >
            {tone === 'plan' ? t('section.editable') : t('section.factOut')}
          </span>
        </div>
      </div>
      {children}
    </section>
  )
}

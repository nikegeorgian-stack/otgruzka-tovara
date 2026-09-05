import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { AppDownloadCards } from '@/components/web/AppDownloadCards'
import { EDA_ORDERS_URL } from '@/lib/externalApps'
import { useI18n } from '@/context/I18nContext'

type Props = {
  /** Компактный блок для сайдбара / меню */
  variant?: 'login' | 'footer'
  className?: string
}

export function AboutAppBlock({ variant = 'footer', className = '' }: Props) {
  const { t } = useI18n()

  if (variant === 'login') {
    return (
      <div className={`mt-6 border-t border-stone-200 pt-5 ${className}`}>
        <p className="text-center text-xs font-semibold text-stone-600">{t('about.title')}</p>
        <p className="mt-1 text-center text-[11px] leading-relaxed text-stone-500">
          {t('about.blurb')}
        </p>
        <a
          href={EDA_ORDERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-[2.5rem] w-full items-center justify-center rounded-sm border border-orange-200 bg-orange-50/80 px-3 py-2 text-sm font-semibold text-orange-950 hover:bg-orange-100"
        >
          {t('about.edaOrders')}
        </a>
        <p className="mb-2 mt-4 text-center text-[10px] font-bold uppercase tracking-wider text-stone-400">
          {t('about.downloadTitle')}
        </p>
        <AppDownloadCards density="login" />
        <p className="mt-2 text-center text-[10px] text-stone-400">{t('about.downloadHint')}</p>
      </div>
    )
  }

  return (
    <div className={`rounded-sm border border-grid/80 bg-stone-50/80 px-3 py-2.5 ${className}`}>
      <FiberCellBrand variant="page" className="mb-2 origin-left scale-90" />
      <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
        {t('about.title')}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-stone-600">{t('about.blurb')}</p>
      <a
        href={EDA_ORDERS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex text-xs font-semibold text-orange-800 underline-offset-2 hover:underline"
      >
        {t('about.edaOrders')}
      </a>
      <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wider text-stone-400">
        {t('about.downloadTitle')}
      </p>
      <AppDownloadCards density="compact" />
    </div>
  )
}

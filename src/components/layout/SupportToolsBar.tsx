import { useEffect, useRef, useState } from 'react'
import { useCoach } from '@/context/CoachContext'
import { useI18n } from '@/context/I18nContext'
import { useSupportChromeOptional } from '@/context/SupportChromeContext'
import { EDA_ORDERS_URL } from '@/lib/externalApps'
import { fstApkHref, fstWindowsHref, isNativeAppShell } from '@/lib/appDownload'

type Props = {
  /** Показывать пункт журнала писем (sysadmin). */
  showMail?: boolean
  /** Sysadmin: объявить плановое обновление на 5 минут. */
  onAnnounceMaintenance?: () => void
  /** Ссылки Android / Windows / заказы еды (веб). */
  showDownloads?: boolean
  /** Свёрнутый сайдбар — одна иконка, меню вправо. */
  compact?: boolean
  className?: string
  /** После выбора пункта — закрыть mobile drawer. */
  onAfterOpen?: () => void
}

/**
 * Одна кнопка «Поддержка» в хроме сайдбара (липкий низ панели).
 * Не плавает над табелем; пункты — в выпадающем меню.
 */
export function SupportToolsBar({
  showMail = false,
  onAnnounceMaintenance,
  showDownloads = false,
  compact = false,
  className = '',
  onAfterOpen,
}: Props) {
  const { t } = useI18n()
  const coach = useCoach()
  const support = useSupportChromeOptional()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const hideApk = isNativeAppShell()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!support) return null

  const badge = showMail ? support.mailBadge : support.feedbackReplyBadge

  function run(action: () => void) {
    setOpen(false)
    action()
    onAfterOpen?.()
  }

  const itemClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-ink hover:bg-stone-100'
  const linkClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-semibold text-ink hover:bg-stone-100'

  return (
    <div
      ref={rootRef}
      className={`app-sidebar__support relative ${className}`}
      role="group"
      aria-label={t('support.tools')}
    >
      <button
        type="button"
        className={
          compact
            ? 'relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-stone-300/80 bg-white text-ink shadow-sm transition-[background-color,box-shadow] hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
            : 'relative flex w-full items-center justify-center gap-1.5 rounded-lg border border-stone-300/80 bg-white px-2.5 py-2 text-xs font-semibold leading-none text-ink shadow-sm transition-[background-color,box-shadow] hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
        }
        title={t('support.open')}
        aria-label={t('support.open')}
        aria-expanded={open}
        aria-haspopup="menu"
        data-coach="support:open"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-sm font-black leading-none text-red-700" aria-hidden>
          ?
        </span>
        {!compact ? <span className="truncate">{t('support.open')}</span> : null}
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-0.5 text-[9px] font-bold text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className={
            compact
              ? 'absolute bottom-0 left-full z-[420] ml-2 w-52 rounded-lg border border-stone-200 bg-white p-1 shadow-lg'
              : 'absolute bottom-full left-0 right-0 z-[420] mb-1.5 rounded-lg border border-stone-200 bg-white p-1 shadow-lg'
          }
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-400">
            {t('support.menuHint')}
          </p>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            data-coach="coach:open"
            onClick={() =>
              run(() => {
                coach.setPanelMode('guides')
                coach.setOpen(true)
              })
            }
          >
            <span className="w-4 text-center font-black text-red-700" aria-hidden>
              ?
            </span>
            {t('support.helpShort')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            data-coach="feedback:open"
            onClick={() => run(() => support.requestOpenFeedback())}
          >
            <span className="w-4 text-center font-bold text-amber-800" aria-hidden>
              !
            </span>
            {t('feedback.fabShort')}
            {!showMail && support.feedbackReplyBadge > 0 ? (
              <span className="ml-auto rounded-full bg-teal-600 px-1.5 text-[10px] font-bold text-white">
                {support.feedbackReplyBadge > 9 ? '9+' : support.feedbackReplyBadge}
              </span>
            ) : null}
          </button>
          {showMail ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => run(() => support.requestOpenMail())}
            >
              <span className="relative w-4 text-center" aria-hidden>
                ✉
                {badge > 0 ? (
                  <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-red-600" />
                ) : null}
              </span>
              {t('support.mailShort')}
            </button>
          ) : null}
          {onAnnounceMaintenance ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => run(onAnnounceMaintenance)}
            >
              <span className="w-4 text-center font-bold text-amber-700" aria-hidden>
                ⏱
              </span>
              {t('maintenance.announce5min')}
            </button>
          ) : null}

          {showDownloads ? (
            <>
              <div className="my-1 border-t border-stone-100" />
              <p className="px-2.5 pb-0.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-stone-400">
                {t('about.downloadTitle')}
              </p>
              {!hideApk ? (
                <a
                  role="menuitem"
                  className={linkClass}
                  href={fstApkHref()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <span className="w-4 text-center text-[10px] font-bold text-emerald-700" aria-hidden>
                    A
                  </span>
                  <span className="min-w-0 truncate">{t('about.downloadApk')}</span>
                </a>
              ) : null}
              <a
                role="menuitem"
                className={linkClass}
                href={fstWindowsHref()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span className="w-4 text-center text-[10px] font-bold text-sky-700" aria-hidden>
                  W
                </span>
                <span className="min-w-0 truncate">{t('about.downloadWindows')}</span>
              </a>
              <a
                role="menuitem"
                className={linkClass}
                href={EDA_ORDERS_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <span className="w-4 text-center text-orange-700" aria-hidden>
                  ✦
                </span>
                <span className="min-w-0 truncate">{t('about.edaOrders')}</span>
              </a>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

import { BRAND } from '@/lib/brand'
import { fstApkHref, fstWindowsHref, isNativeAppShell } from '@/lib/appDownload'
import { useI18n } from '@/context/I18nContext'

type Platform = 'android' | 'windows'

function PlatformGlyph({ platform }: { platform: Platform }) {
  if (platform === 'android') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
        <path d="M17.6 9.48l1.84-3.18a.5.5 0 10-.87-.5l-1.86 3.22A7.9 7.9 0 0012 8c-1.7 0-3.27.53-4.71 1.52L5.43 5.8a.5.5 0 10-.87.5L6.4 9.48C4.34 10.95 3 13.3 3 16v.5h18V16c0-2.7-1.34-5.05-3.4-6.52zM8.5 14.25a1 1 0 110-2 1 1 0 010 2zm7 0a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden fill="currentColor">
      <path d="M3 5.5A1.5 1.5 0 014.5 4H11v7H3V5.5zm0 8.5h8v7H4.5A1.5 1.5 0 013 19.5V14zm10-10h6.5A1.5 1.5 0 0121 5.5V11h-8V4zm0 10h8v5.5a1.5 1.5 0 01-1.5 1.5H13v-7z" />
    </svg>
  )
}

function DownloadCard({
  platform,
  href,
  title,
  subtitle,
  downloadName,
}: {
  platform: Platform
  href: string
  title: string
  subtitle: string
  downloadName?: string
}) {
  const accent =
    platform === 'android'
      ? 'border-emerald-200/90 from-emerald-50/90 to-white hover:border-emerald-400 hover:shadow-emerald-900/5'
      : 'border-sky-200/90 from-sky-50/90 to-white hover:border-sky-400 hover:shadow-sky-900/5'
  const chip =
    platform === 'android' ? 'bg-emerald-600 text-white' : 'bg-sky-700 text-white'

  return (
    <a
      href={href}
      download={downloadName}
      target={downloadName ? undefined : '_blank'}
      rel={downloadName ? undefined : 'noopener noreferrer'}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-gradient-to-br px-3 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${accent}`}
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/5"
        aria-hidden
      >
        <img src={BRAND.mark} alt="" className="h-8 w-8 object-contain" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip}`}>
            <PlatformGlyph platform={platform} />
            {platform === 'android' ? 'Android' : 'Windows'}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm font-semibold text-stone-900">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-stone-500">{subtitle}</span>
      </span>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--fc-accent,#ff5500)] text-white shadow-sm transition group-hover:scale-105"
        style={{ ['--fc-accent' as string]: BRAND.accent }}
        aria-hidden
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  )
}

type Props = {
  className?: string
  /** login — крупные карточки; compact — в сайдбаре */
  density?: 'login' | 'compact'
}

/** Карточки скачивания APK / Windows с логотипом FiberCell. */
export function AppDownloadCards({ className = '', density = 'login' }: Props) {
  const { t } = useI18n()
  const showApk = !isNativeAppShell()
  const gap = density === 'login' ? 'gap-2.5' : 'gap-2'

  return (
    <div className={`flex flex-col ${gap} ${className}`}>
      {showApk && (
        <DownloadCard
          platform="android"
          href={fstApkHref()}
          downloadName="fst-fibercell.apk"
          title={t('about.downloadApk')}
          subtitle={t('about.downloadApkSub')}
        />
      )}
      <DownloadCard
        platform="windows"
        href={fstWindowsHref()}
        title={t('about.downloadWindows')}
        subtitle={t('about.downloadWindowsSub')}
      />
    </div>
  )
}

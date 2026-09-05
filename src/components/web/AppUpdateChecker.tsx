import { useEffect, useState } from 'react'
import { apkDownloadHref, checkApkUpdateAvailable, type AppVersionManifest } from '@/lib/appUpdate'
import { isNativeAppShell } from '@/lib/appDownload'
import { useI18n } from '@/context/I18nContext'

const SESSION_DISMISS_KEY = 'fst-apk-update-dismiss'

/** В APK: проверяет app-version.json и предлагает скачать новую сборку. */
export function AppUpdateChecker() {
  const { t, tf } = useI18n()
  const [manifest, setManifest] = useState<AppVersionManifest | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isNativeAppShell()) return

    let cancelled = false

    async function run() {
      const dismissed = sessionStorage.getItem(SESSION_DISMISS_KEY)
      const result = await checkApkUpdateAvailable()
      if (cancelled || !result.updateAvailable || !result.manifest) return
      if (dismissed === String(result.manifest.apkVersionCode)) return
      setManifest(result.manifest)
      setVisible(true)
    }

    void run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void run()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void run(), 6 * 60 * 60 * 1000)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])

  if (!visible || !manifest) return null

  return (
    <div
      className="fixed inset-x-0 bottom-16 z-[350] px-3 sm:bottom-[4.5rem] sm:px-4 lg:left-56"
      role="status"
    >
      <div className="mx-auto flex max-w-lg items-start gap-3 rounded-2xl border border-sky-200 bg-white/95 p-3 shadow-lg shadow-sky-900/10 backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-900">{t('appUpdate.title')}</p>
          <p className="mt-0.5 text-xs text-stone-600">
            {tf('appUpdate.body', { version: manifest.apkVersionName })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <a
            href={apkDownloadHref(manifest)}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
          >
            {t('appUpdate.download')}
          </a>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-[11px] text-stone-500 hover:bg-stone-100"
            onClick={() => {
              sessionStorage.setItem(SESSION_DISMISS_KEY, String(manifest.apkVersionCode))
              setVisible(false)
            }}
          >
            {t('appUpdate.later')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import {
  clearRsCredentials,
  fetchRsCredentialsStatus,
  saveRsCredentials,
  verifyRsCredentials,
  type RsCredentialsStatus,
} from '@/lib/hr/rsGeClient'

const sectionClass = 'rounded-sm border border-grid bg-white p-5 shadow-sm'

export function RsGeSettingsPanel() {
  const { t } = useI18n()
  const [status, setStatus] = useState<RsCredentialsStatus | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  )

  async function refresh() {
    const res = await fetchRsCredentialsStatus()
    if (res.ok) setStatus(res.status)
    else setStatus({ configured: false })
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function runVerify(): Promise<boolean> {
    const v = await verifyRsCredentials()
    if (v.authOk) {
      setNotice({ type: 'success', message: t('settings.rs.verifyOk') })
      return true
    }
    const detail = v.detail ? ` (${v.detail})` : ''
    const key = v.error ? `settings.rs.err.${v.error}` : 'settings.rs.err.verify_failed'
    const base = t(key)
    setNotice({
      type: 'error',
      message: `${base === key ? t('settings.rs.err.verify_failed') : base}${detail}`,
    })
    return false
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim()) {
      setNotice({ type: 'error', message: t('settings.rs.err.invalid_username') })
      return
    }
    if (!password) {
      setNotice({ type: 'error', message: t('settings.rs.err.password_required') })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const res = await saveRsCredentials({ username, password })
      if (!res.ok) {
        setNotice({ type: 'error', message: t(`settings.rs.err.${res.error}`) })
        return
      }
      setStatus(res.status)
      setPassword('')
      await refresh()
      const ok = await runVerify()
      if (ok) {
        setNotice({ type: 'success', message: t('settings.rs.savedAndVerified') })
      }
    } catch {
      setNotice({ type: 'error', message: t('settings.rs.err.network') })
    } finally {
      setLoading(false)
    }
  }

  async function onVerifyClick() {
    setLoading(true)
    setNotice(null)
    try {
      await runVerify()
    } catch {
      setNotice({ type: 'error', message: t('settings.rs.err.network') })
    } finally {
      setLoading(false)
    }
  }

  async function onClear() {
    setLoading(true)
    setNotice(null)
    try {
      const res = await clearRsCredentials()
      if (!res.ok) {
        setNotice({ type: 'error', message: t(`settings.rs.err.${res.error}`) })
        return
      }
      setStatus({ configured: false })
      setUsername('')
      setPassword('')
      setNotice({ type: 'success', message: t('settings.rs.cleared') })
    } catch {
      setNotice({ type: 'error', message: t('settings.rs.err.network') })
    } finally {
      setLoading(false)
    }
  }

  const locked = status?.lockedByEnv === true

  return (
    <section className={sectionClass}>
      <h2 className="text-sm font-bold text-ink">{t('settings.rs.title')}</h2>
      <p className="mt-1 text-xs text-stone-500">{t('settings.rs.hint')}</p>
      <p className="mt-1 text-xs font-medium text-amber-700">🔒 {t('settings.rs.security')}</p>

      {notice && (
        <div className="mt-3">
          <FormNotice type={notice.type} message={notice.message} />
        </div>
      )}

      <div className="mt-3 rounded-sm border border-grid bg-stone-50 px-3 py-2 text-xs text-stone-600">
        {status?.configured ? (
          <>
            <span className="font-semibold text-emerald-800">{t('settings.rs.statusOk')}</span>
            {status.usernameMasked ? (
              <span className="ml-2">
                {t('settings.rs.login')}: {status.usernameMasked}
              </span>
            ) : null}
            {status.source ? (
              <span className="ml-2 text-stone-400">({t(`settings.rs.source.${status.source}`)})</span>
            ) : null}
          </>
        ) : (
          <span className="font-semibold text-amber-800">{t('settings.rs.statusOff')}</span>
        )}
      </div>

      {locked ? (
        <p className="mt-3 text-xs text-stone-500">{t('settings.rs.envLocked')}</p>
      ) : (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onSave}>
          <label className="block text-xs font-medium text-stone-600">
            {t('settings.rs.login')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={status?.usernameMasked || t('settings.rs.loginPlaceholder')}
              required
            />
          </label>
          <label className="block text-xs font-medium text-stone-600">
            {t('settings.rs.password')}
            <input
              type="password"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('settings.rs.passwordPlaceholder')}
              required
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="rounded-sm bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
            >
              {loading ? t('settings.rs.saving') : t('settings.rs.save')}
            </button>
            {status?.configured ? (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onVerifyClick()}
                  className="rounded-sm border border-grid px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  {t('settings.rs.verify')}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void onClear()}
                  className="rounded-sm border border-grid px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                >
                  {t('settings.rs.clear')}
                </button>
              </>
            ) : null}
          </div>
        </form>
      )}
    </section>
  )
}

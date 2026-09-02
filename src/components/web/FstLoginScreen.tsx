import { useEffect, useState } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { AboutAppBlock } from '@/components/web/AboutAppBlock'
import { useFstAuth } from '@/context/FstAuthContext'
import { useI18n } from '@/context/I18nContext'
import {
  biometricErrorMessage,
  hasBiometricRegistration,
  isBiometricSupported,
  isPlatformAuthenticatorAvailable,
  loginWithBiometric,
  registerBiometric,
} from '@/lib/cloud/fstBiometric'
import {
  clearRememberedAccount,
  canRememberPasswordOnThisDevice,
  loadRememberedAccount,
  saveRememberedAccount,
} from '@/lib/cloud/fstRememberAccount'
import { EDA_ORDERS_URL } from '@/lib/externalApps'

export function FstLoginScreen() {
  const { login, configured } = useFstAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bioAvailable, setBioAvailable] = useState(false)
  const [bioRegistered, setBioRegistered] = useState(false)
  const [enableBio, setEnableBio] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const registered = hasBiometricRegistration()
      if (cancelled) return
      setBioRegistered(registered)
      if (!registered) {
        setBioAvailable(await isPlatformAuthenticatorAvailable())
      } else {
        setBioAvailable(isBiometricSupported() && registered)
      }

      const saved = await loadRememberedAccount()
      if (cancelled || !saved) return
      setEmail(saved.email)
      if (saved.password) {
        setPassword(saved.password)
        setRemember(true)
      } else if (saved.email) {
        setRemember(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
        <div className="max-w-md rounded-sm border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-ink">{t('web.login.firebaseSetupTitle')}</h1>
          <p className="mt-3 text-sm text-stone-600">{t('web.login.firebaseSetupHint')}</p>
        </div>
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email, password)
      if (remember) {
        await saveRememberedAccount({
          email,
          password,
          rememberPassword: canRememberPasswordOnThisDevice(),
        })
      } else {
        clearRememberedAccount()
      }
      if (enableBio && bioAvailable && !bioRegistered) {
        try {
          await registerBiometric(email, password)
          setBioRegistered(true)
        } catch (bioErr) {
          console.warn('FST biometric registration skipped', bioErr)
        }
      }
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code: string }).code)
          : ''
      if (code.includes('invalid-credential') || code.includes('wrong-password')) {
        setError(t('web.login.invalidCredentials'))
      } else {
        setError(t('web.login.failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitBiometric() {
    setError(null)
    setBusy(true)
    try {
      const creds = await loginWithBiometric()
      await login(creds.email, creds.password)
    } catch (err) {
      setError(biometricErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-900 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-sm border border-white/10 bg-white/95 p-6 shadow-sm backdrop-blur sm:p-8"
      >
        <FiberCellBrand variant="page" className="mb-4" />
        <h1 className="text-2xl font-bold text-ink">{t('web.login.title')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('web.login.subtitle')}</p>

        <a
          href={EDA_ORDERS_URL}
          target="_blank"
          rel="noopener noreferrer"
          title={t('web.login.edaOrdersHint')}
          className="mt-5 flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-sm border border-orange-300 bg-orange-50 px-3 py-2.5 text-sm font-semibold text-orange-950 hover:bg-orange-100"
        >
          {t('web.login.edaOrders')}
          <span aria-hidden className="text-orange-700/80">
            ↗
          </span>
        </a>
        <p className="mt-1.5 text-center text-[11px] text-stone-400">{t('web.login.edaOrdersHint')}</p>

        {bioRegistered && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitBiometric()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-sm border border-teal-200 bg-teal-50 py-3 text-sm font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"
          >
            <span aria-hidden className="text-lg">
              👤
            </span>
            {t('web.login.biometric')}
          </button>
        )}

        {bioRegistered && (
          <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-stone-400">
            {t('web.login.orPassword')}
          </p>
        )}

        <label className="mt-6 block text-xs font-semibold text-stone-500">
          {t('web.login.email')}
          <input
            type="email"
            required
            autoComplete="username"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold text-stone-500">
          {t('web.login.password')}
          <input
            type="password"
            required
            minLength={8}
            autoComplete="current-password"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>
            {canRememberPasswordOnThisDevice()
              ? t('web.login.remember')
              : t('web.login.rememberEmail')}
            <span className="mt-0.5 block text-[11px] text-stone-400">
              {canRememberPasswordOnThisDevice()
                ? t('web.login.rememberHint')
                : t('web.login.rememberEmailHint')}
            </span>
          </span>
        </label>

        {bioAvailable && !bioRegistered && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enableBio}
              onChange={(e) => setEnableBio(e.target.checked)}
            />
            <span>{t('web.login.enableBiometric')}</span>
          </label>
        )}

        {error && (
          <p className="mt-3 rounded-sm bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 min-h-[3rem] w-full rounded-sm bg-teal-700 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50 sm:py-2.5 sm:text-sm"
        >
          {busy ? t('web.login.busy') : t('web.login.submit')}
        </button>

        {bioAvailable && (
          <p className="mt-3 text-center text-[11px] text-stone-400">{t('web.login.biometricHint')}</p>
        )}

        <AboutAppBlock variant="login" />
      </form>
    </div>
  )
}

import { useEffect, useState } from 'react'
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

export function FstLoginScreen() {
  const { login, configured } = useFstAuth()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
        return
      }
      setBioAvailable(isBiometricSupported() && registered)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100 p-6">
        <div className="max-w-md rounded-sm border border-red-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-ink">FST — настройка Firebase</h1>
          <p className="mt-3 text-sm text-stone-600">
            Добавьте переменные <code className="text-xs">VITE_FIREBASE_*</code> в Vercel /{' '}
            <code className="text-xs">fst-web/.env</code>. См.{' '}
            <code className="text-xs">fst-web/.env.example</code>.
          </p>
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
      if (enableBio && bioAvailable && !bioRegistered) {
        try {
          await registerBiometric(email, password)
          setBioRegistered(true)
        } catch (bioErr) {
          console.warn('FST biometric registration skipped', bioErr)
        }
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
      if (code.includes('invalid-credential') || code.includes('wrong-password')) {
        setError('Неверный email или пароль администратора.')
      } else {
        setError('Не удалось войти. Проверьте email и пароль.')
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
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-teal-700">FST</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{t('web.login.title')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('web.login.subtitle')}</p>

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
            Face ID / Touch ID
          </button>
        )}

        {bioRegistered && (
          <p className="mt-4 text-center text-[10px] uppercase tracking-widest text-stone-400">
            или пароль
          </p>
        )}

        <label className="mt-6 block text-xs font-semibold text-stone-500">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold text-stone-500">
          Пароль
          <input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {bioAvailable && !bioRegistered && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enableBio}
              onChange={(e) => setEnableBio(e.target.checked)}
            />
            <span>Включить Face ID / Touch ID на этом устройстве</span>
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
          {busy ? '…' : 'Войти по паролю'}
        </button>

        {bioAvailable && (
          <p className="mt-3 text-center text-[11px] text-stone-400">
            Face ID работает только на этом телефоне / компьютере
          </p>
        )}
      </form>
    </div>
  )
}

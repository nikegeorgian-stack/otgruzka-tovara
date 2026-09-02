import { useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  type User,
} from 'firebase/auth'
import { useI18n } from '@/context/I18nContext'
import { getFirebaseAuth } from '@/lib/cloud/firebase'

type Props = {
  email: string
  onComplete: (password: string) => Promise<void>
  /** Пароль уже сменён ранее, остался claim — только снять блокировку. */
  onClearLock?: () => Promise<void>
}

export function FstChangePasswordScreen({ email, onComplete, onClearLock }: Props) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [needReauth, setNeedReauth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reauthIfNeeded(user: User): Promise<void> {
    const current = currentPassword.trim()
    if (!current) throw new Error('requires_recent_login')
    const cred = EmailAuthProvider.credential(email.trim(), current)
    await reauthenticateWithCredential(user, cred)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError(t('web.changePassword.tooShort'))
      return
    }
    if (password !== confirm) {
      setError(t('web.changePassword.mismatch'))
      return
    }
    if (needReauth && !currentPassword.trim()) {
      setError(t('web.changePassword.needCurrent'))
      return
    }
    setBusy(true)
    try {
      const user = getFirebaseAuth().currentUser
      if (needReauth && user) {
        await reauthIfNeeded(user)
      }
      await onComplete(password)
    } catch (err) {
      const code =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'code' in err
            ? String((err as { code?: string }).code)
            : ''
      if (
        code === 'requires_recent_login' ||
        code === 'auth/requires-recent-login'
      ) {
        setNeedReauth(true)
        setError(t('web.changePassword.needCurrent'))
      } else if (code === 'clear_must_change_failed') {
        setError(t('web.changePassword.clearFailed'))
      } else if (code === 'password_too_short') {
        setError(t('web.changePassword.tooShort'))
      } else {
        setError(t('web.changePassword.failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-900 px-4 py-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-sm border border-white/10 bg-white/95 p-6 shadow-sm backdrop-blur sm:p-8"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-teal-700">FST</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">{t('web.changePassword.title')}</h1>
        <p className="mt-2 text-sm text-stone-600">{t('web.changePassword.subtitle')}</p>
        <p className="mt-1 font-mono text-xs text-stone-500">{email}</p>

        {needReauth ? (
          <label className="mt-6 block text-xs font-semibold text-stone-500">
            {t('web.changePassword.current')}
            <input
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
        ) : null}

        <label className={`block text-xs font-semibold text-stone-500 ${needReauth ? 'mt-3' : 'mt-6'}`}>
          {t('web.changePassword.new')}
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-xs font-semibold text-stone-500">
          {t('access.passwordConfirm')}
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-3 text-base sm:py-2.5 sm:text-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>

        {error ? (
          <p className="mt-3 rounded-sm bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 min-h-[3rem] w-full rounded-sm bg-teal-700 py-3 text-base font-semibold text-white hover:bg-teal-800 disabled:opacity-50 sm:py-2.5 sm:text-sm"
        >
          {busy ? '…' : t('web.changePassword.submit')}
        </button>

        {onClearLock ? (
          <button
            type="button"
            disabled={busy}
            className="mt-3 w-full text-center text-xs font-medium text-stone-500 underline hover:text-ink disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setError(null)
                setBusy(true)
                try {
                  await onClearLock()
                } catch (err) {
                  const code = err instanceof Error ? err.message : ''
                  setError(
                    code === 'clear_must_change_failed'
                      ? t('web.changePassword.clearFailed')
                      : t('web.changePassword.failed'),
                  )
                } finally {
                  setBusy(false)
                }
              })()
            }}
          >
            {t('web.changePassword.alreadyDone')}
          </button>
        ) : null}
      </form>
    </div>
  )
}

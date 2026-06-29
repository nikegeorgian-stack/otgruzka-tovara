import { useState } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type Props = {
  onLogin: (login: string, password: string) => Promise<boolean>
}

export function LoginScreen({ onLogin }: Props) {
  const { t } = useI18n()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const ok = await onLogin(login.trim(), password)
      if (!ok) setError(t('access.wrongCredentials'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-sm border border-grid bg-white p-6 shadow-sm">
        <FiberCellBrand variant="sidebar" className="mb-4" />
        <h1 className="text-xl font-bold text-ink">{t('access.loginTitle')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('access.loginSubtitle')}</p>

        <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
          <label className="block text-xs font-medium text-stone-600">
            {t('access.login')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2.5 text-sm"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label className="block text-xs font-medium text-stone-600">
            {t('access.password')}
            <input
              type="password"
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2.5 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="rounded-sm bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t('access.signingIn') : t('common.login')}
          </Button>
        </form>
      </div>
    </div>
  )
}

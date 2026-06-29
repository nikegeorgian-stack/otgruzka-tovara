import { useState, type ReactNode } from 'react'
import { FstAuthProvider } from '@/context/FstAuthContext'
import { I18nProvider } from '@/context/I18nContext'
import { FstWebSessionProvider } from '@/context/FstWebSessionContext'
import { FstWebAuthGate } from '@/components/web/FstWebAuthGate'
import App from '@/App'
import type { Locale } from '@/i18n'

/** i18n для экрана входа (вне App) и оболочки web. */
function FstWebI18n({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ru')
  return (
    <I18nProvider locale={locale} setLocale={setLocale}>
      {children}
    </I18nProvider>
  )
}

export function FstWebRoot() {
  return (
    <FstWebI18n>
      <FstAuthProvider>
        <FstWebAuthGate>
          <FstWebSessionProvider>
            <App />
          </FstWebSessionProvider>
        </FstWebAuthGate>
      </FstAuthProvider>
    </FstWebI18n>
  )
}

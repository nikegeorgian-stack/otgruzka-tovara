import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import type { AppUser } from '@/lib/access/types'
import {
  greetingFirstName,
  markWelcomeShown,
  pickWelcomeMessageIndex,
  wasWelcomeShown,
} from '@/lib/greetings/welcomeMessage'
import type { Employee } from '@/lib/types'

type Props = {
  user: AppUser
  employees: Employee[]
}

export function WelcomeGreeting({ user, employees }: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState(false)

  const firstName = useMemo(() => greetingFirstName(user, employees), [user, employees])
  const messageIndex = useMemo(() => pickWelcomeMessageIndex(user.id), [user.id])
  const message = tf(`welcome.msg.${messageIndex}`, { name: firstName })

  useEffect(() => {
    if (!user.active || wasWelcomeShown(user.id)) return
    const timer = window.setTimeout(() => setOpen(true), 400)
    return () => window.clearTimeout(timer)
  }, [user.id, user.active])

  if (!open) return null

  function dismiss() {
    markWelcomeShown(user.id)
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/35 p-4 print:hidden">
      <div
        className="w-full max-w-md rounded-sm border border-grid bg-white p-6 shadow-lg"
        role="dialog"
        aria-labelledby="welcome-greeting-title"
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-accent">FiberCell</p>
        <h2 id="welcome-greeting-title" className="mt-2 text-xl font-bold text-ink">
          {tf('welcome.title', { name: firstName })}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-stone-700">{message}</p>
        <div className="mt-6 flex justify-end">
          <Button variant="primary" size="sm" onClick={dismiss}>
            {t('welcome.cta')}
          </Button>
        </div>
      </div>
    </div>
  )
}

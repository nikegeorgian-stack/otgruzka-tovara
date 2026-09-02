import { useEffect, useState } from 'react'
import { useI18n } from '@/context/I18nContext'

/** Красивый чайник + напоминание про 16:00 для главного инженера. */
export function EngineerTeaReminder() {
  const { t } = useI18n()
  const [teaTime, setTeaTime] = useState(() => isTeaWindow(new Date()))

  useEffect(() => {
    const tick = () => setTeaTime(isTeaWindow(new Date()))
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <aside
      className={`relative overflow-hidden rounded-sm border px-4 py-3 sm:px-5 ${
        teaTime
          ? 'border-amber-400/80 bg-gradient-to-r from-amber-50 via-orange-50 to-stone-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]'
          : 'border-amber-200/70 bg-gradient-to-r from-amber-50/80 to-stone-50'
      }`}
      aria-live="polite"
    >
      <div
        className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-amber-200/30 blur-2xl"
        aria-hidden
      />
      <div className="relative flex items-center gap-4">
        <TeaPotSvg active={teaTime} />
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-bold tracking-wide sm:text-base ${
              teaTime ? 'text-amber-900' : 'text-amber-950/90'
            }`}
          >
            {t('engineerLog.teaTitle')}
          </p>
          <p className="mt-0.5 text-xs text-amber-900/70 sm:text-sm">{t('engineerLog.teaHint')}</p>
        </div>
        <span
          className={`shrink-0 rounded-sm px-2.5 py-1 font-mono text-sm font-bold tabular-nums ${
            teaTime
              ? 'bg-amber-500 text-white shadow-sm'
              : 'bg-white/80 text-amber-800 ring-1 ring-amber-200'
          }`}
        >
          16:00
        </span>
      </div>
    </aside>
  )
}

/** Окно «почти чай»: 15:45–16:30 */
function isTeaWindow(now: Date): boolean {
  const mins = now.getHours() * 60 + now.getMinutes()
  return mins >= 15 * 60 + 45 && mins < 16 * 60 + 30
}

function TeaPotSvg({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 72 64"
      className={`h-14 w-16 shrink-0 drop-shadow-sm sm:h-16 sm:w-[4.5rem] ${
        active ? 'animate-[tea-steam_2.4s_ease-in-out_infinite]' : ''
      }`}
      aria-hidden
    >
      <defs>
        <linearGradient id="teapotBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="45%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id="teapotLid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      {/* steam */}
      <path
        d="M30 10c0-4 3-6 3-10"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity={active ? 0.85 : 0.35}
      />
      <path
        d="M36 8c0-5 4-7 4-12"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity={active ? 0.7 : 0.25}
      />
      <path
        d="M42 10c0-4 3-6 3-10"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity={active ? 0.85 : 0.35}
      />
      {/* handle */}
      <path
        d="M52 28c8 0 12 6 12 12s-4 12-12 12"
        fill="none"
        stroke="#92400e"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/* spout */}
      <path
        d="M18 34c-8 0-12-4-14-10 6 2 10 4 14 8z"
        fill="url(#teapotBody)"
        stroke="#92400e"
        strokeWidth="1.2"
      />
      {/* body */}
      <ellipse
        cx="36"
        cy="42"
        rx="18"
        ry="14"
        fill="url(#teapotBody)"
        stroke="#92400e"
        strokeWidth="1.4"
      />
      <ellipse cx="36" cy="34" rx="16" ry="5" fill="#fde68a" opacity="0.55" />
      {/* lid */}
      <ellipse
        cx="36"
        cy="28"
        rx="12"
        ry="4"
        fill="url(#teapotLid)"
        stroke="#92400e"
        strokeWidth="1.2"
      />
      <circle cx="36" cy="24" r="2.4" fill="#b45309" stroke="#78350f" strokeWidth="0.8" />
      {/* foot */}
      <ellipse cx="36" cy="55" rx="10" ry="2.2" fill="#92400e" opacity="0.35" />
      <style>{`
        @keyframes tea-steam {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
      `}</style>
    </svg>
  )
}

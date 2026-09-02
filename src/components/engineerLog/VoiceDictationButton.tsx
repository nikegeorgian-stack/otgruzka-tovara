import { useCallback, useState } from 'react'
import { intlLocale } from '@/i18n/localeFormat'
import { useI18n } from '@/context/I18nContext'
import { isVoiceSupported, useVoiceRecognition } from '@/hooks/useVoiceRecognition'

type Props = {
  onText: (text: string) => void
  lang?: string
  className?: string
}

/** Диктовка в текстовое поле (не голосовые команды приложения). */
export function VoiceDictationButton({ onText, lang, className = '' }: Props) {
  const { t, locale } = useI18n()
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const speechLang = lang ?? (intlLocale(locale))
  const supported = isVoiceSupported()

  const onResult = useCallback(
    (text: string) => {
      onText(text)
    },
    [onText],
  )

  const { listening, interim, toggle, stop } = useVoiceRecognition({
    lang: speechLang,
    enabled: active,
    onResult,
    onError: (msg) => {
      setError(msg)
      setActive(false)
    },
  })

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title={t('engineerLog.voiceUnsupported')}
        className={`h-9 cursor-not-allowed rounded-sm border border-grid bg-paper px-2.5 text-xs text-stone-400 ${className}`}
      >
        {t('engineerLog.voice')}
      </button>
    )
  }

  return (
    <div className={`relative flex items-center ${className}`}>
      {(interim || error) && (
        <span
          className="absolute bottom-full left-0 z-10 mb-1 max-w-[16rem] truncate rounded-sm border border-grid bg-surface px-2 py-1 text-[10px] text-ink-muted shadow-sm"
          title={error || interim}
        >
          {error || `${interim}…`}
        </span>
      )}
      <button
        type="button"
        aria-pressed={active}
        title={active ? t('engineerLog.voiceStop') : t('engineerLog.voiceStart')}
        className={[
          'inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm border px-2.5 text-xs font-semibold transition-colors',
          active
            ? listening
              ? 'animate-pulse border-rose-400 bg-rose-500 text-white'
              : 'border-stone-700 bg-stone-800 text-white'
            : 'border-grid bg-surface text-ink hover:border-accent hover:text-accent',
        ].join(' ')}
        onClick={() => {
          setError('')
          if (active) {
            setActive(false)
            stop()
          } else {
            setActive(true)
            toggle()
          }
        }}
      >
        <MicIcon />
        <span className="hidden min-[400px]:inline">
          {active ? t('voice.listening') : t('engineerLog.voice')}
        </span>
      </button>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

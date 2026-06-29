import { useEffect, useRef, useState } from 'react'
import { useCoach } from '@/context/CoachContext'
import { useI18n } from '@/context/I18nContext'
import { targetLabel, viewLabel, type Locale } from '@/lib/ai/coachTargets'
import { CloseIcon, SparkleIcon } from '@/components/ui/icons'

export function CoachWidget() {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const {
    available,
    open,
    setOpen,
    messages,
    loading,
    error,
    send,
    startNewTopic,
    highlight,
    navigateTo,
    submitSuggestion,
  } = useCoach()
  const [input, setInput] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestText, setSuggestText] = useState('')
  const [suggestSent, setSuggestSent] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open])

  if (!available) return null

  const starters = [
    t('coach.starter1'),
    t('coach.starter2'),
    t('coach.starter3'),
    t('coach.starter4'),
  ]

  if (!open) {
    return (
      <button
        type="button"
        title={t('coach.open')}
        aria-label={t('coach.open')}
        className="fixed bottom-5 right-5 z-[91] flex h-14 w-14 items-center justify-center rounded-sm bg-violet-700 text-white shadow-sm transition-shadow hover:shadow-sm print:hidden"
        onClick={() => setOpen(true)}
      >
        <SparkleIcon size={24} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-[91] flex h-[min(34rem,calc(100vh-2.5rem))] w-[min(25rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-sm border border-grid bg-white shadow-sm print:hidden">
      <header className="flex items-center justify-between border-b border-grid bg-stone-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('coach.title')}</h3>
          <p className="text-[10px] text-stone-500">{t('coach.subtitle')}</p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-violet-600 hover:bg-white/80"
            onClick={() => {
              setSuggestSent(false)
              setSuggestOpen((v) => !v)
            }}
          >
            {t('coach.suggestBtn')}
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-white/80"
            onClick={startNewTopic}
          >
            {t('coach.newTopic')}
          </button>
          <button
            type="button"
            aria-label={t('common.close')}
            className="rounded px-2 py-1 leading-none text-stone-400 hover:bg-white/80"
            onClick={() => setOpen(false)}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </header>

      {suggestOpen && (
        <div className="border-b border-grid bg-violet-50/60 p-3">
          <p className="mb-1 text-xs font-medium text-violet-800">{t('coach.suggestTitle')}</p>
          {suggestSent ? (
            <p className="text-xs text-teal-700">{t('coach.suggestThanks')}</p>
          ) : (
            <>
              <textarea
                className="w-full resize-none rounded-sm border border-violet-200 px-3 py-2 text-sm"
                rows={3}
                placeholder={t('coach.suggestPlaceholder')}
                value={suggestText}
                onChange={(e) => setSuggestText(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-sm px-3 py-1.5 text-xs text-stone-500 hover:bg-white"
                  onClick={() => setSuggestOpen(false)}
                >
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  disabled={!suggestText.trim()}
                  className="rounded-sm bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  onClick={() => {
                    submitSuggestion(suggestText)
                    setSuggestText('')
                    setSuggestSent(true)
                  }}
                >
                  {t('coach.suggestSend')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">{t('coach.intro')}</p>
            {starters.map((s) => (
              <button
                key={s}
                type="button"
                className="block w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-left text-xs text-stone-700 hover:border-teal-400 hover:bg-teal-50/50"
                onClick={() => void send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id}>
            <div
              className={`rounded-sm px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'ml-6 bg-teal-700 text-white'
                  : 'mr-4 bg-stone-100 text-ink whitespace-pre-wrap'
              }`}
            >
              {m.content}
            </div>
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <div className="mr-4 mt-1.5 flex flex-wrap gap-1.5">
                {m.suggestions.map((s, i) =>
                  s.type === 'navigate' ? (
                    <button
                      key={`n${i}`}
                      type="button"
                      className="rounded-sm border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100"
                      onClick={() => navigateTo(s.view)}
                    >
                      {t('coach.openSection')}: {viewLabel(s.view, loc) ?? s.view}
                    </button>
                  ) : (
                    <button
                      key={`h${i}`}
                      type="button"
                      className="rounded-sm border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100"
                      onClick={() => highlight(s.target)}
                    >
                      {t('coach.show')}
                      {targetLabel(s.target, loc) ? `: ${targetLabel(s.target, loc)}` : ''}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <p className="text-xs text-stone-400 animate-pulse">{t('coach.thinking')}</p>
        )}
        {error && <p className="text-xs text-rose-600">{t(error)}</p>}
        <div ref={bottomRef} />
      </div>

      <form
        className="border-t border-grid p-3"
        onSubmit={(e) => {
          e.preventDefault()
          const v = input
          setInput('')
          void send(v)
        }}
      >
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={t('coach.placeholder')}
            value={input}
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            →
          </button>
        </div>
      </form>
    </div>
  )
}

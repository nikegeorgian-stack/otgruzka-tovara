import { useEffect, useRef, useState } from 'react'
import { useAiAssistant } from '@/context/AiAssistantContext'
import { useI18n } from '@/context/I18nContext'
import { CloseIcon, SparkleIcon } from '@/components/ui/icons'

const STARTERS = [
  'Что заканчивается на складе?',
  'Солошвили с 15 числа ночная в факте',
  'Открой май 2026 табель',
  'Проведи расход 10 коробок картон 1200×800',
]

export function AiAssistantPanel() {
  const { t } = useI18n()
  const {
    open,
    setOpen,
    messages,
    loading,
    status,
    pendingConfirmation,
    configured,
    aiActive,
    providerLabelKey,
    send,
    approvePendingConfirmation,
    rejectPendingConfirmation,
    clearChat,
  } = useAiAssistant()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, status, pendingConfirmation, open])

  if (!aiActive) return null

  if (!open) {
    return (
      <button
        type="button"
        title={t('ai.open')}
        aria-label={t('ai.open')}
        className="fixed bottom-5 right-5 z-[91] flex h-14 w-14 items-center justify-center rounded-sm bg-violet-700 text-white shadow-sm transition-shadow hover:shadow-sm print:hidden"
        onClick={() => setOpen(true)}
      >
        <SparkleIcon size={24} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-[91] flex h-[min(32rem,calc(100vh-2.5rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-sm border border-grid bg-white shadow-sm print:hidden">
      <header className="flex items-center justify-between border-b border-grid bg-stone-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('ai.title')}</h3>
          <p className="text-[10px] text-stone-500">
            {configured ? t(providerLabelKey) : t('ai.cloudOff')}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-white/80"
            onClick={clearChat}
          >
            {t('ai.clear')}
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

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-stone-500">{t('ai.intro')}</p>
            {STARTERS.map((s) => (
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
          <div
            key={m.id}
            className={`rounded-sm px-3 py-2 text-sm leading-relaxed ${
              m.role === 'user'
                ? 'ml-6 bg-teal-700 text-white'
                : 'mr-4 bg-stone-100 text-ink whitespace-pre-wrap'
            }`}
          >
            {m.content}
          </div>
        ))}

        {status && (
          <div className="mr-4 rounded-sm bg-indigo-50 px-3 py-2 text-xs text-indigo-700 animate-pulse">
            {status}
          </div>
        )}

        {pendingConfirmation && (
          <div className="rounded-sm border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="mb-3 font-medium">{pendingConfirmation.message}</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void approvePendingConfirmation()}
                disabled={loading}
                className="rounded-sm bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {t('ai.confirmYes')}
              </button>
              <button
                type="button"
                onClick={rejectPendingConfirmation}
                disabled={loading}
                className="rounded-sm border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              >
                {t('ai.confirmNo')}
              </button>
            </div>
          </div>
        )}

        {loading && !status && (
          <p className="text-xs text-stone-400 animate-pulse">{t('ai.thinking')}</p>
        )}
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
            placeholder={t('ai.placeholder')}
            value={input}
            disabled={loading || Boolean(pendingConfirmation)}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={loading || !input.trim() || Boolean(pendingConfirmation)}
            className="rounded-sm bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            →
          </button>
        </div>
      </form>
    </div>
  )
}

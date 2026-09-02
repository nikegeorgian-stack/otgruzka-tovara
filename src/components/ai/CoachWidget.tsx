import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCoach } from '@/context/CoachContext'
import { useI18n } from '@/context/I18nContext'
import { targetLabel, viewLabel, type Locale } from '@/lib/ai/coachTargets'
import { CloseIcon } from '@/components/ui/icons'
import { COACH_DEPTHS, stepsForDepth, type CoachDepth } from '@/lib/coach/depth'
import {
  COACH_Z,
  FAB_PANEL_DOCK_CLASS,
  getCoachPortalRoot,
} from '@/lib/ui/chromeLayout'

function CoachPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, getCoachPortalRoot())
}

export function CoachWidget() {
  const { t, tf, locale } = useI18n()
  const loc = locale as Locale
  const {
    available,
    aiAvailable,
    open,
    setOpen,
    panelMode,
    setPanelMode,
    guides,
    activeGuide,
    depth,
    setDepth,
    activeSteps,
    stepIndex,
    currentStep,
    targetMissing,
    justFinished,
    startGuide,
    stopGuide,
    retryTarget,
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
  const [query, setQuery] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestText, setSuggestText] = useState('')
  const [suggestSent, setSuggestSent] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading, open, panelMode])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return guides
    return guides.filter((g) => {
      const title = t(g.titleKey).toLowerCase()
      const blurb = t(g.blurbKey).toLowerCase()
      return title.includes(q) || blurb.includes(q)
    })
  }, [guides, query, t])

  if (!available) return null

  if (justFinished && !activeGuide) {
    return (
      <CoachPortal>
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 print:hidden"
          style={{ zIndex: COACH_Z }}
        >
          <div className="animate-[coachDoneIn_0.35s_ease-out] rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-xl shadow-emerald-900/25">
            <style>{`
              @keyframes coachDoneIn {
                from { opacity: 0; transform: translateY(10px) scale(0.96); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
            {t('coach.guide.done')}
          </div>
        </div>
      </CoachPortal>
    )
  }

  // Карточка шага «для новичка» — без кнопки «Далее», только клик по рамке
  if (activeGuide && currentStep) {
    const total = activeSteps.length
    const n = stepIndex + 1
    const progress = total > 0 ? (n / total) * 100 : 0
    return (
      <CoachPortal>
        <div
          className="fixed bottom-4 left-1/2 w-[min(34rem,calc(100vw-1rem))] -translate-x-1/2 print:hidden"
          style={{ zIndex: COACH_Z }}
        >
          <div className="max-h-[min(48vh,22rem)] overflow-hidden rounded-2xl border-2 border-red-300 bg-white shadow-2xl shadow-red-900/20">
            <div className="h-1.5 bg-red-100">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-rose-400 transition-[width] duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-red-600 to-rose-500 px-4 py-3 text-white">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wide text-red-100">
                  {t(activeGuide.titleKey)} · {t(`coach.depth.${depth}`)}
                </p>
                <p className="text-base font-bold">{tf('coach.guide.stepOf', { n, total })}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/25"
                onClick={stopGuide}
              >
                {t('coach.guide.stop')}
              </button>
            </div>
            <div className="max-h-[min(36vh,16rem)] overflow-y-auto px-4 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-red-600">
                {t('coach.guide.nowDo')}
              </p>
              <p className="mt-1 text-base font-bold leading-snug text-ink">{t(currentStep.titleKey)}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-700">{t(currentStep.bodyKey)}</p>
              <div className="mt-3.5 space-y-1.5 rounded-xl bg-red-50 px-3.5 py-3 text-[13px] font-medium leading-snug text-red-900">
                <div className="flex items-start gap-2">
                  <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                  </span>
                  <span>{t('coach.guide.clickHint')}</span>
                </div>
                <p className="pl-[18px] text-[12px] font-normal text-red-800/90">
                  {t('coach.guide.dontClickOther')}
                </p>
              </div>
              {targetMissing ? (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">
                  <p className="text-[13px] leading-relaxed text-amber-950">
                    {t('coach.guide.targetMissing')}
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={retryTarget}
                  >
                    {t('coach.guide.retry')}
                  </button>
                </div>
              ) : null}
              <div className="mt-3 flex justify-center gap-1.5 pb-1">
                {activeSteps.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === stepIndex
                        ? 'w-5 bg-red-600'
                        : i < stepIndex
                          ? 'w-1.5 bg-red-300'
                          : 'w-1.5 bg-stone-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </CoachPortal>
    )
  }

  if (!open) {
    return null
  }

  return (
    <CoachPortal>
    <div
      className={`${FAB_PANEL_DOCK_CLASS} flex h-[min(36rem,calc(100vh-2.5rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl`}
      style={{ zIndex: COACH_Z }}
    >
      <header className="flex items-center justify-between border-b border-grid bg-stone-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('coach.title')}</h3>
          <p className="text-[10px] text-stone-500">{t('coach.subtitle')}</p>
        </div>
        <button
          type="button"
          aria-label={t('common.close')}
          className="rounded-lg px-2 py-1 text-stone-400 hover:bg-white"
          onClick={() => setOpen(false)}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="flex gap-1 border-b border-grid px-2 pt-2">
        <button
          type="button"
          className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold ${
            panelMode === 'guides'
              ? 'bg-white text-red-700 shadow-sm ring-1 ring-stone-200'
              : 'text-stone-500 hover:text-stone-800'
          }`}
          onClick={() => setPanelMode('guides')}
        >
          {t('coach.guide.tabGuides')}
        </button>
        {aiAvailable ? (
          <button
            type="button"
            className={`flex-1 rounded-t-lg px-3 py-2 text-xs font-semibold ${
              panelMode === 'ask'
                ? 'bg-white text-violet-700 shadow-sm ring-1 ring-stone-200'
                : 'text-stone-500 hover:text-stone-800'
            }`}
            onClick={() => setPanelMode('ask')}
          >
            {t('coach.guide.tabAsk')}
          </button>
        ) : null}
      </div>

      {panelMode === 'guides' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-grid px-3 py-2">
            <p className="mb-1.5 text-[11px] font-semibold text-stone-600">{t('coach.depth.label')}</p>
            <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-0.5">
              {COACH_DEPTHS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`rounded-md px-1.5 py-1.5 text-[11px] font-semibold transition ${
                    depth === d
                      ? 'bg-white text-red-700 shadow-sm'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                  onClick={() => setDepth(d as CoachDepth)}
                  title={t(`coach.depth.${d}Hint`)}
                >
                  {t(`coach.depth.${d}`)}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[10px] leading-snug text-stone-500">{t(`coach.depth.${depth}Hint`)}</p>
            <input
              className="w-full rounded-lg border border-grid bg-stone-50 px-3 py-2 text-sm outline-none focus:border-red-300 focus:bg-white"
              placeholder={t('coach.guide.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <p className="mt-1.5 text-[11px] text-stone-500">{t('coach.guide.listHint')}</p>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {filtered.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-stone-500">{t('coach.guide.empty')}</p>
            ) : (
              filtered.map((g) => {
                const nSteps = stepsForDepth(g.steps, depth).length
                return (
                <button
                  key={g.id}
                  type="button"
                  className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-left transition hover:border-red-300 hover:bg-red-50/40 hover:shadow-sm"
                  onClick={() => {
                    setOpen(false)
                    startGuide(g.id)
                  }}
                >
                  <p className="text-sm font-semibold text-ink">{t(g.titleKey)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-stone-500">{t(g.blurbKey)}</p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                    {t('coach.guide.start')} · {nSteps} {t('coach.guide.stepsShort')}
                  </p>
                </button>
                )
              })
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-end gap-1 border-b border-grid px-3 py-1.5">
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-violet-600 hover:bg-violet-50"
              onClick={() => {
                setSuggestSent(false)
                setSuggestOpen((v) => !v)
              }}
            >
              {t('coach.suggestBtn')}
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-50"
              onClick={startNewTopic}
            >
              {t('coach.newTopic')}
            </button>
          </div>

          {suggestOpen && (
            <div className="border-b border-grid bg-violet-50/60 p-3">
              <p className="mb-1 text-xs font-medium text-violet-800">{t('coach.suggestTitle')}</p>
              {suggestSent ? (
                <p className="text-xs text-teal-700">{t('coach.suggestThanks')}</p>
              ) : (
                <>
                  <textarea
                    className="w-full resize-none rounded-sm border border-violet-200 px-3 py-2 text-sm"
                    rows={2}
                    value={suggestText}
                    placeholder={t('coach.suggestPlaceholder')}
                    onChange={(e) => setSuggestText(e.target.value)}
                  />
                  <button
                    type="button"
                    className="mt-2 rounded-sm bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => {
                      submitSuggestion(suggestText)
                      setSuggestText('')
                      setSuggestSent(true)
                    }}
                  >
                    {t('coach.suggestSend')}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <p className="text-xs text-stone-500">{t('coach.intro')}</p>
            ) : null}
            {messages.map((m) => (
              <div key={m.id}>
                <div
                  className={`rounded-sm px-3 py-2 text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'ml-6 bg-teal-700 text-white'
                      : 'mr-4 whitespace-pre-wrap bg-stone-100 text-ink'
                  }`}
                >
                  {m.content}
                </div>
                {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 ? (
                  <div className="mr-4 mt-1.5 flex flex-wrap gap-1.5">
                    {m.suggestions.map((s, i) =>
                      s.type === 'navigate' ? (
                        <button
                          key={`n${i}`}
                          type="button"
                          className="rounded-sm border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800"
                          onClick={() => navigateTo(s.view)}
                        >
                          {t('coach.openSection')}: {viewLabel(s.view, loc) ?? s.view}
                        </button>
                      ) : (
                        <button
                          key={`h${i}`}
                          type="button"
                          className="rounded-sm border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-800"
                          onClick={() => highlight(s.target)}
                        >
                          {t('coach.show')}
                          {targetLabel(s.target, loc) ? `: ${targetLabel(s.target, loc)}` : ''}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ))}
            {loading ? (
              <p className="animate-pulse text-xs text-stone-400">{t('coach.thinking')}</p>
            ) : null}
            {error ? <p className="text-xs text-rose-600">{t(error)}</p> : null}
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
        </>
      )}
    </div>
    </CoachPortal>
  )
}

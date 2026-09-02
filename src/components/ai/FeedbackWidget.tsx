import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { useSupportChrome } from '@/context/SupportChromeContext'
import {
  countUnseenAdminReplies,
  markAdminReplySeen,
  suggestionsOwnedBy,
} from '@/lib/aiChat/init'
import type { AiChatStore, FeedbackKind, SuggestionEntry } from '@/lib/aiChat/types'
import { viewLabel, type Locale } from '@/lib/ai/coachTargets'
import { COACH_Z, FAB_TOAST_DOCK_CLASS, getCoachPortalRoot } from '@/lib/ui/chromeLayout'

type Props = {
  view: string
  currentUser: { id: string; displayName?: string; roleId?: string; login?: string } | null
  aiChat: AiChatStore | undefined
  onSubmit: (item: SuggestionEntry) => void
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, getCoachPortalRoot())
}

/** Форма «ошибка / предложение» — открывается из сайдбара (SupportToolsBar). */
export function FeedbackWidget({ view, currentUser, aiChat, onSubmit }: Props) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const {
    feedbackOpenSignal,
    feedbackMineSignal,
    setFeedbackReplyBadge,
  } = useSupportChrome()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'write' | 'mine'>('write')
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replyToast, setReplyToast] = useState<SuggestionEntry | null>(null)

  const canSend = useMemo(() => text.trim().length >= 5, [text])
  const mine = useMemo(
    () =>
      suggestionsOwnedBy(
        aiChat,
        currentUser?.id,
        currentUser?.displayName,
        currentUser?.login,
      ),
    [aiChat, currentUser?.id, currentUser?.displayName, currentUser?.login],
  )

  const unseenReplyCount = useMemo(
    () =>
      countUnseenAdminReplies(
        aiChat,
        currentUser?.id,
        currentUser?.displayName,
        currentUser?.login,
      ),
    [aiChat, currentUser?.id, currentUser?.displayName, currentUser?.login, open, tab, replyToast],
  )

  useEffect(() => {
    setFeedbackReplyBadge(unseenReplyCount)
  }, [unseenReplyCount, setFeedbackReplyBadge])

  const newestUnseenReply = useMemo(() => {
    for (const s of mine) {
      if (!s.adminReply?.trim()) continue
      const key = `fst-feedback-reply-seen:${s.id}:${s.adminReplyAt ?? 0}`
      try {
        if (sessionStorage.getItem(key)) continue
      } catch {
        /* show toast */
      }
      return s
    }
    return null
  }, [mine])

  useEffect(() => {
    if (!newestUnseenReply) return
    const toastKey = `fst-feedback-reply-toast:${newestUnseenReply.id}:${newestUnseenReply.adminReplyAt ?? 0}`
    try {
      if (sessionStorage.getItem(toastKey)) return
      sessionStorage.setItem(toastKey, '1')
    } catch {
      /* ignore */
    }
    setReplyToast(newestUnseenReply)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Ответ администратора', {
          body: (newestUnseenReply.adminReply ?? '').slice(0, 120),
          tag: `fst-feedback-${newestUnseenReply.id}`,
        })
      }
    } catch {
      /* ignore */
    }
    const tmr = window.setTimeout(() => setReplyToast(null), 12000)
    return () => window.clearTimeout(tmr)
  }, [newestUnseenReply?.id, newestUnseenReply?.adminReplyAt])

  useEffect(() => {
    if (feedbackOpenSignal <= 0) return
    setKind('bug')
    setTitle('')
    setText('')
    setSent(false)
    setError(null)
    setTab('write')
    setOpen(true)
  }, [feedbackOpenSignal])

  useEffect(() => {
    if (feedbackMineSignal <= 0) return
    setTab('mine')
    setOpen(true)
    setReplyToast(null)
  }, [feedbackMineSignal])

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(loc === 'ka' ? 'ka-GE' : loc === 'en' ? 'en-US' : 'ru-RU')

  function resetForm() {
    setKind('bug')
    setTitle('')
    setText('')
    setSent(false)
    setError(null)
  }

  function handleClose() {
    setOpen(false)
    window.setTimeout(() => {
      resetForm()
      setTab('write')
    }, 200)
  }

  function openMineAndMark(s: SuggestionEntry) {
    markAdminReplySeen(s.id, s.adminReplyAt)
    setReplyToast(null)
    setTab('mine')
    setOpen(true)
    setFeedbackReplyBadge(
      countUnseenAdminReplies(
        aiChat,
        currentUser?.id,
        currentUser?.displayName,
        currentUser?.login,
      ),
    )
  }

  function handleSend() {
    const body = text.trim()
    if (body.length < 5) {
      setError(t('feedback.errShort'))
      return
    }
    const login = currentUser?.login?.trim().toLowerCase()
    onSubmit({
      id: crypto.randomUUID(),
      ts: Date.now(),
      userId: currentUser?.id ?? null,
      userName: currentUser?.displayName ?? '—',
      userLogin: login && login.includes('@') ? login : undefined,
      roleId: currentUser?.roleId ?? '',
      view,
      text: body,
      kind,
      status: 'new',
      title: title.trim() || undefined,
    })
    setSent(true)
    setError(null)
  }

  return (
    <>
      <Portal>
        {replyToast ? (
          <div className={FAB_TOAST_DOCK_CLASS} style={{ zIndex: COACH_Z + 1 }}>
            <div className="rounded-2xl border border-teal-300 bg-white p-4 shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-wide text-teal-800">
                {t('feedback.user.replyNotify')}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {replyToast.title?.trim() ||
                  (replyToast.kind === 'bug' ? t('feedback.kind.bug') : t('feedback.kind.idea'))}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-stone-600">{replyToast.adminReply}</p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => openMineAndMark(replyToast)}>
                  {t('feedback.user.openMine')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    markAdminReplySeen(replyToast.id, replyToast.adminReplyAt)
                    setReplyToast(null)
                    setFeedbackReplyBadge(
                      countUnseenAdminReplies(
                        aiChat,
                        currentUser?.id,
                        currentUser?.displayName,
                        currentUser?.login,
                      ),
                    )
                  }}
                >
                  {t('common.close')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Portal>

      <AppDialog
        open={open}
        onClose={handleClose}
        title={t('feedback.title')}
        subtitle={tab === 'mine' ? t('feedback.mine.subtitle') : t('feedback.subtitle')}
        size={tab === 'mine' ? 'lg' : 'md'}
        ephemeral
        footer={
          tab === 'mine' || sent ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleClose}>
                {t('common.close')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" disabled={!canSend} onClick={handleSend} data-coach="feedback:send">
                {t('feedback.send')}
              </Button>
            </div>
          )
        }
      >
        <div className="border-b border-grid px-5 pt-3">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-0.5">
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                tab === 'write' ? 'bg-white text-ink shadow-sm' : 'text-stone-500'
              }`}
              onClick={() => {
                setTab('write')
                setSent(false)
              }}
            >
              {t('feedback.tabWrite')}
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-2 text-sm font-semibold ${
                tab === 'mine' ? 'bg-white text-ink shadow-sm' : 'text-stone-500'
              }`}
              onClick={() => {
                setTab('mine')
                for (const s of mine) {
                  if (s.adminReply) markAdminReplySeen(s.id, s.adminReplyAt)
                }
                setFeedbackReplyBadge(0)
              }}
            >
              {t('feedback.tabMine')}
              {mine.length > 0 ? (
                <span className="ml-1 text-[11px] text-stone-400">({mine.length})</span>
              ) : null}
              {unseenReplyCount > 0 ? (
                <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white">
                  {unseenReplyCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {tab === 'mine' ? (
          <div className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto px-5 py-4">
            <p className="text-xs text-stone-500">{t('feedback.mine.hint')}</p>
            {mine.length === 0 ? (
              <p className="py-6 text-center text-sm text-stone-400">{t('feedback.mine.empty')}</p>
            ) : (
              mine.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-xl border p-3 ${
                    s.adminReply
                      ? 'border-teal-200 bg-teal-50/40'
                      : s.status === 'new'
                        ? 'border-amber-200 bg-amber-50/40'
                        : 'border-grid bg-white'
                  }`}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                    {s.kind === 'bug' ? t('feedback.kind.bug') : t('feedback.kind.idea')} ·{' '}
                    {t(`feedback.status.${s.status}`)}
                  </p>
                  {s.title ? <p className="mt-0.5 text-sm font-semibold text-ink">{s.title}</p> : null}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{s.text}</p>
                  {s.adminReply ? (
                    <div className="mt-2 rounded-md border border-teal-200 bg-teal-50/70 px-2.5 py-2">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-teal-800">
                        {t('feedback.admin.replyLabel')}
                        {s.adminReplyBy ? ` · ${s.adminReplyBy}` : ''}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-teal-950">
                        {s.adminReply}
                      </p>
                      {s.adminReplyAt ? (
                        <p className="mt-1 text-[10px] text-teal-700/70">{fmt(s.adminReplyAt)}</p>
                      ) : null}
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] text-stone-400">
                    {viewLabel(s.view, loc) ?? (s.view || '—')} · {fmt(s.ts)}
                  </p>
                </div>
              ))
            )}
          </div>
        ) : sent ? (
          <div className="space-y-3 px-5 py-5">
            <p className="text-sm font-semibold text-teal-800">{t('feedback.thanks')}</p>
            <p className="text-xs leading-relaxed text-stone-600">{t('feedback.thanksHint')}</p>
            <Button size="sm" variant="secondary" onClick={() => setTab('mine')}>
              {t('feedback.tabMine')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <p className="text-xs leading-relaxed text-stone-500">{t('feedback.banner')}</p>
            <div
              className="grid grid-cols-2 gap-1 rounded-lg bg-stone-100 p-0.5"
              data-coach="feedback:kinds"
            >
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
                  kind === 'bug' ? 'bg-white text-red-700 shadow-sm' : 'text-stone-500'
                }`}
                onClick={() => setKind('bug')}
              >
                {t('feedback.kind.bug')}
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-semibold ${
                  kind === 'idea' ? 'bg-white text-teal-800 shadow-sm' : 'text-stone-500'
                }`}
                onClick={() => setKind('idea')}
              >
                {t('feedback.kind.idea')}
              </button>
            </div>
            <label className="block text-xs font-medium text-stone-500">
              {t('feedback.titleField')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('feedback.titlePh')}
              />
            </label>
            <label className="block text-xs font-medium text-stone-500">
              {t('feedback.textField')} *
              <textarea
                className="mt-1 w-full resize-y rounded-sm border border-grid px-3 py-2 text-sm leading-relaxed"
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={kind === 'bug' ? t('feedback.textPhBug') : t('feedback.textPhIdea')}
                data-coach="feedback:text"
              />
            </label>
            {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
            <p className="text-[11px] text-stone-400">
              {t('feedback.metaView')}: {view || '—'}
            </p>
          </div>
        )}
      </AppDialog>
    </>
  )
}

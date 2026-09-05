import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import { useSupportChrome } from '@/context/SupportChromeContext'
import { roleLabel } from '@/lib/access/roles'
import type { AccessRoleId } from '@/lib/access/types'
import { countNewFeedback } from '@/lib/aiChat/init'
import type { AiChatStore, FeedbackStatus, SuggestionEntry } from '@/lib/aiChat/types'
import type { FeedbackReplyNotifyResult } from '@/lib/cloud/fstPushNotify'
import { COACH_Z, FAB_TOAST_DOCK_CLASS, getCoachPortalRoot } from '@/lib/ui/chromeLayout'
import { viewLabel, type Locale } from '@/lib/ai/coachTargets'

type Props = {
  aiChat: AiChatStore | undefined
  locale: Locale
  adminName?: string
  onSetStatus: (id: string, status: FeedbackStatus, byName?: string) => void
  onReply?: (
    id: string,
    reply: string,
    byName?: string,
    close?: boolean,
  ) => void | Promise<void | FeedbackReplyNotifyResult>
  onOpenSettings?: () => void
}

function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, getCoachPortalRoot())
}

function senderLine(s: SuggestionEntry, roleOf: (id: string) => string) {
  const role = s.roleId ? roleOf(s.roleId) : ''
  if (role) return `${role} · ${s.userName}`
  return s.userName
}

/** Журнал ОС для sysadmin — открывается из сайдбара; тост о новом письме у панели. */
export function FeedbackAdminBell({
  aiChat,
  locale,
  adminName,
  onSetStatus,
  onReply,
  onOpenSettings,
}: Props) {
  const { t } = useI18n()
  const { mailOpenSignal, setMailBadge } = useSupportChrome()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<SuggestionEntry | null>(null)
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [replyBusyId, setReplyBusyId] = useState<string | null>(null)
  const [replyHint, setReplyHint] = useState<string | null>(null)
  const newCount = countNewFeedback(aiChat)
  const items = useMemo(
    () =>
      [...(aiChat?.suggestions ?? [])]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 40),
    [aiChat?.suggestions],
  )
  const newestNew = useMemo(
    () => items.find((s) => s.status === 'new') ?? null,
    [items],
  )

  useEffect(() => {
    setMailBadge(newCount)
  }, [newCount, setMailBadge])

  useEffect(() => {
    if (mailOpenSignal <= 0) return
    setOpen(true)
    setToast(null)
  }, [mailOpenSignal])

  useEffect(() => {
    if (!newestNew) return
    const key = `fst-feedback-toast:${newestNew.id}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      /* ignore */
    }
    setToast(newestNew)
    const tmr = window.setTimeout(() => setToast(null), 8000)
    return () => window.clearTimeout(tmr)
  }, [newestNew?.id])

  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-US' : 'ru-RU')

  const roleOf = (roleId: string) => {
    try {
      return roleLabel(roleId as AccessRoleId, locale)
    } catch {
      return roleId
    }
  }

  return (
    <>
      <Portal>
        {toast ? (
          <div className={FAB_TOAST_DOCK_CLASS} style={{ zIndex: COACH_Z + 1 }}>
            <div className="rounded-2xl border border-amber-300 bg-white p-4 shadow-2xl">
              <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
                {t('feedback.admin.notify')}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {toast.kind === 'bug' ? t('feedback.kind.bug') : t('feedback.kind.idea')}
                {toast.title ? `: ${toast.title}` : ''}
              </p>
              <p className="mt-1 line-clamp-3 text-xs text-stone-600">{toast.text}</p>
              <p className="mt-1 text-[11px] font-medium text-stone-700">
                {senderLine(toast, roleOf)}
              </p>
              <p className="text-[11px] text-stone-400">{fmt(toast.ts)}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setOpen(true)
                    setToast(null)
                  }}
                >
                  {t('feedback.admin.openJournal')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setToast(null)}>
                  {t('common.close')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Portal>

      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('feedback.admin.journalTitle')}
        subtitle={t('feedback.admin.journalHint')}
        size="xl"
        ephemeral
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-stone-500">
              {t('feedback.admin.newCount')}: {newCount}
            </p>
            <div className="flex gap-2">
              {onOpenSettings ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setOpen(false)
                    onOpenSettings()
                  }}
                >
                  {t('feedback.admin.toSettings')}
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="max-h-[min(70vh,36rem)] overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-400">{t('feedback.admin.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {items.map((s) => (
                <li
                  key={s.id}
                  className={`rounded-xl border p-3 ${
                    s.status === 'new'
                      ? 'border-amber-300 bg-amber-50/50'
                      : 'border-grid bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
                        {s.kind === 'bug' ? t('feedback.kind.bug') : t('feedback.kind.idea')} ·{' '}
                        {t(`feedback.status.${s.status}`)}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-ink">{senderLine(s, roleOf)}</p>
                      {s.title ? (
                        <p className="mt-0.5 text-sm font-medium text-stone-800">{s.title}</p>
                      ) : null}
                      <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">{s.text}</p>
                      <p className="mt-2 text-[11px] text-stone-400">
                        {viewLabel(s.view, locale) ?? (s.view || '—')} · {fmt(s.ts)}
                      </p>
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
                      {onReply ? (
                        <div className="mt-2 space-y-1.5">
                          <textarea
                            className="w-full resize-y rounded-md border border-stone-200 px-2.5 py-2 text-sm"
                            rows={2}
                            placeholder={t('feedback.admin.replyPh')}
                            value={replyDrafts[s.id] ?? ''}
                            onChange={(e) =>
                              setReplyDrafts((d) => ({ ...d, [s.id]: e.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            disabled={replyBusyId === s.id}
                            onClick={() => {
                              const text = (replyDrafts[s.id] ?? '').trim()
                              if (text.length < 2) return
                              setReplyBusyId(s.id)
                              setReplyHint(null)
                              void Promise.resolve(onReply(s.id, text, adminName, true)).then(
                                (result) => {
                                  setReplyDrafts((d) => {
                                    const next = { ...d }
                                    delete next[s.id]
                                    return next
                                  })
                                  setReplyBusyId(null)
                                  if (!result || typeof result !== 'object') {
                                    setReplyHint(t('feedback.admin.replySaved'))
                                    return
                                  }
                                  if (result.pushSent > 0) {
                                    setReplyHint(t('feedback.admin.replyNotifyOk'))
                                  } else if (result.reason === 'no_email') {
                                    setReplyHint(t('feedback.admin.replyNoEmail'))
                                  } else if (result.reason === 'no_tokens') {
                                    setReplyHint(t('feedback.admin.replyNoPush'))
                                  } else {
                                    setReplyHint(t('feedback.admin.replySavedInApp'))
                                  }
                                },
                                () => {
                                  setReplyHint(t('feedback.admin.replyNotifyFail'))
                                  setReplyBusyId(null)
                                },
                              )
                            }}
                          >
                            {s.status === 'done'
                              ? t('feedback.admin.replyAgain')
                              : t('feedback.admin.replyAndClose')}
                          </Button>
                          {replyHint && replyBusyId === null ? (
                            <p className="text-[11px] text-stone-500">{replyHint}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      {s.status === 'new' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onSetStatus(s.id, 'seen', adminName)}
                        >
                          {t('feedback.status.seen')}
                        </Button>
                      ) : null}
                      {s.status !== 'done' ? (
                        <Button size="sm" onClick={() => onSetStatus(s.id, 'done', adminName)}>
                          {t('feedback.status.done')}
                        </Button>
                      ) : null}
                      {s.status === 'done' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onSetStatus(s.id, 'new', adminName)}
                        >
                          {t('feedback.status.reopen')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AppDialog>
    </>
  )
}

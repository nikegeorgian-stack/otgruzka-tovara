import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useI18n } from '@/context/I18nContext'
import {
  countUrgentPendingHandoffs,
  HANDOFF_EOS_BODY_RU,
  handoffNeedsAck,
  sortHandoffs,
} from '@/lib/technologist/shiftHandoff'
import type {
  ShiftHandoffRecord,
  ShiftHandoffUrgency,
} from '@/lib/technologist/types'

type Props = {
  records: ShiftHandoffRecord[]
  operatorId?: string
  operatorName?: string
  onUpsert: (
    entry: Omit<ShiftHandoffRecord, 'id' | 'createdAt' | 'updatedAt' | 'acknowledgements'> & {
      id?: string
    },
  ) => void
  onAcknowledge: (id: string) => void
  onSetStatus: (id: string, status: ShiftHandoffRecord['status']) => void
  onRemove: (id: string) => void
}

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatWhen(iso: string, locale: string) {
  try {
    return new Date(iso).toLocaleString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso.slice(0, 16)
  }
}

function urgencyClass(u: ShiftHandoffUrgency) {
  if (u === 'critical') return 'bg-red-100 text-red-800 ring-1 ring-red-200'
  if (u === 'urgent') return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200'
  return 'bg-stone-100 text-stone-700 ring-1 ring-stone-200'
}

export function TechnologistShiftHandoffPanel({
  records,
  operatorId,
  operatorName,
  onUpsert,
  onAcknowledge,
  onSetStatus,
  onRemove,
}: Props) {
  const { t, locale } = useI18n()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [area, setArea] = useState('')
  const [urgency, setUrgency] = useState<ShiftHandoffUrgency>('normal')
  const [filter, setFilter] = useState<'open' | 'all'>('open')

  const sorted = useMemo(() => sortHandoffs(records), [records])
  const visible = useMemo(
    () => (filter === 'open' ? sorted.filter((h) => h.status === 'open') : sorted),
    [sorted, filter],
  )

  const urgentPending = countUrgentPendingHandoffs(records, operatorId, operatorName)

  function applyTemplate() {
    setTitle(t('technologist.handoff.tplEosTitle'))
    setBody(HANDOFF_EOS_BODY_RU)
    setUrgency('normal')
  }

  function submit() {
    const tTitle = title.trim()
    const tBody = body.trim()
    if (!tTitle && !tBody) return
    onUpsert({
      shiftDate: todayKey(),
      authorId: operatorId,
      authorName: operatorName,
      title: tTitle || t('technologist.handoff.defaultTitle'),
      body: tBody,
      area: area.trim() || undefined,
      urgency,
      status: 'open',
    })
    setTitle('')
    setBody('')
    setArea('')
    setUrgency('normal')
  }

  return (
    <div className="space-y-4">
      {urgentPending > 0 ? (
        <div
          className="rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">{t('technologist.handoff.bannerTitle')}</p>
          <p className="mt-0.5 text-amber-900/80">
            {t('technologist.handoff.bannerHint')}
          </p>
        </div>
      ) : null}

      <Card
        title={t('technologist.handoff.composeTitle')}
        description={t('technologist.handoff.composeHint')}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={applyTemplate}>
              {t('technologist.handoff.tplEos')}
            </Button>
          </div>
          <input
            className="fc-input w-full"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('technologist.handoff.titlePh')}
          />
          <input
            className="fc-input w-full"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder={t('technologist.handoff.areaPh')}
          />
          <textarea
            className="fc-input min-h-[140px] w-full resize-y font-mono text-sm"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('technologist.handoff.bodyPh')}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <span>{t('technologist.handoff.urgency')}</span>
              <select
                className="fc-input"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as ShiftHandoffUrgency)}
              >
                <option value="normal">{t('technologist.handoff.urgency.normal')}</option>
                <option value="urgent">{t('technologist.handoff.urgency.urgent')}</option>
                <option value="critical">{t('technologist.handoff.urgency.critical')}</option>
              </select>
            </label>
            <Button type="button" onClick={submit}>
              {t('technologist.handoff.submit')}
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={t('technologist.handoff.listTitle')}
        description={t('technologist.handoff.listHint')}
        actions={
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={filter === 'open' ? 'primary' : 'secondary'}
              onClick={() => setFilter('open')}
            >
              {t('technologist.handoff.filterOpen')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filter === 'all' ? 'primary' : 'secondary'}
              onClick={() => setFilter('all')}
            >
              {t('technologist.handoff.filterAll')}
            </Button>
          </div>
        }
      >
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">
            {t('technologist.handoff.empty')}
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {visible.map((h) => {
              const needs = handoffNeedsAck(h, operatorId, operatorName)
              return (
                <li key={h.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-2 gap-y-1">
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-medium ${urgencyClass(h.urgency)}`}
                    >
                      {t(`technologist.handoff.urgency.${h.urgency}`)}
                    </span>
                    {h.status === 'closed' ? (
                      <span className="rounded-sm bg-stone-200 px-2 py-0.5 text-xs text-stone-600">
                        {t('technologist.handoff.statusClosed')}
                      </span>
                    ) : null}
                    <h3 className="min-w-0 flex-1 text-sm font-semibold text-stone-900">
                      {h.title}
                    </h3>
                    <span className="text-xs text-stone-500">
                      {formatWhen(h.createdAt, locale)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    {h.authorName ?? '—'}
                    {h.area ? ` · ${h.area}` : ''}
                    {` · ${h.shiftDate}`}
                  </p>
                  {h.body ? (
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-stone-800">
                      {h.body}
                    </pre>
                  ) : null}
                  {h.acknowledgements.length > 0 ? (
                    <p className="mt-2 text-xs text-teal-800">
                      {t('technologist.handoff.ackedBy')}:{' '}
                      {h.acknowledgements
                        .map(
                          (a) =>
                            `${a.userName} (${formatWhen(a.at, locale)})`,
                        )
                        .join('; ')}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-stone-400">
                      {t('technologist.handoff.noAcks')}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {needs ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onAcknowledge(h.id)}
                      >
                        {t('technologist.handoff.ack')}
                      </Button>
                    ) : null}
                    {h.status === 'open' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onSetStatus(h.id, 'closed')}
                      >
                        {t('technologist.handoff.close')}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onSetStatus(h.id, 'open')}
                      >
                        {t('technologist.handoff.reopen')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (window.confirm(t('technologist.handoff.removeConfirm'))) {
                          onRemove(h.id)
                        }
                      }}
                    >
                      {t('technologist.handoff.remove')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/** Мягкий баннер на входе в раздел (без блокировки работы). */
export function TechnologistHandoffSoftBanner({
  records,
  operatorId,
  operatorName,
  onOpenTab,
}: {
  records: ShiftHandoffRecord[]
  operatorId?: string
  operatorName?: string
  onOpenTab: () => void
}) {
  const { t, tf } = useI18n()
  const urgent = countUrgentPendingHandoffs(records, operatorId, operatorName)
  if (urgent <= 0) return null
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <div>
        <p className="font-semibold">
          {tf('technologist.handoff.softBannerTitle', { n: String(urgent) })}
        </p>
        <p className="text-xs text-amber-900/80">{t('technologist.handoff.softBannerHint')}</p>
      </div>
      <Button type="button" size="sm" onClick={onOpenTab}>
        {t('technologist.handoff.openTab')}
      </Button>
    </div>
  )
}

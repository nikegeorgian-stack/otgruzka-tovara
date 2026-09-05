import type { Employee } from '@/lib/types'
import { useI18n } from '@/context/I18nContext'
import { daysUntil, isExpiringSoon, isOverdue } from '@/lib/hr/stats'

type ForeignStatus = NonNullable<Employee['foreignStatus']>

type Props = {
  value: ForeignStatus | undefined
  onChange: (next: ForeignStatus) => void
}

const fieldClass =
  'mt-0.5 w-full rounded-md border border-stone-200 bg-white px-2.5 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25'

/** Безвиз в Грузии — обычно до 365 дней с даты въезда. */
function addDaysIso(iso: string, days: number): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return undefined
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(d.getTime())) return undefined
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function DeadlineHint({ until }: { until?: string }) {
  const { t } = useI18n()
  if (!until) return null
  const d = daysUntil(until)
  if (d === null) return null
  if (isOverdue(until)) {
    return (
      <p className="mt-1 text-[11px] font-semibold text-red-700">
        {t('hr.foreign.overdue')} ({Math.abs(d)} {t('hrInspector.days')})
      </p>
    )
  }
  if (isExpiringSoon(until)) {
    return (
      <p className="mt-1 text-[11px] font-semibold text-amber-800">
        {t('hr.foreign.expiringIn')} {d} {t('hrInspector.days')}
      </p>
    )
  }
  return (
    <p className="mt-1 text-[11px] text-stone-400">
      {t('hr.foreign.daysLeft')}: {d}
    </p>
  )
}

/** Вкладыш иностранца: разрешение, ВНЖ, срок безвизового пребывания. */
export function HrForeignStatusPanel({ value, onChange }: Props) {
  const { t } = useI18n()
  const v = value ?? {}

  function patch(partial: Partial<ForeignStatus>) {
    onChange({ ...v, ...partial })
  }

  function onEntryDateChange(entryDate: string) {
    const next: Partial<ForeignStatus> = { entryDate: entryDate || undefined }
    if (entryDate && !v.stayUntil) {
      const suggested = addDaysIso(entryDate, 365)
      if (suggested) next.stayUntil = suggested
    }
    patch(next)
  }

  function fillStayFromEntry() {
    if (!v.entryDate) return
    const suggested = addDaysIso(v.entryDate, 365)
    if (suggested) patch({ stayUntil: suggested })
  }

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/50 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-sky-900">
          {t('hr.foreign.title')}
        </h4>
        <p className="text-[10px] text-sky-800/80">{t('hr.foreign.hint')}</p>
      </div>

      <div className="mb-4 rounded-md border border-amber-200/80 bg-amber-50/70 p-3">
        <p className="mb-1 text-xs font-semibold text-amber-950">
          {t('hr.foreign.stayTitle')}
        </p>
        <p className="mb-2 text-[11px] leading-snug text-amber-900/90">
          {t('hr.foreign.stayHint')}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.foreign.entryDate')}
            <input
              type="date"
              className={fieldClass}
              value={v.entryDate ?? ''}
              onChange={(e) => onEntryDateChange(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.foreign.stayUntil')}
            <input
              type="date"
              className={fieldClass}
              value={v.stayUntil ?? ''}
              onChange={(e) => patch({ stayUntil: e.target.value || undefined })}
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-950 hover:bg-amber-100/80 disabled:opacity-40"
            disabled={!v.entryDate}
            onClick={fillStayFromEntry}
          >
            {t('hr.foreign.stayPlus365')}
          </button>
          <DeadlineHint until={v.stayUntil} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-white/80 bg-white/90 p-3">
          <p className="mb-2 text-xs font-semibold text-stone-700">
            {t('hr.foreign.workPermit')}
          </p>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.foreign.number')}
            <input
              className={fieldClass}
              value={v.workPermitNumber ?? ''}
              onChange={(e) => patch({ workPermitNumber: e.target.value })}
              placeholder={t('hr.foreign.numberPh')}
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.foreign.from')}
              <input
                type="date"
                className={fieldClass}
                value={v.workPermitFrom ?? ''}
                onChange={(e) => patch({ workPermitFrom: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.foreign.until')}
              <input
                type="date"
                className={fieldClass}
                value={v.workPermitUntil ?? ''}
                onChange={(e) => patch({ workPermitUntil: e.target.value })}
              />
            </label>
          </div>
          <DeadlineHint until={v.workPermitUntil} />
        </div>

        <div className="rounded-md border border-white/80 bg-white/90 p-3">
          <p className="mb-2 text-xs font-semibold text-stone-700">
            {t('hr.foreign.residencePermit')}
          </p>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.foreign.number')}
            <input
              className={fieldClass}
              value={v.residencePermitNumber ?? ''}
              onChange={(e) => patch({ residencePermitNumber: e.target.value })}
              placeholder={t('hr.foreign.numberPh')}
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.foreign.from')}
              <input
                type="date"
                className={fieldClass}
                value={v.residencePermitFrom ?? ''}
                onChange={(e) => patch({ residencePermitFrom: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.foreign.until')}
              <input
                type="date"
                className={fieldClass}
                value={v.residencePermitUntil ?? ''}
                onChange={(e) => patch({ residencePermitUntil: e.target.value })}
              />
            </label>
          </div>
          <DeadlineHint until={v.residencePermitUntil} />
        </div>
      </div>

      <label className="mt-3 block text-[11px] font-medium text-stone-500">
        {t('hr.foreign.note')}
        <textarea
          className={fieldClass}
          rows={2}
          value={v.note ?? ''}
          onChange={(e) => patch({ note: e.target.value })}
          placeholder={t('hr.foreign.notePh')}
        />
      </label>
    </section>
  )
}

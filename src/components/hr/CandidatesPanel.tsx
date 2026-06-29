import { useMemo, useState } from 'react'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { EducationSection, ExperienceSection } from '@/components/hr/HrCardSections'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { fileToDataUrl } from '@/lib/hr/files'
import {
  CANDIDATE_STATUSES,
  candidateStatusLabel,
  candidateStatusTone,
  createNewCandidate,
  isHireStatus,
} from '@/lib/hr/candidates'
import type { Candidate, CandidateStatus, EmployeeGender } from '@/lib/hr/types'
import type { Locale } from '@/i18n/types'

type Props = {
  candidates: Candidate[]
  onUpsert: (c: Candidate) => void
  onRemove: (id: string) => void
  onHire: (id: string) => void
}

const toneClass: Record<ReturnType<typeof candidateStatusTone>, string> = {
  neutral: 'bg-stone-100 text-stone-600',
  progress: 'bg-sky-100 text-sky-700',
  ok: 'bg-teal-100 text-teal-700',
  bad: 'bg-red-100 text-red-700',
}

export function CandidatesPanel({ candidates, onUpsert, onRemove, onHire }: Props) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const { confirm } = useConfirm()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | ''>('')
  const [editing, setEditing] = useState<Candidate | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...candidates]
      .filter((c) => (statusFilter ? c.status === statusFilter : true))
      .filter((c) =>
        !s
          ? true
          : [c.fullName, c.nameKa, c.position, c.phone, c.email, c.source]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(s),
      )
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
  }, [candidates, q, statusFilter])

  async function handleHire(c: Candidate) {
    const ok = await confirm({
      message: t('hr.candidate.hireConfirm').replace('{name}', c.fullName || '—'),
    })
    if (!ok) return
    onHire(c.id)
    setNotice(t('hr.candidate.hireDone').replace('{name}', c.fullName || '—'))
  }

  async function handleRemove(c: Candidate) {
    const ok = await confirm({
      message: t('hr.deleteConfirm').replace('{name}', c.fullName || '—'),
      danger: true,
    })
    if (!ok) return
    onRemove(c.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="min-w-[14rem] flex-1 rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          placeholder={t('hr.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-sm border border-grid bg-white px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as CandidateStatus | '')}
        >
          <option value="">{t('hr.candidate.allStatuses')}</option>
          {CANDIDATE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {candidateStatusLabel(s, loc)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-add"
          onClick={() => setEditing(createNewCandidate())}
        >
          {t('hr.candidate.add')}
        </button>
      </div>

      {notice && (
        <div className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {notice}
          <button className="ml-2 text-xs underline" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-3 py-2">{t('hr.candidate.col.candidate')}</th>
              <th className="px-3 py-2">{t('hr.candidate.col.position')}</th>
              <th className="px-3 py-2">{t('hr.candidate.col.status')}</th>
              <th className="px-3 py-2">{t('hr.candidate.col.interview')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="border-t border-grid hover:bg-orange-50/40">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => setEditing(c)}
                  >
                    <EmployeePhoto
                      photoDataUrl={c.photoDataUrl}
                      gender={c.gender ?? 'unknown'}
                      className="h-8 w-8 shrink-0 rounded-sm object-cover ring-1 ring-grid"
                    />
                    <span>
                      <span className="block font-medium text-ink">{c.fullName || '—'}</span>
                      {c.phone && <span className="block text-xs text-stone-400">{c.phone}</span>}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2 text-xs text-stone-600">{c.position || '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                      toneClass[candidateStatusTone(c.status)]
                    }`}
                  >
                    {candidateStatusLabel(c.status, loc)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-stone-500">
                  {c.interviewDate || '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    {isHireStatus(c.status) && (
                      <button
                        type="button"
                        className="text-xs font-semibold text-teal-700 hover:underline"
                        onClick={() => handleHire(c)}
                      >
                        {t('hr.candidate.hire')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => handleRemove(c)}
                    >
                      {t('hr.delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-stone-500">{t('hr.candidate.empty')}</p>
        )}
      </div>

      {editing && (
        <CandidateEditor
          candidate={editing}
          onClose={() => setEditing(null)}
          onSave={(c) => {
            onUpsert(c)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function CandidateEditor({
  candidate,
  onSave,
  onClose,
}: {
  candidate: Candidate
  onSave: (c: Candidate) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const [c, setC] = useState<Candidate>(candidate)
  const isNew = !candidate.fullName

  function patch(p: Partial<Candidate>) {
    setC((prev) => ({ ...prev, ...p }))
  }

  const field = 'mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm'
  const labelCls = 'block text-xs font-medium text-stone-500'

  return (
    <div className="app-dialog-backdrop fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto p-4 pt-8 sm:items-center sm:pt-4">
      <div className="app-dialog-panel mb-8 w-full max-w-2xl rounded-sm bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-grid px-6 py-4">
          <div className="flex items-center gap-3">
            <EmployeePhoto
              photoDataUrl={c.photoDataUrl}
              gender={c.gender ?? 'unknown'}
              className="h-14 w-12 shrink-0 rounded-sm object-cover ring-1 ring-grid"
            />
            <div>
              <p className="text-base font-bold text-ink">
                {isNew ? t('hr.candidate.new') : c.fullName}
              </p>
              <span className="text-xs text-stone-500">
                {candidateStatusLabel(c.status, loc)}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-1.5 text-sm hover:bg-paper-dark"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="rounded-sm bg-accent px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!c.fullName.trim()}
              onClick={() => onSave({ ...c, fullName: c.fullName.trim() })}
            >
              {t('common.save')}
            </button>
          </div>
        </div>

        <div className="max-h-[64vh] space-y-5 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${labelCls} sm:col-span-2`}>
              ФИО
              <input
                className={field}
                value={c.fullName}
                onChange={(e) => patch({ fullName: e.target.value })}
                autoFocus
              />
            </label>
            <label className={labelCls}>
              {t('hr.candidate.status')}
              <select
                className={field}
                value={c.status}
                onChange={(e) => patch({ status: e.target.value as CandidateStatus })}
              >
                {CANDIDATE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {candidateStatusLabel(s, loc)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {t('hr.candidate.position')}
              <input
                className={field}
                value={c.position ?? ''}
                onChange={(e) => patch({ position: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Телефон
              <input
                className={field}
                value={c.phone ?? ''}
                onChange={(e) => patch({ phone: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              {t('hr.email')}
              <input
                className={field}
                value={c.email ?? ''}
                onChange={(e) => patch({ email: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              {t('hr.candidate.interviewDate')}
              <input
                type="date"
                className={field}
                value={c.interviewDate ?? ''}
                onChange={(e) => patch({ interviewDate: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              {t('hr.candidate.source')}
              <input
                className={field}
                value={c.source ?? ''}
                onChange={(e) => patch({ source: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              {t('hr.candidate.desiredSalary')}
              <input
                type="number"
                className={field}
                value={c.desiredSalary ?? ''}
                onChange={(e) =>
                  patch({ desiredSalary: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </label>
            <label className={labelCls}>
              Валюта
              <select
                className={field}
                value={c.currency ?? 'GEL'}
                onChange={(e) => patch({ currency: e.target.value as Candidate['currency'] })}
              >
                <option value="GEL">GEL</option>
                <option value="USD">USD</option>
                <option value="RUB">RUB</option>
              </select>
            </label>
            <label className={labelCls}>
              Дата рождения
              <input
                type="date"
                className={field}
                value={c.birthDate ?? ''}
                onChange={(e) => patch({ birthDate: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              {t('hr.gender.label')}
              <select
                className={field}
                value={c.gender ?? 'unknown'}
                onChange={(e) => patch({ gender: e.target.value as EmployeeGender })}
              >
                <option value="unknown">{t('hr.gender.unknown')}</option>
                <option value="male">{t('hr.gender.male')}</option>
                <option value="female">{t('hr.gender.female')}</option>
              </select>
            </label>
            <label className={labelCls}>
              {t('hr.cec.personalId')}
              <input
                className={field}
                value={c.personalId ?? ''}
                onChange={(e) => patch({ personalId: e.target.value })}
              />
            </label>
            <label className={`${labelCls} sm:col-span-2`}>
              Адрес
              <input
                className={field}
                value={c.address ?? ''}
                onChange={(e) => patch({ address: e.target.value })}
              />
            </label>
            <label className={labelCls}>
              Фото
              <input
                type="file"
                accept="image/*"
                className="mt-1 block w-full text-xs"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  patch({ photoDataUrl: await fileToDataUrl(file) })
                  e.target.value = ''
                }}
              />
            </label>
          </div>

          <EducationSection
            items={c.education ?? []}
            onChange={(education) => patch({ education })}
          />
          <ExperienceSection
            items={c.workExperience ?? []}
            onChange={(workExperience) => patch({ workExperience })}
          />

          <label className={labelCls}>
            Примечание
            <textarea
              className={`${field} min-h-[5rem]`}
              value={c.note ?? ''}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

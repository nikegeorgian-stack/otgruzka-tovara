import { useMemo, useRef, useState } from 'react'
import { ruNameToKa } from '@/lib/i18n/ruToKaName'
import { ruNameToEn } from '@/lib/i18n/ruToEnName'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import { CandidateQuestionnaireModal } from '@/components/hr/CandidateQuestionnaireModal'
import { EducationSection, ExperienceSection } from '@/components/hr/HrCardSections'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { questionnaireAnsweredCount } from '@/lib/hr/candidateQuestionnaire'
import { fileToDataUrl } from '@/lib/hr/files'
import {
  CANDIDATE_STATUSES,
  candidateStatusLabel,
  candidateStatusTone,
  createNewCandidate,
  isHireStatus,
} from '@/lib/hr/candidates'
import { suggestLoginFromDisplayName } from '@/lib/access/suggestLogin'
import type { Candidate, CandidateStatus, EmployeeGender } from '@/lib/hr/types'
import type { Locale } from '@/i18n/types'

type Props = {
  candidates: Candidate[]
  onUpsert: (c: Candidate) => void
  onRemove: (id: string) => void
  /** Возвращает id созданного сотрудника */
  onHire: (id: string) => string | null
  /** Опционально создать веб-кабинет (роль employee) после найма */
  onCreateEmployeeCabinet?: (input: {
    employeeId: string
    displayName: string
    login: string
    password: string
  }) => Promise<void>
}

const toneClass: Record<ReturnType<typeof candidateStatusTone>, string> = {
  neutral: 'bg-stone-100 text-stone-600',
  progress: 'bg-sky-100 text-sky-700',
  ok: 'bg-teal-100 text-teal-700',
  bad: 'bg-red-100 text-red-700',
}

export function CandidatesPanel({
  candidates,
  onUpsert,
  onRemove,
  onHire,
  onCreateEmployeeCabinet,
}: Props) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const { confirm } = useConfirm()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | ''>('')
  const [editing, setEditing] = useState<Candidate | null>(null)
  const [anketaFor, setAnketaFor] = useState<Candidate | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hireTarget, setHireTarget] = useState<Candidate | null>(null)
  const [createCabinet, setCreateCabinet] = useState(false)
  const [cabinetLogin, setCabinetLogin] = useState('')
  const [cabinetPassword, setCabinetPassword] = useState('')
  const [hireBusy, setHireBusy] = useState(false)
  const [hireError, setHireError] = useState<string | null>(null)

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
    setHireTarget(c)
    setCreateCabinet(false)
    const fromEmail = c.email?.trim().toLowerCase() || ''
    setCabinetLogin(
      fromEmail ||
        suggestLoginFromDisplayName(c.fullName || '', { asEmail: true }),
    )
    setCabinetPassword('')
    setHireError(null)
  }

  async function confirmHire() {
    if (!hireTarget) return
    if (createCabinet) {
      if (!cabinetLogin.trim() || !cabinetPassword.trim()) {
        setHireError(t('hr.candidate.hireCabinetRequired'))
        return
      }
      if (!onCreateEmployeeCabinet) {
        setHireError(t('hr.candidate.hireCabinetUnavailable'))
        return
      }
    }
    setHireBusy(true)
    setHireError(null)
    try {
      const employeeId = onHire(hireTarget.id)
      if (!employeeId) {
        setHireError(t('hr.candidate.hireFailed'))
        return
      }
      if (createCabinet && onCreateEmployeeCabinet) {
        await onCreateEmployeeCabinet({
          employeeId,
          displayName: hireTarget.fullName || cabinetLogin.trim(),
          login: cabinetLogin.trim().toLowerCase(),
          password: cabinetPassword,
        })
        setNotice(
          t('hr.candidate.hireDoneWithCabinet').replace('{name}', hireTarget.fullName || '—'),
        )
      } else {
        setNotice(
          `${t('hr.candidate.hireDone').replace('{name}', hireTarget.fullName || '—')}. ${t('hr.candidate.hireCabinetHint')}`,
        )
      }
      setHireTarget(null)
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      if (code === 'login_taken') setHireError(t('hr.candidate.hireCabinetErrLoginTaken'))
      else if (code === 'password_required') setHireError(t('hr.candidate.hireCabinetRequired'))
      else if (code === 'login_required') setHireError(t('hr.candidate.hireCabinetRequired'))
      else setHireError(t('hr.candidate.hireFailed'))
    } finally {
      setHireBusy(false)
    }
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
          data-coach="hr:addCandidate"
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

      {hireTarget && (
        <ModalBackdrop
          open
          ephemeral
          onClose={() => !hireBusy && setHireTarget(null)}
          panelClassName="w-full max-w-md rounded-sm border border-grid bg-white p-4 shadow-lg"
        >
          <h3 className="text-base font-semibold text-ink">{t('hr.candidate.hire')}</h3>
          <p className="mt-2 text-sm text-stone-600">
            {t('hr.candidate.hireConfirm').replace('{name}', hireTarget.fullName || '—')}
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={createCabinet}
              disabled={hireBusy || !onCreateEmployeeCabinet}
              onChange={(e) => setCreateCabinet(e.target.checked)}
            />
            <span>{t('hr.candidate.hireCreateCabinet')}</span>
          </label>
          {createCabinet && (
            <div className="mt-3 space-y-2">
              <input
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                placeholder={t('hr.candidate.hireCabinetLogin')}
                value={cabinetLogin}
                disabled={hireBusy}
                onChange={(e) => setCabinetLogin(e.target.value)}
                autoComplete="off"
              />
              <input
                type="password"
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                placeholder={t('hr.candidate.hireCabinetPassword')}
                value={cabinetPassword}
                disabled={hireBusy}
                onChange={(e) => setCabinetPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}
          {hireError && <p className="mt-3 text-sm text-red-700">{hireError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-3 py-1.5 text-sm"
              disabled={hireBusy}
              onClick={() => setHireTarget(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="rounded-sm bg-teal-700 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              disabled={hireBusy}
              onClick={() => void confirmHire()}
            >
              {t('hr.candidate.hire')}
            </button>
          </div>
        </ModalBackdrop>
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
                  <div className="flex flex-wrap justify-end gap-3">
                    <button
                      type="button"
                      className="text-xs font-semibold text-teal-800 hover:underline"
                      onClick={() => setAnketaFor(c)}
                      data-coach="hr:anketaOpen"
                      title={t('hr.anketa.open')}
                    >
                      {t('hr.anketa.open')}
                      {questionnaireAnsweredCount(c.questionnaire) > 0
                        ? ` (${questionnaireAnsweredCount(c.questionnaire)})`
                        : ''}
                    </button>
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
          onOpenAnketa={() => {
            setAnketaFor(editing)
          }}
        />
      )}

      {anketaFor && (
        <CandidateQuestionnaireModal
          candidate={anketaFor}
          onClose={() => setAnketaFor(null)}
          onSave={(questionnaire) => {
            const next = {
              ...anketaFor,
              questionnaire,
              updatedAt: new Date().toISOString(),
            }
            onUpsert(next)
            setAnketaFor(null)
            if (editing?.id === next.id) setEditing(next)
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
  onOpenAnketa,
}: {
  candidate: Candidate
  onSave: (c: Candidate) => void
  onClose: () => void
  onOpenAnketa: () => void
}) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const [c, setC] = useState<Candidate>(candidate)
  const nameKaManualRef = useRef(!!candidate.nameKa?.trim())
  const nameEnManualRef = useRef(!!candidate.nameEn?.trim())
  const isNew = !candidate.fullName

  function patch(p: Partial<Candidate>) {
    setC((prev) => ({ ...prev, ...p }))
  }

  const field = 'mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm'
  const labelCls = 'block text-xs font-medium text-stone-500'

  return (
    <ModalBackdrop
      open
      onClose={onClose}
      panelClassName="app-dialog-panel flex w-full max-w-2xl flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm"
    >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-grid bg-stone-50 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <EmployeePhoto
              photoDataUrl={c.photoDataUrl}
              gender={c.gender ?? 'unknown'}
              className="h-14 w-12 shrink-0 rounded-sm object-cover ring-1 ring-grid"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-ink">
                {isNew ? t('hr.candidate.new') : c.fullName}
              </p>
              {c.nameKa ? (
                <p className="truncate text-xs text-stone-500">{c.nameKa}</p>
              ) : null}
              <span className="text-xs text-stone-500">
                {candidateStatusLabel(c.status, loc)}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="app-dialog-body space-y-5 px-4 py-4 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 rounded-sm border border-grid bg-stone-50/80 p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {t('hr.nameBlock.title')}
                </p>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-40"
                  disabled={!c.fullName.trim()}
                  onClick={() => {
                    nameKaManualRef.current = false
                    nameEnManualRef.current = false
                    patch({
                      nameKa: ruNameToKa(c.fullName) || undefined,
                      nameEn: ruNameToEn(c.fullName) || undefined,
                    })
                  }}
                >
                  {t('hr.nameBlock.fromRu')}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={labelCls}>
                  {t('hr.nameBlock.ru')}
                  <input
                    className={`${field} bg-white`}
                    value={c.fullName}
                    onChange={(e) => {
                      const fullName = e.target.value
                      const next: Partial<Candidate> = { fullName }
                      const suggestedKa = ruNameToKa(fullName)
                      const suggestedEn = ruNameToEn(fullName)
                      if (!nameKaManualRef.current && suggestedKa) next.nameKa = suggestedKa
                      if (!nameEnManualRef.current && suggestedEn) next.nameEn = suggestedEn
                      patch(next)
                    }}
                    autoFocus
                  />
                </label>
                <label className={labelCls}>
                  {t('hr.nameBlock.ka')}
                  <input
                    className={`${field} bg-white`}
                    value={c.nameKa ?? ''}
                    onChange={(e) => {
                      nameKaManualRef.current = true
                      patch({ nameKa: e.target.value })
                    }}
                    placeholder="ნიკა წულაია"
                  />
                </label>
                <label className={labelCls}>
                  {t('hr.nameBlock.en')}
                  <input
                    className={`${field} bg-white`}
                    value={c.nameEn ?? ''}
                    onChange={(e) => {
                      nameEnManualRef.current = true
                      patch({ nameEn: e.target.value })
                    }}
                    placeholder="Nika Tsulaia"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-stone-400">{t('hr.nameBlock.autoHint')}</p>
            </div>
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

        <footer className="app-dialog-footer flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-grid bg-stone-50 px-4 pt-3 sm:px-6">
          <button
            type="button"
            className="rounded-sm border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-100"
            onClick={onOpenAnketa}
            data-coach="hr:anketaOpen"
          >
            {t('hr.anketa.open')}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid bg-white px-4 py-2 text-sm hover:bg-paper-dark"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              data-modal-primary
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              disabled={!c.fullName.trim()}
              onClick={() => onSave({ ...c, fullName: c.fullName.trim() })}
            >
              {t('common.save')}
            </button>
          </div>
        </footer>
    </ModalBackdrop>
  )
}

import { useMemo, useRef, useState, useEffect } from 'react'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { CecIdentityPanel } from '@/components/hr/CecIdentityPanel'
import { HrPositionSelect } from '@/components/hr/HrPositionSelect'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { HrCameraModal } from '@/components/hr/HrCameraModal'
import {
  BankSection,
  EducationSection,
  ExperienceSection,
  RelativesSection,
} from '@/components/hr/HrCardSections'
import { useI18n } from '@/context/I18nContext'
import { fileToDataUrl, newId } from '@/lib/hr/files'
import {
  hrAbsenceLabel,
  hrContractLabel,
  employmentAgreementLabel,
  hrStatusLabel,
  hrTrainingCategoryLabel,
  HR_DOC_TYPES,
} from '@/lib/hr/labels'
import { applyPositionToEmployeeFields, structuralUnitName } from '@/lib/hr/orgStructure'
import { applyHrStatus } from '@/lib/hr/sync'
import { daysUntil, isExpiringSoon, isOverdue } from '@/lib/hr/stats'
import type {
  HrAbsence,
  HrAbsenceType,
  HrDocument,
  HrEmployeeModalTab,
  HrPosition,
  HrStructuralUnit,
  HrStatus,
  HrTraining,
  HrTrainingCategory,
  MaritalStatus,
  EmployeeGender,
} from '@/lib/hr/types'
import { suggestNextTabNumber, isTabNumberTaken } from '@/lib/hr/tabNumber'
import {
  isCyclicSchedule,
  SCHEDULE_OPTIONS,
  usesGroup2x2,
  usesShiftMode,
} from '@/lib/schedules'
import type { Employee, ScheduleType } from '@/lib/types'

type Props = {
  employee: Employee
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  isNew?: boolean
  onSave: (e: Employee) => void
  onClose: () => void
}

export function HrEmployeeModal({
  employee: initial,
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  isNew = false,
  onSave,
  onClose,
}: Props) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
  const [emp, setEmp] = useState(initial)
  const [tab, setTab] = useState<HrEmployeeModalTab>('overview')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [camera, setCamera] = useState<'photo' | 'document' | null>(null)
  const photoFileRef = useRef<HTMLInputElement>(null)
  const [docForm, setDocForm] = useState<{
    title: string
    docType: string
    expiresAt: string
    file: File | null
  }>({
    title: '',
    docType: HR_DOC_TYPES[0],
    expiresAt: '',
    file: null,
  })
  const [absForm, setAbsForm] = useState({
    type: 'vacation' as HrAbsenceType,
    startDate: '',
    endDate: '',
    reason: '',
  })
  const [trainForm, setTrainForm] = useState({
    title: '',
    category: 'instruction' as HrTrainingCategory,
    validUntil: '',
    note: '',
  })

  const [fireDate, setFireDate] = useState<string | null>(null)

  const tabs: { id: HrEmployeeModalTab; label: string }[] = [
    { id: 'overview', label: 'Основное' },
    { id: 'work', label: 'Работа' },
    { id: 'education', label: t('hr.tab.education') },
    { id: 'documents', label: 'Документы' },
    { id: 'bank', label: t('hr.tab.bank') },
    { id: 'absences', label: 'Отпуска' },
    { id: 'trainings', label: 'Допуски' },
    { id: 'extra', label: t('hr.tab.extra') },
    { id: 'notes', label: 'Заметки' },
  ]

  const status = emp.hrStatus ?? 'active'

  function patch(partial: Partial<Employee>) {
    setEmp((e) => ({ ...e, ...partial }))
  }

  function chooseStatus(next: HrStatus) {
    if (next === 'fired') {
      setFireDate(emp.terminationDate || new Date().toISOString().slice(0, 10))
      return
    }
    setEmp((e) => ({ ...applyHrStatus(e, next), terminationDate: undefined }))
    setFireDate(null)
  }

  function confirmFire() {
    if (!fireDate) return
    setEmp((e) => ({ ...applyHrStatus(e, 'fired'), terminationDate: fireDate }))
    setFireDate(null)
  }

  function saveAndClose() {
    if (!emp.fullName.trim()) {
      setSaveError('Укажите ФИО сотрудника')
      setTab('overview')
      return
    }
    const tabNum = emp.tabNumber.trim() || suggestNextTabNumber(employees)
    if (isTabNumberTaken(employees, tabNum, emp.id)) {
      setSaveError(`Табельный № ${tabNum} уже занят`)
      setTab('overview')
      return
    }
    onSave({
      ...emp,
      tabNumber: tabNum,
      fullName: emp.fullName.trim(),
      nameKa: emp.nameKa?.trim() || undefined,
    })
    onClose()
  }

  async function addDocumentFromFile(file: File) {
    const fileUrl = await fileToDataUrl(file)
    const doc: HrDocument = {
      id: newId(),
      title: docForm.title.trim() || file.name,
      docType: docForm.docType,
      uploadedAt: new Date().toISOString().slice(0, 10),
      expiresAt: docForm.expiresAt || undefined,
      uploadedBy: 'HR',
      fileName: file.name,
      fileUrl,
    }
    patch({ hrDocuments: [...(emp.hrDocuments ?? []), doc] })
    setDocForm({ title: '', docType: HR_DOC_TYPES[0], expiresAt: '', file: null })
  }

  function removeDocument(id: string) {
    patch({ hrDocuments: (emp.hrDocuments ?? []).filter((d) => d.id !== id) })
  }

  function addAbsence() {
    if (!absForm.startDate || !absForm.endDate) return
    const a: HrAbsence = {
      id: newId(),
      type: absForm.type,
      startDate: absForm.startDate,
      endDate: absForm.endDate,
      reason: absForm.reason || undefined,
    }
    patch({ hrAbsences: [...(emp.hrAbsences ?? []), a] })
    setAbsForm({ type: 'vacation', startDate: '', endDate: '', reason: '' })
  }

  function removeAbsence(id: string) {
    patch({ hrAbsences: (emp.hrAbsences ?? []).filter((a) => a.id !== id) })
  }

  function addTraining() {
    if (!trainForm.title.trim()) return
    const t: HrTraining = {
      id: newId(),
      title: trainForm.title.trim(),
      category: trainForm.category,
      validUntil: trainForm.validUntil || undefined,
      note: trainForm.note || undefined,
    }
    patch({ hrTrainings: [...(emp.hrTrainings ?? []), t] })
    setTrainForm({ title: '', category: 'instruction', validUntil: '', note: '' })
  }

  function removeTraining(id: string) {
    patch({ hrTrainings: (emp.hrTrainings ?? []).filter((t) => t.id !== id) })
  }

  const activeUnits = useMemo(
    () =>
      [...hrStructuralUnits]
        .filter((u) => !u.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
    [hrStructuralUnits],
  )

  const activePositions = useMemo(
    () => hrPositions.filter((p) => !p.archived),
    [hrPositions],
  )

  const selectedPosition = emp.positionId
    ? hrPositions.find((p) => p.id === emp.positionId)
    : undefined

  const selectedUnitName =
    structuralUnitName(activeUnits, emp.structuralUnitId) ||
    selectedPosition?.department ||
    emp.department ||
    ''

  function applyPositionPick(positionId: string) {
    const p = hrPositions.find((x) => x.id === positionId)
    if (!p) return
    const unit = activeUnits.find((u) => u.id === p.structuralUnitId)
    patch({
      ...applyPositionToEmployeeFields(p, unit),
      monthlySalary: p.salary,
      currency: p.currency,
      contractType: p.contractType,
      probationMonths: p.probationMonths,
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div
        className="app-dialog-backdrop fixed inset-0 z-[140] flex items-start justify-center overflow-y-auto p-4 pt-8 sm:items-center sm:pt-4"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <div
          className="app-dialog-panel mb-8 w-full max-w-3xl rounded-sm border border-grid bg-white shadow-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-3 border-b border-grid px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              <EmployeePhoto
                photoDataUrl={emp.photoDataUrl}
                gender={emp.gender ?? 'unknown'}
                className="h-20 w-16 shrink-0 rounded-sm object-cover ring-1 ring-grid"
              />
              <div className="min-w-0">
                {isNew ? (
                  <p className="text-lg font-bold leading-tight text-ink">Новый сотрудник</p>
                ) : (
                  <BilingualText
                    lines={employeeNameLines(emp)}
                    className="text-lg font-bold leading-tight"
                  />
                )}
                {!isNew && (
                  <div className="mt-1.5">
                    <BilingualText
                      lines={employeePositionLines(emp)}
                      className="text-sm font-medium leading-tight text-accent"
                    />
                  </div>
                )}
                <p className="mt-2 font-mono text-xs text-stone-500">
                  № {emp.tabNumber || '—'}
                  {emp.department ? <span className="ml-2 font-sans">· {emp.department}</span> : null}
                </p>
                {(emp.personalId || emp.citizenship || emp.birthDate) && (
                  <p className="mt-0.5 text-[11px] text-stone-400">
                    {[
                      emp.citizenship,
                      emp.personalId,
                      emp.birthDate,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
                <span
                  className={`mt-2 inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${
                    status === 'fired'
                      ? 'bg-red-100 text-red-700'
                      : status === 'active'
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {hrStatusLabel(status, locale)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-start">
              <button
                type="button"
                className="inline-flex items-center rounded-sm border border-grid px-3 py-1.5 text-sm hover:bg-paper-dark"
                onClick={() => setCamera('photo')}
              >
                Фото
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-sm border border-grid px-3 py-1.5 text-sm hover:bg-paper-dark"
                onClick={() => photoFileRef.current?.click()}
              >
                Файл
              </button>
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  patch({ photoDataUrl: await fileToDataUrl(file) })
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-sm border border-grid px-3 py-1.5 text-sm hover:bg-paper-dark"
                onClick={onClose}
              >
                {t('common.close')}
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-sm bg-accent px-4 py-1.5 text-sm font-semibold text-white"
                onClick={saveAndClose}
              >
                Сохранить
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1 border-b border-grid px-4 py-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                  tab === t.id ? 'bg-accent text-white' : 'text-stone-600 hover:bg-paper-dark'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-6">
            {saveError && (
              <p className="mb-4 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {saveError}
              </p>
            )}
            {isNew && (
              <p className="mb-4 rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                Заполните основные поля ниже. Табельный номер присвоится автоматически — при
                необходимости измените. Документы, отпуска и допуски можно добавить сразу или после
                сохранения.
              </p>
            )}
            {tab === 'overview' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="col-span-full block text-xs font-medium text-stone-500">
                  ФИО (рус.) <span className="text-red-500">*</span>
                  <input
                    required
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.fullName}
                    onChange={(e) => {
                      setSaveError(null)
                      patch({ fullName: e.target.value })
                    }}
                    autoFocus={isNew}
                  />
                </label>
                <label className="col-span-full block text-xs font-medium text-stone-500">
                  ФИО (ქართ.)
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.nameKa ?? ''}
                    onChange={(e) => patch({ nameKa: e.target.value })}
                    placeholder="ნიკა წულაია"
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Табельный №
                  <div className="mt-1 flex gap-2">
                    <input
                      className="w-full rounded-sm border border-grid px-3 py-2 font-mono text-sm"
                      value={emp.tabNumber}
                      onChange={(e) => {
                        setSaveError(null)
                        patch({ tabNumber: e.target.value })
                      }}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-sm border border-grid px-2 py-1 text-[10px] font-semibold hover:bg-paper-dark"
                      title="Следующий свободный номер"
                      onClick={() => patch({ tabNumber: suggestNextTabNumber(employees) })}
                    >
                      Авто
                    </button>
                  </div>
                </label>
                {(isNew || !initial.fullName) && (
                  <>
                    <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
                      {t('orgStructure.col.title')}
                      {activePositions.length > 0 ? (
                        <HrPositionSelect
                          units={hrStructuralUnits}
                          positions={hrPositions}
                          value={emp.positionId ?? ''}
                          onChange={(id) => {
                            if (id) applyPositionPick(id)
                          }}
                        />
                      ) : (
                        <input
                          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                          value={emp.position}
                          onChange={(e) => patch({ position: e.target.value, positionId: undefined })}
                        />
                      )}
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      {t('orgStructure.unitName')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
                        value={selectedUnitName}
                        readOnly
                      />
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      Бригада
                      <select
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.brigade}
                        onChange={(e) =>
                          patch({
                            brigade: e.target.value,
                            line: e.target.value,
                          })
                        }
                      >
                        {brigades.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      График
                      <select
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.schedule}
                        onChange={(e) =>
                          patch({ schedule: e.target.value as ScheduleType })
                        }
                      >
                        {SCHEDULE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {isCyclicSchedule(emp.schedule) && (
                      <label className="block text-xs font-medium text-stone-500">
                        Начало цикла
                        <input
                          type="date"
                          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                          value={emp.cycleStart}
                          onChange={(e) => patch({ cycleStart: e.target.value })}
                        />
                      </label>
                    )}
                    {usesGroup2x2(emp.schedule) && (
                      <label className="block text-xs font-medium text-stone-500">
                        Группа {emp.schedule === '1/1 11ч' ? '1/1' : '2/2'}
                        <select
                          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                          value={emp.group2x2 ?? 'А'}
                          onChange={(e) =>
                            patch({ group2x2: e.target.value as 'А' | 'Б' })
                          }
                        >
                          <option value="А">А</option>
                          <option value="Б">Б</option>
                        </select>
                      </label>
                    )}
                    {usesShiftMode(emp.schedule) && (
                      <label className="block text-xs font-medium text-stone-500">
                        Смена
                        <select
                          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                          value={emp.shiftMode ?? 'day'}
                          onChange={(e) =>
                            patch({ shiftMode: e.target.value as 'day' | 'night' })
                          }
                        >
                          <option value="day">Дневная</option>
                          <option value="night">Ночная</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                <label className="block text-xs font-medium text-stone-500">
                  Телефон
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.phone ?? ''}
                    onChange={(e) => patch({ phone: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Дата рождения
                  <input
                    type="date"
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.birthDate ?? ''}
                    onChange={(e) => patch({ birthDate: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  {t('hr.gender.label')}
                  <select
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.gender ?? 'unknown'}
                    onChange={(e) =>
                      patch({ gender: e.target.value as EmployeeGender })
                    }
                  >
                    <option value="unknown">{t('hr.gender.unknown')}</option>
                    <option value="male">{t('hr.gender.male')}</option>
                    <option value="female">{t('hr.gender.female')}</option>
                  </select>
                </label>
                <label className="col-span-full block text-xs font-medium text-stone-500">
                  Адрес
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.address ?? ''}
                    onChange={(e) => patch({ address: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Дата приёма
                  <input
                    type="date"
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.hireDate ?? ''}
                    onChange={(e) => patch({ hireDate: e.target.value })}
                  />
                </label>
                <div className="col-span-full">
                  <p className="text-xs font-medium text-stone-500">Статус</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['active', 'vacation', 'sick', 'fired'] as HrStatus[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => chooseStatus(s)}
                        className={`rounded-sm px-3 py-1 text-xs font-semibold ${
                          status === s
                            ? s === 'fired'
                              ? 'bg-red-600 text-white'
                              : 'bg-accent text-white'
                            : 'border border-grid hover:bg-paper-dark'
                        }`}
                      >
                        {hrStatusLabel(s, locale)}
                      </button>
                    ))}
                  </div>
                  {fireDate !== null && (
                    <div className="mt-3 rounded-sm border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-800">{t('hr.fireTitle')}</p>
                      <p className="mt-1 text-[11px] text-red-700">{t('hr.fireHint')}</p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="text-xs text-stone-600">
                          {t('hr.fireDate')}
                          <input
                            type="date"
                            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
                            value={fireDate}
                            onChange={(e) => setFireDate(e.target.value)}
                          />
                        </label>
                        <button
                          type="button"
                          className="rounded-sm bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                          disabled={!fireDate}
                          onClick={confirmFire}
                        >
                          {t('hr.fireConfirm')}
                        </button>
                        <button
                          type="button"
                          className="rounded-sm border border-grid px-3 py-2 text-xs"
                          onClick={() => setFireDate(null)}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                  {status === 'fired' && emp.terminationDate && fireDate === null && (
                    <p className="mt-2 text-xs text-red-600">
                      {t('hr.fireDone').replace('{date}', emp.terminationDate)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {tab === 'work' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
                  {t('orgStructure.col.title')}
                  {activePositions.length > 0 ? (
                    <HrPositionSelect
                      units={hrStructuralUnits}
                      positions={hrPositions}
                      value={emp.positionId ?? ''}
                      onChange={(id) => {
                        if (id) applyPositionPick(id)
                        else
                          patch({
                            positionId: undefined,
                            structuralUnitId: undefined,
                          })
                      }}
                    />
                  ) : (
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={emp.position}
                      onChange={(e) => patch({ position: e.target.value, positionId: undefined })}
                    />
                  )}
                </label>
                <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
                  {t('orgStructure.unitName')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
                    value={selectedUnitName}
                    readOnly
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  {t('orgStructure.col.rank')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
                    value={emp.grade ?? selectedPosition?.rank ?? selectedPosition?.grade ?? ''}
                    readOnly={Boolean(selectedPosition)}
                    onChange={(e) => patch({ grade: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  {t('hr.col.department')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
                    value={emp.department ?? ''}
                    readOnly
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Линия / участок
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.line ?? emp.brigade}
                    onChange={(e) => patch({ line: e.target.value })}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Бригада (табель)
                  {isNew ? (
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={emp.brigade}
                      onChange={(e) =>
                        patch({
                          brigade: e.target.value,
                          line: e.target.value,
                        })
                      }
                    >
                      {brigades.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
                      value={emp.brigade}
                      readOnly
                      title="Меняется в разделе «Сотрудники» или «Состав» в табеле"
                    />
                  )}
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  Руководитель
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.manager ?? ''}
                    onChange={(e) => patch({ manager: e.target.value })}
                  />
                </label>
                <>
                    <label className="block text-xs font-medium text-stone-500">
                      Оклад / ставка
                      <input
                        type="number"
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.monthlySalary ?? ''}
                        onChange={(e) =>
                          patch({
                            monthlySalary: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                      />
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      Валюта
                      <select
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.currency ?? 'GEL'}
                        onChange={(e) =>
                          patch({ currency: e.target.value as Employee['currency'] })
                        }
                      >
                        <option value="GEL">GEL</option>
                        <option value="RUB">RUB</option>
                        <option value="USD">USD</option>
                      </select>
                    </label>
                    {emp.contractType && (
                      <p className="col-span-full text-xs text-stone-500">
                        {hrContractLabel(emp.contractType, locale)}
                      </p>
                    )}
                    <label className="col-span-full block text-xs font-medium text-stone-500">
                      Вид трудового договора (для спецодежды)
                      <select
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.employmentAgreementKind ?? ''}
                        onChange={(e) =>
                          patch({
                            employmentAgreementKind:
                              e.target.value === ''
                                ? undefined
                                : (e.target.value as Employee['employmentAgreementKind']),
                          })
                        }
                      >
                        <option value="">— не указан —</option>
                        <option value="permanent">
                          {employmentAgreementLabel('permanent', locale)}
                        </option>
                        <option value="fixed_term">
                          {employmentAgreementLabel('fixed_term', locale)}
                        </option>
                      </select>
                      <span className="mt-1 block text-[11px] text-stone-400">
                        Спецодежда выдаётся только при основном договоре
                      </span>
                    </label>
                  </>
              </div>
            )}

            {tab === 'documents' && (
              <div className="space-y-4">
                <CecIdentityPanel emp={emp} onPatch={patch} />
                <div className="rounded-sm border border-grid bg-paper-dark/50 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      className="rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder="Название"
                      value={docForm.title}
                      onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))}
                    />
                    <select
                      className="rounded-sm border border-grid px-3 py-2 text-sm"
                      value={docForm.docType}
                      onChange={(e) => setDocForm((f) => ({ ...f, docType: e.target.value }))}
                    >
                      {HR_DOC_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      className="rounded-sm border border-grid px-3 py-2 text-sm"
                      value={docForm.expiresAt}
                      onChange={(e) => setDocForm((f) => ({ ...f, expiresAt: e.target.value }))}
                    />
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="text-sm"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) void addDocumentFromFile(file)
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-3 rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-white"
                    onClick={() => setCamera('document')}
                  >
                    Скан с камеры
                  </button>
                </div>
                <ul className="space-y-2">
                  {(emp.hrDocuments ?? []).map((doc) => {
                    const d = daysUntil(doc.expiresAt)
                    const warn = isExpiringSoon(doc.expiresAt) || isOverdue(doc.expiresAt)
                    return (
                      <li
                        key={doc.id}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-sm border px-3 py-2 text-sm ${
                          warn ? 'border-amber-300 bg-amber-50' : 'border-grid'
                        }`}
                      >
                        <div>
                          {doc.fileUrl ? (
                            <HrDocumentOpenButton
                              doc={doc}
                              label={doc.title}
                              className="font-medium text-left text-ink hover:text-accent hover:underline"
                            />
                          ) : (
                            <span className="font-medium">{doc.title}</span>
                          )}
                          <span className="ml-2 text-xs text-stone-500">{doc.docType}</span>
                          {doc.expiresAt && (
                            <span className="ml-2 text-xs text-stone-500">
                              до {doc.expiresAt}
                              {d !== null && ` (${d} дн.)`}
                            </span>
                          )}
                          {doc.fileUrl && (
                            <p className="mt-0.5 truncate text-xs text-stone-400" title={doc.fileUrl}>
                              {doc.fileName || doc.fileUrl.replace(/^https?:\/\//, '').slice(0, 48)}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {doc.fileUrl?.startsWith('data:') && (
                            <a
                              href={doc.fileUrl}
                              download={doc.fileName}
                              className="text-xs text-stone-600 hover:underline"
                            >
                              {t('hr.document.download')}
                            </a>
                          )}
                          <button
                            type="button"
                            className="text-xs text-red-600 hover:underline"
                            onClick={() => removeDocument(doc.id)}
                          >
                            Удалить
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {tab === 'absences' && (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-sm border border-grid bg-paper-dark/50 p-4 sm:grid-cols-2">
                  <select
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    value={absForm.type}
                    onChange={(e) =>
                      setAbsForm((f) => ({ ...f, type: e.target.value as HrAbsenceType }))
                    }
                  >
                    {(['vacation', 'sick', 'business_trip', 'absence'] as HrAbsenceType[]).map(
                      (t) => (
                        <option key={t} value={t}>
                          {hrAbsenceLabel(t, locale)}
                        </option>
                      ),
                    )}
                  </select>
                  <input
                    type="date"
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    value={absForm.startDate}
                    onChange={(e) => setAbsForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                  <input
                    type="date"
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    value={absForm.endDate}
                    onChange={(e) => setAbsForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                  <input
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    placeholder="Причина"
                    value={absForm.reason}
                    onChange={(e) => setAbsForm((f) => ({ ...f, reason: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn-add-sm sm:col-span-2"
                    onClick={addAbsence}
                  >
                    Добавить
                  </button>
                </div>
                <ul className="space-y-2">
                  {(emp.hrAbsences ?? []).map((a) => (
                    <li
                      key={a.id}
                      className="flex justify-between rounded-sm border border-grid px-3 py-2 text-sm"
                    >
                      <span>
                        {hrAbsenceLabel(a.type, locale)}: {a.startDate} — {a.endDate}
                        {a.reason && ` · ${a.reason}`}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-red-600"
                        onClick={() => removeAbsence(a.id)}
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tab === 'trainings' && (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-sm border border-grid bg-paper-dark/50 p-4 sm:grid-cols-2">
                  <input
                    className="rounded-sm border border-grid px-3 py-2 text-sm sm:col-span-2"
                    placeholder="Название"
                    value={trainForm.title}
                    onChange={(e) => setTrainForm((f) => ({ ...f, title: e.target.value }))}
                  />
                  <select
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    value={trainForm.category}
                    onChange={(e) =>
                      setTrainForm((f) => ({
                        ...f,
                        category: e.target.value as HrTrainingCategory,
                      }))
                    }
                  >
                    {(
                      ['instruction', 'training', 'certificate', 'admission'] as HrTrainingCategory[]
                    ).map((c) => (
                      <option key={c} value={c}>
                        {hrTrainingCategoryLabel(c, locale)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="rounded-sm border border-grid px-3 py-2 text-sm"
                    value={trainForm.validUntil}
                    onChange={(e) => setTrainForm((f) => ({ ...f, validUntil: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn-add-sm sm:col-span-2"
                    onClick={addTraining}
                  >
                    Добавить
                  </button>
                </div>
                <ul className="space-y-2">
                  {(emp.hrTrainings ?? []).map((tr) => {
                    const warn =
                      isExpiringSoon(tr.validUntil) || isOverdue(tr.validUntil)
                    return (
                      <li
                        key={tr.id}
                        className={`flex justify-between rounded-sm border px-3 py-2 text-sm ${
                          warn ? 'border-amber-300 bg-amber-50' : 'border-grid'
                        }`}
                      >
                        <span>
                          {tr.title} · {hrTrainingCategoryLabel(tr.category, locale)}
                          {tr.validUntil && ` · до ${tr.validUntil}`}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() => removeTraining(tr.id)}
                        >
                          Удалить
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {tab === 'education' && (
              <div className="space-y-6">
                <EducationSection
                  items={emp.education ?? []}
                  onChange={(education) => patch({ education })}
                />
                <ExperienceSection
                  items={emp.workExperience ?? []}
                  onChange={(workExperience) => patch({ workExperience })}
                />
              </div>
            )}

            {tab === 'bank' && (
              <BankSection
                items={emp.bankAccounts ?? []}
                employeeName={emp.fullName}
                onChange={(bankAccounts) => patch({ bankAccounts })}
              />
            )}

            {tab === 'extra' && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-stone-500">
                    {t('hr.email')}
                    <input
                      type="email"
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={emp.email ?? ''}
                      onChange={(e) => patch({ email: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs font-medium text-stone-500">
                    {t('hr.extra.maritalStatus')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={emp.maritalStatus ?? ''}
                      onChange={(e) =>
                        patch({
                          maritalStatus: (e.target.value || undefined) as MaritalStatus | undefined,
                        })
                      }
                    >
                      <option value="">{t('hr.marital.none')}</option>
                      <option value="single">{t('hr.marital.single')}</option>
                      <option value="married">{t('hr.marital.married')}</option>
                      <option value="divorced">{t('hr.marital.divorced')}</option>
                      <option value="widowed">{t('hr.marital.widowed')}</option>
                    </select>
                  </label>
                </div>
                <RelativesSection
                  items={emp.relatives ?? []}
                  onChange={(relatives) => patch({ relatives })}
                />
              </div>
            )}

            {tab === 'notes' && (
              <textarea
                className="min-h-[12rem] w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={emp.hrNotes ?? emp.note ?? ''}
                onChange={(e) => patch({ hrNotes: e.target.value, note: e.target.value })}
                placeholder="Внутренние заметки HR"
              />
            )}
          </div>
        </div>
      </div>

      {camera && (
        <HrCameraModal
          mode={camera}
          onClose={() => setCamera(null)}
          onCapture={(dataUrl, fileName) => {
            if (camera === 'photo') {
              patch({ photoDataUrl: dataUrl })
            } else {
              const doc: HrDocument = {
                id: newId(),
                title: docForm.title.trim() || fileName || 'Скан',
                docType: docForm.docType,
                uploadedAt: new Date().toISOString().slice(0, 10),
                expiresAt: docForm.expiresAt || undefined,
                uploadedBy: 'HR',
                fileName: fileName ?? 'scan.jpg',
                fileUrl: dataUrl,
              }
              patch({ hrDocuments: [...(emp.hrDocuments ?? []), doc] })
            }
            setCamera(null)
          }}
        />
      )}
    </>
  )
}

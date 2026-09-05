import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BilingualText } from '@/components/employee/BilingualText'
import { EmployeePhoto } from '@/components/ui/EmployeePhoto'
import { EditLockBanner } from '@/components/hr/EditLockBanner'
import { useModalScope } from '@/hooks/useModalScope'
import { useEditLock } from '@/hooks/useEditLock'
import { CHROME_BACKDROP_CLASS } from '@/lib/ui/chromeLayout'
import { useWindowChrome } from '@/hooks/useWindowChrome'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { employeeLockId, fingerprintEmployee } from '@/lib/editLocks/types'
import { useConfirm } from '@/context/ConfirmContext'
import {
  employeeContractRows,
  HrEmploymentContractsPanel,
} from '@/components/hr/HrEmploymentContractsPanel'
import { HrContractEditDialog } from '@/components/hr/HrContractEditDialog'
import { HrAttachmentField } from '@/components/hr/HrAttachmentField'
import { CecIdentityPanel } from '@/components/hr/CecIdentityPanel'
import { HrForeignStatusPanel } from '@/components/hr/HrForeignStatusPanel'
import { HrPositionSelect } from '@/components/hr/HrPositionSelect'
import { StaffRateField } from '@/components/hr/StaffRateField'
import { HrDocumentOpenButton } from '@/components/hr/HrDocumentOpenButton'
import { HrCameraModal } from '@/components/hr/HrCameraModal'
import { HrAttendanceBiometricsPanel } from '@/components/hr/HrAttendanceBiometricsPanel'
import { upsertEmploymentContract } from '@/lib/hr/contracts'
import {
  purgeHrContractTrash,
  purgeHrDocumentTrash,
  removeHrContractToTrash,
  removeHrDocumentToTrash,
  restoreHrContractFromTrash,
  restoreHrDocumentFromTrash,
} from '@/lib/hr/documentTrash'
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
  hrJournalKindLabel,
  hrStatusLabel,
  hrTrainingCategoryLabel,
  HR_DOC_TYPES,
} from '@/lib/hr/labels'
import { appendEmployeeJournal, journalFromAbsence } from '@/lib/hr/journal'
import { findEmployeeFullNameDuplicate } from '@/lib/hr/employeeName'
import {
  MAX_CONSECUTIVE_SICK_WORK_DAYS,
  countSickWorkDays,
  sickLimitInfo,
} from '@/lib/hr/sickWorkDays'
import {
  applyStatusPeriod,
  recomputeStatusFromAbsences,
} from '@/lib/hr/statusPeriod'
import { applyPositionToEmployeeFields, structuralUnitName } from '@/lib/hr/orgStructure'
import { salaryFieldsFromPosition } from '@/lib/finance/salary'
import { applyHrStatus } from '@/lib/hr/sync'
import { daysUntil, isExpiringSoon, isOverdue } from '@/lib/hr/stats'
import { isForeignPersonnel } from '@/lib/hr/inspector'
import {
  DismissalLeaveSettlement,
  LeaveBalancePanel,
} from '@/components/hr/LeaveBalancePanel'
import { HrEmployeeHistoryPanel } from '@/components/hr/HrEmployeeHistoryPanel'
import { HrEmployeeTimesheetPanel } from '@/components/hr/HrEmployeeTimesheetPanel'
import { confirmDismissalSettlement } from '@/lib/hr/leaveOps'
import type {
  HrAbsenceType,
  HrDocument,
  HrEmployeeModalTab,
  HrEmploymentContract,
  HrPosition,
  HrStructuralUnit,
  HrStatus,
  HrTraining,
  HrTrainingCategory,
  MaritalStatus,
  EmployeeGender,
} from '@/lib/hr/types'
import { suggestNextTabNumber, isTabNumberTaken } from '@/lib/hr/tabNumber'
import { ruNameToKa, surnameKaFromFullNameKa } from '@/lib/i18n/ruToKaName'
import { ruNameToEn } from '@/lib/i18n/ruToEnName'
import {
  defaultShiftHours,
  effectiveShiftHours,
  is52Schedule,
  isCyclicSchedule,
  is22Schedule,
  SCHEDULE_OPTIONS,
  SHIFT_HOURS_OPTIONS_22,
  SHIFT_HOURS_OPTIONS_52,
  supportsShiftHours,
  usesGroup2x2,
  usesShiftMode,
} from '@/lib/schedules'
import { syncHourlyFromMonthly } from '@/lib/payroll'
import type { AppStore, Employee, ScheduleType } from '@/lib/types'

type Props = {
  employee: Employee
  employees: Employee[]
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  /** Добавление должности в справочник из карточки / договора. */
  onUpsertPosition?: (p: HrPosition) => void
  /** Для вкладки «Табель» — календарь по месяцам. */
  store?: AppStore
  isNew?: boolean
  /** Стабильный id для панели свёрнутых окон (несколько карточек). */
  windowId?: string
  /** Для soft-lock между пользователями / вкладками */
  lockHolderUid?: string
  lockHolderName?: string
  /** Перехват чужого замка (sysadmin) */
  canForceTakeOver?: boolean
  /** Оклад в карточке (HR, инспектор кадров, финансы, sysadmin). */
  canEditSalary?: boolean
  onSave: (e: Employee) => void
  onClose: () => void
}

export function HrEmployeeModal({
  employee: initial,
  employees,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onUpsertPosition,
  store,
  isNew = false,
  windowId,
  lockHolderUid = 'local',
  lockHolderName = '',
  canForceTakeOver = false,
  canEditSalary = false,
  onSave,
  onClose,
}: Props) {
  const { t, locale, employeeNameLines, employeePositionLines } = useI18n()
  const { confirmUnsaved, confirm } = useConfirm()
  const [emp, setEmp] = useState(initial)
  const baselineFpRef = useRef(fingerprintEmployee(initial))
  const [tab, setTab] = useState<HrEmployeeModalTab>('overview')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [camera, setCamera] = useState<'photo' | 'document' | null>(null)
  /** Пользователь правит KA/EN вручную — автоподстановку не затираем. */
  const nameKaManualRef = useRef(!!initial.nameKa?.trim())
  const nameEnManualRef = useRef(!!initial.nameEn?.trim())
  const photoFileRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [docForm, setDocForm] = useState<{
    title: string
    docType: string
    issuedAt: string
    expiresAt: string
    fileUrl: string
    fileName?: string
  }>({
    title: '',
    docType: HR_DOC_TYPES[0],
    issuedAt: '',
    expiresAt: '',
    fileUrl: '',
    fileName: undefined,
  })
  const [contractDialog, setContractDialog] = useState<{
    open: boolean
    initial: HrEmploymentContract | null
  }>({ open: false, initial: null })
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
  /** Период для статуса sick | vacation — даты обязательны. */
  const [periodDraft, setPeriodDraft] = useState<{
    type: 'sick' | 'vacation'
    from: string
    to: string
  } | null>(null)

  const tabs: { id: HrEmployeeModalTab; label: string }[] = [
    { id: 'overview', label: 'Основное' },
    { id: 'work', label: 'Работа' },
    { id: 'timesheet', label: t('hr.tab.timesheet') },
    { id: 'history', label: t('hr.tab.history') },
    { id: 'contracts', label: t('hr.tab.contracts') },
    { id: 'education', label: t('hr.tab.education') },
    { id: 'documents', label: t('hr.tab.documents') },
    { id: 'bank', label: t('hr.tab.bank') },
    { id: 'absences', label: 'Отпуска' },
    { id: 'trainings', label: 'Допуски' },
    { id: 'extra', label: t('hr.tab.extra') },
    { id: 'notes', label: 'Заметки' },
    { id: 'attendance', label: t('hr.tab.attendance') },
  ]

  const status = emp.hrStatus ?? 'active'

  const sickPreview = useMemo(() => {
    if (!periodDraft || periodDraft.type !== 'sick') return null
    if (!periodDraft.from || !periodDraft.to || periodDraft.from > periodDraft.to) return null
    return sickLimitInfo(emp, periodDraft.from, periodDraft.to)
  }, [emp, periodDraft])

  const vacationWorkDaysPreview = useMemo(() => {
    if (!periodDraft || periodDraft.type !== 'vacation') return null
    if (!periodDraft.from || !periodDraft.to || periodDraft.from > periodDraft.to) return null
    return countSickWorkDays(emp, periodDraft.from, periodDraft.to)
  }, [emp, periodDraft])

  const absFormWorkDaysPreview = useMemo(() => {
    if (
      (absForm.type !== 'sick' && absForm.type !== 'vacation') ||
      !absForm.startDate ||
      !absForm.endDate
    ) {
      return null
    }
    if (absForm.startDate > absForm.endDate) return null
    if (absForm.type === 'sick') return sickLimitInfo(emp, absForm.startDate, absForm.endDate)
    return { periodWorkDays: countSickWorkDays(emp, absForm.startDate, absForm.endDate) }
  }, [absForm, emp])

  function patch(partial: Partial<Employee>) {
    setEmp((e) => ({ ...e, ...partial }))
  }

  function validateFullName(): string | null {
    if (!emp.fullName.trim()) return t('hr.err.nameRequired')
    const allEmployees = [
      ...employees,
      ...(store?.trash.employees.map((entry) => entry.employee) ?? []),
    ]
    if (findEmployeeFullNameDuplicate(allEmployees, emp.fullName, emp.id)) {
      return t('hr.err.nameDuplicate')
    }
    return null
  }

  function applyMonthlySalaryInput(raw: string) {
    const trimmed = raw.trim().replace(/\s/g, '')
    if (trimmed === '') {
      patch({ monthlySalary: undefined, individualSalary: false })
      return
    }
    const n = Number(trimmed.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return
    const next = syncHourlyFromMonthly({
      ...emp,
      monthlySalary: n,
      individualSalary: true,
    })
    patch({
      monthlySalary: next.monthlySalary,
      individualSalary: next.individualSalary,
    })
  }

  function applyLocalizedNamesFromRu(fullNameRu: string, force = false) {
    const suggestedKa = ruNameToKa(fullNameRu)
    const suggestedEn = ruNameToEn(fullNameRu)
    const next: Partial<Employee> = {}
    if (!suggestedKa) {
      if (force) next.nameKa = ''
    } else if (force || !nameKaManualRef.current) {
      nameKaManualRef.current = false
      next.nameKa = suggestedKa
      next.surnameKa = emp.surnameKa?.trim()
        ? emp.surnameKa
        : surnameKaFromFullNameKa(suggestedKa) || undefined
    }
    if (!suggestedEn) {
      if (force) next.nameEn = ''
    } else if (force || !nameEnManualRef.current) {
      nameEnManualRef.current = false
      next.nameEn = suggestedEn
    }
    if (Object.keys(next).length) patch(next)
  }

  function onFullNameChange(value: string) {
    setSaveError(null)
    const suggestedKa = ruNameToKa(value)
    const suggestedEn = ruNameToEn(value)
    const next: Partial<Employee> = { fullName: value }
    if (!nameKaManualRef.current && suggestedKa) {
      next.nameKa = suggestedKa
      next.surnameKa = emp.surnameKa?.trim()
        ? emp.surnameKa
        : surnameKaFromFullNameKa(suggestedKa) || undefined
    }
    if (!nameEnManualRef.current && suggestedEn) {
      next.nameEn = suggestedEn
    }
    patch(next)
  }

  const shiftHoursChoices = is52Schedule(emp.schedule)
    ? SHIFT_HOURS_OPTIONS_52
    : is22Schedule(emp.schedule)
      ? SHIFT_HOURS_OPTIONS_22
      : []

  const shiftHoursField = supportsShiftHours(emp.schedule) ? (
    <label className="block text-xs font-medium text-stone-500">
      {t('hr.field.shiftHours')}
      <select
        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
        value={effectiveShiftHours(emp)}
        onChange={(e) => {
          const h = Number(e.target.value)
          const def = defaultShiftHours(emp.schedule)
          patch({ shiftHours: h === def ? undefined : h })
        }}
      >
        {shiftHoursChoices.map((h) => (
          <option key={h} value={h}>
            {h} {t('hr.field.shiftHoursUnit')}
          </option>
        ))}
      </select>
    </label>
  ) : null

  function onScheduleChange(schedule: ScheduleType) {
    patch({
      schedule,
      shiftHours: supportsShiftHours(schedule) ? emp.shiftHours : undefined,
    })
  }

  function chooseStatus(next: HrStatus) {
    if (next === 'fired') {
      setFireDate(emp.terminationDate || new Date().toISOString().slice(0, 10))
      setPeriodDraft(null)
      return
    }
    if (next === 'sick' || next === 'vacation') {
      setPeriodDraft({ type: next, from: '', to: '' })
      setFireDate(null)
      return
    }
    setEmp((e) => ({
      ...applyHrStatus(e, next),
      terminationDate: undefined,
      statusUntil: undefined,
    }))
    setFireDate(null)
    setPeriodDraft(null)
  }

  function confirmPeriodStatus() {
    if (!periodDraft?.from || !periodDraft.to) return
    if (periodDraft.from > periodDraft.to) {
      setSaveError(t('hr.vacation.badDates'))
      return
    }
    setEmp((e) =>
      applyStatusPeriod(e, periodDraft.type, periodDraft.from, periodDraft.to, 'hr_card'),
    )
    setPeriodDraft(null)
    setSaveError(null)
  }

  function confirmFire() {
    if (!fireDate) return
    setEmp((e) => {
      const fired = { ...applyHrStatus(e, 'fired'), terminationDate: fireDate }
      return confirmDismissalSettlement(fired, { terminationDate: fireDate })
    })
    setFireDate(null)
  }

  const lockResourceId = !isNew && emp.id ? employeeLockId(emp.id) : null
  const {
    mode: lockMode,
    foreignLock,
    takeOver,
    resetForeignLock,
    canForceTakeOver: lockCanForce,
    stayReadonly,
  } = useEditLock({
    resourceId: lockResourceId,
    resourceType: 'employee',
    holderUid: lockHolderUid,
    holderName: lockHolderName || lockHolderUid,
    enabled: Boolean(lockResourceId),
    canForceTakeOver,
  })
  const readOnly = lockMode === 'readonly'

  async function saveAndClose() {
    if (readOnly) {
      setSaveError(t('editLock.cannotSaveReadonly'))
      return
    }
    const fullNameError = validateFullName()
    if (fullNameError) {
      setSaveError(fullNameError)
      setTab('overview')
      return
    }
    const tabNum = emp.tabNumber.trim() || suggestNextTabNumber(employees)
    if (isTabNumberTaken(employees, tabNum, emp.id)) {
      setSaveError(t('hr.err.tabTaken'))
      setTab('overview')
      return
    }

    const storeEmp = employees.find((e) => e.id === emp.id)
    if (storeEmp && !isNew) {
      const storeFp = fingerprintEmployee(storeEmp)
      const draftFp = fingerprintEmployee(emp)
      if (storeFp !== baselineFpRef.current && storeFp !== draftFp) {
        const choice = await confirmUnsaved({
          title: t('editLock.conflictTitle'),
          message: t('editLock.conflictMsg'),
          saveLabel: t('editLock.overwrite'),
          discardLabel: t('editLock.reload'),
          cancelLabel: t('common.cancel'),
        })
        if (choice === 'cancel') return
        if (choice === 'discard') {
          setEmp(storeEmp)
          baselineFpRef.current = storeFp
          setSaveError(t('editLock.reloaded'))
          return
        }
        // save = overwrite
      }
    }

    const lockedEmpNo =
      (!isNew && storeEmp?.employeeNumber?.trim()) || emp.employeeNumber?.trim() || ''
    const payload = {
      ...emp,
      tabNumber: tabNum,
      ...(lockedEmpNo ? { employeeNumber: lockedEmpNo } : {}),
      fullName: emp.fullName.trim(),
      nameKa: emp.nameKa?.trim() || undefined,
      nameEn: emp.nameEn?.trim() || undefined,
    }
    onSave(payload)
    baselineFpRef.current = fingerprintEmployee(payload)
    onClose()
  }

  const windowTitle = useMemo(() => {
    if (isNew) return locale === 'ka' ? 'ახალი თანამშრომელი' : 'Новый сотрудник'
    const name = emp.fullName?.trim() || emp.tabNumber || '—'
    return name
  }, [isNew, emp.fullName, emp.tabNumber, locale])

  const dirty = useMemo(() => {
    try {
      return JSON.stringify(emp) !== JSON.stringify(initial)
    } catch {
      return true
    }
  }, [emp, initial])

  const {
    visible,
    canMinimize,
    handleMinimize,
    requestClose,
    onBackdropInteract,
  } = useWindowChrome({
    open: true,
    windowId,
    title: windowTitle,
    onClose,
    dirty: dirty && !readOnly,
    onSaveDirty: async () => {
      if (readOnly) throw new Error('readonly')
      const tabNum = (emp.tabNumber || '').trim()
      const fullNameError = validateFullName()
      if (fullNameError) {
        setSaveError(fullNameError)
        setTab('overview')
        throw new Error('validation')
      }
      if (!tabNum) {
        setSaveError(t('hr.err.tabRequired'))
        setTab('overview')
        throw new Error('validation')
      }
      if (isTabNumberTaken(employees, tabNum, emp.id)) {
        setSaveError(t('hr.err.tabTaken'))
        setTab('overview')
        throw new Error('validation')
      }
      onSave({
        ...emp,
        tabNumber: tabNum,
        fullName: emp.fullName.trim(),
        nameKa: emp.nameKa?.trim() || undefined,
        nameEn: emp.nameEn?.trim() || undefined,
      })
    },
  })

  const { zIndex } = useModalScope({
    open: visible,
    onClose: () => {
      void requestClose()
    },
    containerRef: panelRef,
    onPrimaryAction: () => {
      void saveAndClose()
    },
    initialFocus: 'none',
  })

  function addDocumentFromAttachment() {
    const url = docForm.fileUrl.trim()
    if (!url) return
    const doc: HrDocument = {
      id: newId(),
      title: docForm.title.trim() || docForm.fileName || t('hr.attach.untitled'),
      docType: docForm.docType,
      issuedAt: docForm.issuedAt || undefined,
      uploadedAt: new Date().toISOString().slice(0, 10),
      expiresAt: docForm.expiresAt || undefined,
      uploadedBy: 'HR',
      fileName: docForm.fileName,
      fileUrl: url,
    }
    patch({ hrDocuments: [...(emp.hrDocuments ?? []), doc] })
    setDocForm({
      title: '',
      docType: HR_DOC_TYPES[0],
      issuedAt: '',
      expiresAt: '',
      fileUrl: '',
      fileName: undefined,
    })
  }

  function removeDocument(id: string) {
    setEmp((e) => removeHrDocumentToTrash(e, id))
  }

  function saveContract(contract: HrEmploymentContract) {
    const hrContracts = upsertEmploymentContract(emp.hrContracts, contract)
    const sync: Partial<Employee> = { hrContracts }
    if (contract.isPrimary) {
      if (contract.agreementKind) sync.employmentAgreementKind = contract.agreementKind
      if (contract.contractType) sync.contractType = contract.contractType
      if (contract.salary != null && contract.salary > 0) sync.monthlySalary = contract.salary
      if (contract.position) sync.position = contract.position
      if (contract.positionKa) sync.positionKa = contract.positionKa
      if (contract.positionId) sync.positionId = contract.positionId
    }
    patch(sync)
    setContractDialog({ open: false, initial: null })
  }

  async function removeContract(id: string) {
    const ok = await confirm({
      title: t('hr.contract.removeTitle'),
      message: t('hr.contract.removeConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('planner.cancel'),
      danger: true,
    })
    if (!ok) return
    setEmp((e) => removeHrContractToTrash(e, id))
  }

  function addAbsence() {
    if (!absForm.startDate || !absForm.endDate) return
    if (absForm.startDate > absForm.endDate) {
      setSaveError(t('hr.vacation.badDates'))
      return
    }
    if (absForm.type === 'sick' || absForm.type === 'vacation') {
      setEmp((e) =>
        applyStatusPeriod(e, absForm.type as 'sick' | 'vacation', absForm.startDate, absForm.endDate),
      )
    } else {
      setEmp((e) => {
        const a = {
          id: newId(),
          type: absForm.type,
          startDate: absForm.startDate,
          endDate: absForm.endDate,
          reason: absForm.reason || undefined,
        }
        return appendEmployeeJournal(
          { ...e, hrAbsences: [...(e.hrAbsences ?? []), a] },
          journalFromAbsence(a, 'hr_card'),
        )
      })
    }
    setAbsForm({ type: 'vacation', startDate: '', endDate: '', reason: '' })
    setSaveError(null)
  }

  function removeAbsence(id: string) {
    const removed = (emp.hrAbsences ?? []).find((a) => a.id === id)
    setEmp((e) => {
      let next: Employee = {
        ...e,
        hrAbsences: (e.hrAbsences ?? []).filter((a) => a.id !== id),
      }
      next = recomputeStatusFromAbsences(next)
      if (!removed) return next
      return appendEmployeeJournal(next, {
        kind: journalFromAbsence(removed, 'hr_card').kind,
        startDate: removed.startDate,
        endDate: removed.endDate,
        note: locale === 'ka' ? 'წაშლა' : 'Удалено',
        source: 'hr_card',
      })
    })
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
    const salaryPatch = salaryFieldsFromPosition(emp, p)
    patch({
      ...applyPositionToEmployeeFields(p, unit),
      ...(salaryPatch ?? {}),
      currency: salaryPatch?.currency ?? p.currency,
      contractType: p.contractType,
      probationMonths: p.probationMonths,
    })
  }

  if (!visible) return null

  return (
    <>
      {createPortal(
        <div
          className={CHROME_BACKDROP_CLASS}
          style={{ zIndex }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onBackdropInteract()
          }}
        >
          <div
            ref={panelRef}
            className="app-dialog-panel flex w-full max-w-3xl flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {foreignLock && (
              <EditLockBanner
                lock={foreignLock}
                readonly={readOnly}
                canTakeOver={lockCanForce}
                onTakeOver={() => void takeOver()}
                onResetLock={() => {
                  void (async () => {
                    const ok = await resetForeignLock()
                    if (!ok) setSaveError(t('editLock.resetFailed'))
                  })()
                }}
                onReadonly={stayReadonly}
              />
            )}
            <header className="flex shrink-0 flex-col gap-3 border-b border-grid bg-stone-50 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:py-4">
              <div className="flex min-w-0 gap-3 sm:gap-4">
                <EmployeePhoto
                  photoDataUrl={emp.photoDataUrl}
                  gender={emp.gender ?? 'unknown'}
                  className="h-16 w-12 shrink-0 rounded-sm object-cover ring-1 ring-grid sm:h-20 sm:w-16"
                />
                <div className="min-w-0">
                  {isNew ? (
                    <p className="text-base font-bold leading-tight text-ink sm:text-lg">
                      Новый сотрудник
                    </p>
                  ) : (
                    <BilingualText
                      lines={employeeNameLines(emp)}
                      className="text-base font-bold leading-tight sm:text-lg"
                    />
                  )}
                  {!isNew && (
                    <div className="mt-1">
                      <BilingualText
                        lines={employeePositionLines(emp)}
                        className="text-sm font-medium leading-tight text-accent"
                      />
                    </div>
                  )}
                  <p className="mt-1.5 font-mono text-xs text-stone-500">
                    № {emp.employeeNumber || emp.tabNumber || '—'}
                    {emp.department ? (
                      <span className="ml-2 font-sans">· {emp.department}</span>
                    ) : null}
                  </p>
                  {(emp.personalId || emp.citizenship || emp.birthDate) && (
                    <p className="mt-0.5 text-[11px] text-stone-400">
                      {[emp.citizenship, emp.personalId, emp.birthDate].filter(Boolean).join(' · ')}
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
              <div className="flex shrink-0 flex-wrap items-center gap-2 self-start">
                <button
                  type="button"
                  className="inline-flex items-center rounded-sm border border-grid bg-white px-3 py-1.5 text-sm hover:bg-paper-dark"
                  onClick={() => setCamera('photo')}
                >
                  Фото
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-sm border border-grid bg-white px-3 py-1.5 text-sm hover:bg-paper-dark"
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
                {canMinimize ? (
                  <button
                    type="button"
                    className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
                    aria-label={t('workspace.minimize')}
                    title={t('workspace.minimize')}
                    onClick={handleMinimize}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
                      <path
                        d="M4 14h12"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded-sm p-2 text-stone-400 transition hover:bg-stone-100 hover:text-ink"
                  aria-label={t('common.close')}
                  onClick={() => {
                    void requestClose()
                  }}
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
            </header>

            <div className="flex shrink-0 flex-wrap gap-1 border-b border-grid px-3 py-2 sm:px-4">
              {tabs.map((tabItem) => (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => setTab(tabItem.id)}
                  className={`rounded-sm px-2.5 py-1.5 text-xs font-semibold sm:px-3 ${
                    tab === tabItem.id
                      ? 'bg-accent text-white'
                      : 'text-stone-600 hover:bg-paper-dark'
                  }`}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>

            <div className="app-dialog-body px-4 py-4 sm:px-6">
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
                <div className="col-span-full rounded-sm border border-grid bg-stone-50/80 p-3 sm:p-4">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      {t('hr.nameBlock.title')}
                    </p>
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-40"
                      disabled={!emp.fullName.trim()}
                      title={t('hr.nameBlock.fromRuHint')}
                      onClick={() => {
                        nameKaManualRef.current = false
                        nameEnManualRef.current = false
                        applyLocalizedNamesFromRu(emp.fullName, true)
                      }}
                    >
                      {t('hr.nameBlock.fromRu')}
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.nameBlock.ru')} <span className="text-red-500">*</span>
                      <input
                        required
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={emp.fullName}
                        onChange={(e) => onFullNameChange(e.target.value)}
                        autoFocus={isNew}
                        placeholder="Ника Цулая"
                      />
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.nameBlock.ka')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={emp.nameKa ?? ''}
                        onChange={(e) => {
                          nameKaManualRef.current = true
                          patch({ nameKa: e.target.value })
                        }}
                        placeholder="ნიკა წულაია"
                      />
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.nameBlock.en')}
                      <input
                        className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                        value={emp.nameEn ?? ''}
                        onChange={(e) => {
                          nameEnManualRef.current = true
                          patch({ nameEn: e.target.value })
                        }}
                        placeholder="Nika Tsulaia"
                      />
                    </label>
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-stone-400">
                    {t('hr.nameBlock.autoHint')}
                  </p>
                </div>
                <label className="block text-xs font-medium text-stone-500">
                  {t('hr.employeeNumber')}
                  <input
                    className="mt-1 w-full cursor-default rounded-sm border border-grid bg-stone-50 px-3 py-2 font-mono text-sm text-stone-700"
                    value={emp.employeeNumber || '—'}
                    readOnly
                    title={t('hr.employeeNumber.hint')}
                  />
                </label>
                <label className="block text-xs font-medium text-stone-500">
                  {t('hr.tabNumber')}
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
                      title={t('hr.tabNumber.auto')}
                      onClick={() => patch({ tabNumber: suggestNextTabNumber(employees) })}
                    >
                      {t('hr.tabNumber.autoShort')}
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
                          onScheduleChange(e.target.value as ScheduleType)
                        }
                      >
                        {SCHEDULE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {shiftHoursField}
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
                      {fireDate ? (
                        <DismissalLeaveSettlement
                          emp={emp}
                          fireDate={fireDate}
                          readOnly={readOnly}
                          onSettled={(next) => {
                            setEmp({
                              ...applyHrStatus(next, 'fired'),
                              terminationDate: fireDate,
                            })
                            setFireDate(null)
                          }}
                        />
                      ) : null}
                    </div>
                  )}
                  {periodDraft !== null && (
                    <div
                      className={`mt-3 rounded-sm border p-3 ${
                        periodDraft.type === 'sick'
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-sky-200 bg-sky-50'
                      }`}
                    >
                      <p
                        className={`text-xs font-medium ${
                          periodDraft.type === 'sick' ? 'text-amber-900' : 'text-sky-900'
                        }`}
                      >
                        {periodDraft.type === 'sick' ? t('hr.sickTitle') : t('hr.vacationPeriodTitle')}
                      </p>
                      <p
                        className={`mt-1 text-[11px] ${
                          periodDraft.type === 'sick' ? 'text-amber-800' : 'text-sky-800'
                        }`}
                      >
                        {periodDraft.type === 'sick' ? t('hr.sickHint') : t('hr.vacationPeriodHint')}
                      </p>
                      {periodDraft.type === 'sick' ? (
                        <>
                          <p className="mt-1 text-[11px] text-amber-700">{t('hr.sickPlanFact')}</p>
                          <p className="mt-1 text-[11px] text-amber-700">{t('hr.sickWorkOnly')}</p>
                        </>
                      ) : (
                        <p className="mt-1 text-[11px] text-sky-700">{t('hr.vacationPlanFact')}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="text-xs text-stone-600">
                          {t('hr.sickFrom')}
                          <input
                            type="date"
                            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
                            value={periodDraft.from}
                            onChange={(e) =>
                              setPeriodDraft((r) => (r ? { ...r, from: e.target.value } : r))
                            }
                          />
                        </label>
                        <label className="text-xs text-stone-600">
                          {t('hr.sickTo')}
                          <input
                            type="date"
                            className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
                            value={periodDraft.to}
                            min={periodDraft.from || undefined}
                            onChange={(e) =>
                              setPeriodDraft((r) => (r ? { ...r, to: e.target.value } : r))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className={`rounded-sm px-3 py-2 text-xs font-semibold text-white disabled:opacity-40 ${
                            periodDraft.type === 'sick' ? 'bg-amber-700' : 'bg-sky-700'
                          }`}
                          disabled={!periodDraft.from || !periodDraft.to}
                          onClick={confirmPeriodStatus}
                        >
                          {periodDraft.type === 'sick'
                            ? t('hr.sickConfirm')
                            : t('hr.vacationPeriodConfirm')}
                        </button>
                        <button
                          type="button"
                          className="rounded-sm border border-grid px-3 py-2 text-xs"
                          onClick={() => setPeriodDraft(null)}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                      {sickPreview && periodDraft.type === 'sick' && (
                        <div className="mt-2 space-y-1 text-[11px]">
                          <p className="font-medium text-amber-950">
                            {t('hr.sickWorkDays').replace(
                              '{n}',
                              String(sickPreview.periodWorkDays),
                            )}
                          </p>
                          <p className="text-amber-800">
                            {t('hr.sickChainDays')
                              .replace('{n}', String(sickPreview.chainWorkDays))
                              .replace('{max}', String(MAX_CONSECUTIVE_SICK_WORK_DAYS))}
                          </p>
                          {sickPreview.overLimit ? (
                            <p className="font-semibold text-red-700">{t('hr.sickOverLimit')}</p>
                          ) : null}
                        </div>
                      )}
                      {vacationWorkDaysPreview != null && periodDraft.type === 'vacation' && (
                        <p className="mt-2 text-[11px] font-medium text-sky-950">
                          {t('hr.vacationWorkDays').replace(
                            '{n}',
                            String(vacationWorkDaysPreview),
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {status === 'sick' && emp.statusUntil && periodDraft === null && (
                    <p className="mt-2 text-xs text-amber-800">
                      {t('hr.sickDone')
                        .replace(
                          '{from}',
                          [...(emp.hrAbsences ?? [])]
                            .filter((a) => a.type === 'sick')
                            .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.startDate ?? '—',
                        )
                        .replace('{to}', emp.statusUntil)}
                    </p>
                  )}
                  {status === 'vacation' && emp.statusUntil && periodDraft === null && (
                    <p className="mt-2 text-xs text-sky-800">
                      {t('hr.vacationPeriodDone')
                        .replace(
                          '{from}',
                          [...(emp.hrAbsences ?? [])]
                            .filter((a) => a.type === 'vacation')
                            .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]?.startDate ?? '—',
                        )
                        .replace('{to}', emp.statusUntil)}
                    </p>
                  )}
                  {status === 'fired' && emp.terminationDate && fireDate === null && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-red-600">
                        {t('hr.fireDone').replace('{date}', emp.terminationDate)}
                      </p>
                      <DismissalLeaveSettlement
                        emp={emp}
                        fireDate={emp.terminationDate}
                        readOnly={readOnly}
                        onSettled={(next) => setEmp(next)}
                      />
                    </div>
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
                <label className="block text-xs font-medium text-stone-500">
                  График
                  <select
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={emp.schedule}
                    onChange={(e) =>
                      onScheduleChange(e.target.value as ScheduleType)
                    }
                  >
                    {SCHEDULE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {shiftHoursField}
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
                <>
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.pay.monthlySalary')}
                      {canEditSalary && !readOnly ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          data-coach="hr:cardSalary"
                          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                          value={emp.monthlySalary != null ? String(emp.monthlySalary) : ''}
                          placeholder="—"
                          onChange={(e) => applyMonthlySalaryInput(e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          readOnly
                          data-coach="hr:cardSalary"
                          title={t('hr.pay.monthlySalaryReadOnlyTitle')}
                          className="mt-1 w-full cursor-not-allowed rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm text-stone-600"
                          value={
                            emp.monthlySalary != null
                              ? `${emp.monthlySalary.toLocaleString('ru-RU')} ₾/мес`
                              : emp.hourlyRate != null
                                ? `${emp.hourlyRate.toLocaleString('ru-RU')} ₾/ч`
                                : '—'
                          }
                        />
                      )}
                      <span className="mt-1 block text-[11px] text-stone-400">
                        {canEditSalary
                          ? t('hr.pay.monthlySalaryHint')
                          : t('hr.pay.monthlySalaryReadOnly')}
                      </span>
                    </label>
                    <StaffRateField
                      id={`staff-rate-${emp.id}`}
                      value={emp.staffRate}
                      label={t('hr.pay.staffRate')}
                      hint={t('hr.pay.staffRateHint')}
                      customOptionLabel={t('finance.rates.staffRateCustom')}
                      onChange={(staffRate) => patch({ staffRate })}
                    />
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.pay.currency')}
                      <select
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.currency ?? 'GEL'}
                        onChange={(e) =>
                          patch({ currency: e.target.value as Employee['currency'] })
                        }
                      >
                        <option value="GEL">GEL</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="RUB">RUB</option>
                      </select>
                    </label>
                    <label className="flex items-start gap-2 text-xs font-medium text-stone-500 sm:col-span-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={emp.pensionScheme !== false}
                        onChange={(e) => patch({ pensionScheme: e.target.checked })}
                      />
                      <span>
                        <span className="block font-semibold text-stone-700">
                          {t('hr.pay.pensionScheme')}
                        </span>
                        <span className="mt-0.5 block font-normal text-stone-400">
                          {t('hr.pay.pensionSchemeHint')}
                        </span>
                      </span>
                    </label>
                    <label className="block text-xs font-medium text-stone-500">
                      {t('hr.pay.mealAllowance')}
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                        value={emp.mealAllowanceGel ?? ''}
                        onChange={(e) => {
                          const v = e.target.value.trim()
                          patch({
                            mealAllowanceGel: v === '' ? undefined : Number(v.replace(',', '.')),
                          })
                        }}
                        placeholder="0"
                      />
                      <span className="mt-1 block text-[11px] text-stone-400">
                        {t('hr.pay.mealAllowanceHint')}
                      </span>
                    </label>
                    {emp.contractType && (
                      <p className="col-span-full text-xs text-stone-500">
                        {hrContractLabel(emp.contractType, locale)}
                      </p>
                    )}
                  </>
              </div>
            )}

            {tab === 'contracts' && (
              <div className="space-y-4">
                <div className="rounded-sm border border-grid bg-paper-dark/50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{t('hr.contract.sectionTitle')}</p>
                      <p className="mt-1 text-xs text-stone-500">{t('hr.contract.sectionHint')}</p>
                    </div>
                    {!readOnly && (
                      <button
                        type="button"
                        className="rounded-sm border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                        onClick={() => setContractDialog({ open: true, initial: null })}
                      >
                        {t('hr.contract.add')}
                      </button>
                    )}
                  </div>
                  <label className="mt-3 block text-xs font-medium text-stone-500">
                    {t('hr.contract.agreementKind')}
                    <select
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={emp.employmentAgreementKind ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        patch({
                          employmentAgreementKind:
                            e.target.value === ''
                              ? undefined
                              : (e.target.value as Employee['employmentAgreementKind']),
                        })
                      }
                    >
                      <option value="">— {t('hr.contract.notSet')} —</option>
                      <option value="permanent">
                        {employmentAgreementLabel('permanent', locale)}
                      </option>
                      <option value="fixed_term">
                        {employmentAgreementLabel('fixed_term', locale)}
                      </option>
                    </select>
                    <span className="mt-1 block text-[11px] text-stone-400">
                      {t('hr.contract.agreementKindHint')}
                    </span>
                  </label>
                </div>
                <HrEmploymentContractsPanel
                  rows={employeeContractRows(emp)}
                  compact
                  showAll
                  onEdit={
                    readOnly
                      ? undefined
                      : (c) => setContractDialog({ open: true, initial: c })
                  }
                  onRemove={readOnly ? undefined : (id) => void removeContract(id)}
                />
                {(emp.hrContractsTrash ?? []).length > 0 && (
                  <div className="rounded-sm border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs font-semibold text-amber-900">
                      {t('hr.contract.trashTitle')}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {(emp.hrContractsTrash ?? []).map((item) => (
                        <li
                          key={item.deletedAt}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-stone-700">
                            {item.contract.position || item.contract.contractNumber || item.contract.id}
                          </span>
                          {!readOnly && (
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-accent hover:underline"
                                onClick={() =>
                                  setEmp((e) => restoreHrContractFromTrash(e, item.deletedAt))
                                }
                              >
                                {t('hr.restore')}
                              </button>
                              <button
                                type="button"
                                className="text-red-600 hover:underline"
                                onClick={() => setEmp((e) => purgeHrContractTrash(e, item.deletedAt))}
                              >
                                {t('settings.trashPurge')}
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {tab === 'documents' && (
              <div className="space-y-4">
                <CecIdentityPanel emp={emp} onPatch={patch} />
                {(isForeignPersonnel(emp) || emp.foreignStatus) && (
                  <HrForeignStatusPanel
                    value={emp.foreignStatus}
                    onChange={(foreignStatus) => patch({ foreignStatus })}
                  />
                )}
                {!isForeignPersonnel(emp) && !emp.foreignStatus && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-sky-800 underline"
                    onClick={() => patch({ foreignStatus: {} })}
                  >
                    {t('hr.foreign.enable')}
                  </button>
                )}
                <div className="rounded-sm border border-grid bg-paper-dark/50 p-4">
                  <p className="mb-3 text-xs text-stone-600">{t('hr.documents.archiveHint')}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      className="rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder={t('hr.document.titlePh')}
                      value={docForm.title}
                      disabled={readOnly}
                      onChange={(e) => setDocForm((f) => ({ ...f, title: e.target.value }))}
                    />
                    <select
                      className="rounded-sm border border-grid px-3 py-2 text-sm"
                      value={docForm.docType}
                      disabled={readOnly}
                      onChange={(e) => setDocForm((f) => ({ ...f, docType: e.target.value }))}
                    >
                      {HR_DOC_TYPES.map((dt) => (
                        <option key={dt} value={dt}>
                          {dt}
                        </option>
                      ))}
                    </select>
                    <label className="grid gap-1 text-xs font-medium text-stone-600">
                      {t('hr.document.issuedAt')}
                      <input
                        type="date"
                        className="rounded-sm border border-grid bg-white px-3 py-2 text-sm font-normal text-ink"
                        value={docForm.issuedAt}
                        disabled={readOnly}
                        data-coach="hr:documentIssueDate"
                        onChange={(e) => setDocForm((f) => ({ ...f, issuedAt: e.target.value }))}
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-stone-600">
                      {t('hr.document.expiresAt')}
                      <input
                        type="date"
                        className="rounded-sm border border-grid bg-white px-3 py-2 text-sm font-normal text-ink"
                        value={docForm.expiresAt}
                        disabled={readOnly}
                        data-coach="hr:documentExpiryDate"
                        onChange={(e) =>
                          setDocForm((f) => ({ ...f, expiresAt: e.target.value }))
                        }
                      />
                    </label>
                  </div>
                  {!readOnly && (
                    <>
                      <div className="mt-3">
                        <HrAttachmentField
                          value={{
                            urls: docForm.fileUrl ? [docForm.fileUrl] : [],
                            fileName: docForm.fileName,
                          }}
                          onChange={({ urls, fileName }) =>
                            setDocForm((f) => ({
                              ...f,
                              fileUrl: urls[0] ?? '',
                              fileName,
                            }))
                          }
                          hintKey="hr.document.attachHint"
                          allowMultiple={false}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-sm border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                          onClick={() => addDocumentFromAttachment()}
                        >
                          {t('hr.document.add')}
                        </button>
                        <button
                          type="button"
                          className="rounded-sm border border-grid px-3 py-1.5 text-xs hover:bg-white"
                          onClick={() => setCamera('document')}
                        >
                          {t('hr.document.scanCamera')}
                        </button>
                      </div>
                    </>
                  )}
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
                          {doc.issuedAt && (
                            <span className="ml-2 text-xs text-stone-500">
                              {t('hr.document.issuedAtShort')} {doc.issuedAt}
                            </span>
                          )}
                          {doc.expiresAt && (
                            <span className="ml-2 text-xs text-stone-500">
                              {t('hr.document.expiresAtShort')} {doc.expiresAt}
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
                          {!readOnly && (
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => removeDocument(doc.id)}
                            >
                              {t('common.delete')}
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {(emp.hrDocumentsTrash ?? []).length > 0 && (
                  <div className="rounded-sm border border-amber-200 bg-amber-50/70 p-3">
                    <p className="text-xs font-semibold text-amber-900">
                      {t('hr.documents.trashTitle')}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {(emp.hrDocumentsTrash ?? []).map((item) => (
                        <li
                          key={item.deletedAt}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-stone-700">
                            {item.document.title} · {item.document.docType}
                          </span>
                          {!readOnly && (
                            <span className="flex items-center gap-2">
                              <button
                                type="button"
                                className="text-accent hover:underline"
                                onClick={() =>
                                  setEmp((e) => restoreHrDocumentFromTrash(e, item.deletedAt))
                                }
                              >
                                {t('hr.restore')}
                              </button>
                              <button
                                type="button"
                                className="text-red-600 hover:underline"
                                onClick={() => setEmp((e) => purgeHrDocumentTrash(e, item.deletedAt))}
                              >
                                {t('settings.trashPurge')}
                              </button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {tab === 'timesheet' && store && (
              <HrEmployeeTimesheetPanel employee={emp} store={store} />
            )}
            {tab === 'timesheet' && !store && (
              <p className="text-sm text-ink-muted">{t('hr.timesheet.noStore')}</p>
            )}

            {tab === 'history' && (
              <HrEmployeeHistoryPanel
                employee={emp}
                store={store}
                hrStructuralUnits={hrStructuralUnits}
              />
            )}

            {tab === 'absences' && (
              <div className="space-y-4">
                <LeaveBalancePanel
                  emp={emp}
                  readOnly={readOnly}
                  onChange={(next) => setEmp(next)}
                />
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
                  {absFormWorkDaysPreview && (
                    <div className="sm:col-span-2 space-y-1 text-[11px] text-stone-600">
                      <p>
                        {absForm.type === 'vacation'
                          ? t('hr.vacationWorkDays').replace(
                              '{n}',
                              String(absFormWorkDaysPreview.periodWorkDays),
                            )
                          : t('hr.sickWorkDays').replace(
                              '{n}',
                              String(absFormWorkDaysPreview.periodWorkDays),
                            )}
                      </p>
                      {'chainWorkDays' in absFormWorkDaysPreview &&
                      absFormWorkDaysPreview.chainWorkDays != null ? (
                        <p>
                          {t('hr.sickChainDays')
                            .replace('{n}', String(absFormWorkDaysPreview.chainWorkDays))
                            .replace('{max}', String(MAX_CONSECUTIVE_SICK_WORK_DAYS))}
                        </p>
                      ) : null}
                      {'overLimit' in absFormWorkDaysPreview &&
                      absFormWorkDaysPreview.overLimit ? (
                        <p className="font-semibold text-red-700">{t('hr.sickOverLimit')}</p>
                      ) : null}
                    </div>
                  )}
                </div>
                <ul className="space-y-2">
                  {(emp.hrAbsences ?? []).map((a) => (
                    <li
                      key={a.id}
                      className="flex justify-between rounded-sm border border-grid px-3 py-2 text-sm"
                    >
                      <span>
                        {hrAbsenceLabel(a.type, locale)}: {a.startDate} — {a.endDate}
                        {(a.type === 'sick' || a.type === 'vacation') && a.workDays != null
                          ? ` · ${a.workDays} ${t('hr.sickWorkDaysShort')}`
                          : ''}
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
                <div className="rounded-sm border border-grid bg-paper-dark/40 p-3">
                  <p className="text-xs font-semibold text-stone-600">{t('hr.journal.title')}</p>
                  <p className="mt-0.5 text-[11px] text-stone-500">{t('hr.journal.hint')}</p>
                  {(emp.hrJournal ?? []).length === 0 ? (
                    <p className="mt-2 text-xs text-stone-400">{t('hr.journal.empty')}</p>
                  ) : (
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
                      {(emp.hrJournal ?? []).map((j) => (
                        <li
                          key={j.id}
                          className="flex flex-wrap justify-between gap-x-2 rounded-sm border border-grid/60 bg-white px-2 py-1.5"
                        >
                          <span className="font-medium text-ink">
                            {hrJournalKindLabel(j.kind, locale)}
                            {j.code ? ` (${j.code})` : ''}
                          </span>
                          <span className="text-stone-500">
                            {j.startDate && j.endDate
                              ? `${j.startDate} — ${j.endDate}`
                              : j.dateKey ?? j.at.slice(0, 10)}
                          </span>
                          {j.note ? (
                            <span className="w-full text-stone-400">{j.note}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
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

            {tab === 'attendance' && (
              <HrAttendanceBiometricsPanel
                emp={emp}
                attendance={store?.attendance}
                onPatch={patch}
              />
            )}
            </div>

            <footer className="app-dialog-footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-grid bg-stone-50 px-4 pt-3 sm:px-6">
              <button
                type="button"
                className="inline-flex items-center rounded-sm border border-grid bg-white px-4 py-2 text-sm hover:bg-paper-dark"
                onClick={() => {
                  void requestClose()
                }}
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                data-modal-primary
                data-coach="hr:employeeSave"
                disabled={readOnly}
                className="inline-flex items-center rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  void saveAndClose()
                }}
              >
                {t('common.save')}
              </button>
            </footer>
          </div>
        </div>,
        getModalPortalRoot(),
      )}

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
                issuedAt: docForm.issuedAt || undefined,
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

      {contractDialog.open && (
        <HrContractEditDialog
          open={contractDialog.open}
          initial={contractDialog.initial}
          defaultPosition={emp.position}
          defaultPositionKa={emp.positionKa}
          defaultPositionId={emp.positionId}
          defaultSalary={emp.monthlySalary}
          hrPositions={hrPositions}
          hrStructuralUnits={hrStructuralUnits}
          onUpsertPosition={onUpsertPosition}
          onClose={() => setContractDialog({ open: false, initial: null })}
          onSave={saveContract}
        />
      )}
    </>
  )
}

export type HrStatus = 'active' | 'vacation' | 'sick' | 'fired'

export type HrAbsenceType = 'vacation' | 'sick' | 'business_trip' | 'absence'

export type HrContractType = 'full_time' | 'part_time' | 'temporary' | 'internship'

/** Вид трудового договора (основной / срочный) — кадровый учёт. */
export type EmploymentAgreementKind = 'permanent' | 'fixed_term'

export type HrEmploymentContractStatus = 'active' | 'superseded' | 'pending'

/** Трудовой договор сотрудника (основной или предыдущий). */
export type HrEmploymentContract = {
  id: string
  /** Основной действующий договор по должности. */
  isPrimary?: boolean
  status?: HrEmploymentContractStatus
  position: string
  positionKa?: string
  /** Ссылка на должность из справочника (аддитивно). */
  positionId?: string
  contractNumber?: string
  /** Дата начала / вступления в силу (YYYY-MM-DD). */
  effectiveDate?: string
  endDate?: string
  term?: string
  agreementKind?: EmploymentAgreementKind
  contractType?: HrContractType
  salary?: number
  laborRegistry?: string
  /** Первое вложение (совместимость); при нескольких — то же, что documentUrls[0]. */
  documentUrl?: string
  /** Имя вложенного файла (если загружен с компьютера). Аддитивно. */
  documentFileName?: string
  /** Доп. ссылки (Google Drive и др.). Аддитивно; documentUrl = первая. */
  documentUrls?: string[]
  /**
   * Текст/даты 13-й зарплаты из реестра (совместимость).
   * В UI — галочка hasBonusThirteenth; непустой bonusThirteenth тоже считается «да».
   */
  bonusThirteenth?: string
  /** 13-я зарплата / бонус включён (галочка). Аддитивно. */
  hasBonusThirteenth?: boolean
  /** Страховка по договору. Аддитивно. */
  hasInsurance?: boolean
  note?: string
}

export type HrTrainingCategory = 'instruction' | 'training' | 'certificate' | 'admission'

/** Семейное положение */
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed'

/** Пол сотрудника / кандидата */
export type EmployeeGender = 'male' | 'female' | 'unknown'

export type HrSection =
  | 'employees'
  | 'contracts'
  | 'documents'
  | 'absences'
  | 'trainings'
  | 'pay'
  | 'candidates'
  | 'fired'
  | 'trash'
  | 'reports'
  | 'settings'

export type HrEmployeeModalTab =
  | 'overview'
  | 'work'
  | 'contracts'
  | 'documents'
  | 'absences'
  | 'timesheet'
  | 'history'
  | 'trainings'
  | 'education'
  | 'bank'
  | 'extra'
  | 'notes'
  | 'attendance'

/** Образование сотрудника (может быть несколько записей). */
export type HrEducation = {
  id: string
  /** Уровень: среднее, средне-спец., высшее, магистр… (свободный текст) */
  level?: string
  institution: string
  specialty?: string
  startYear?: string
  endYear?: string
}

/** Запись опыта работы. */
export type HrWorkExperience = {
  id: string
  company: string
  position?: string
  startDate?: string
  endDate?: string
  note?: string
}

/** Банковский счёт сотрудника (Грузия). */
export type HrBankAccount = {
  id: string
  /** Код банка (2 буквы IBAN) — определяется автоматически по IBAN. */
  bankCode?: string
  iban: string
  /** Владелец счёта (вводится вручную, для проверки совпадения с ФИО). */
  holderName?: string
  currency?: 'GEL' | 'USD' | 'EUR' | 'RUB'
  isPrimary?: boolean
  /** С какой даты счёт использовался для выплат (YYYY-MM-DD). */
  validFrom?: string
  /** По какую дату включительно (пусто = действует). */
  validUntil?: string
  note?: string
}

/** Контакт родственника / экстренный контакт. */
export type HrRelative = {
  id: string
  name: string
  /** Кем приходится: супруг(а), родитель, ребёнок… (свободный текст) */
  relation?: string
  phone?: string
  note?: string
}

/** Статус кандидата (воронка найма). */
export type CandidateStatus =
  | 'new'
  | 'interview_scheduled'
  | 'interviewed'
  | 'probation'
  | 'accepted'
  | 'reserve'
  | 'rejected_interview'
  | 'no_show'
  | 'declined'

/** Один вопрос анкеты (HR пишет вопрос и ответ). */
export type CandidateQuestionnaireItem = {
  id: string
  /** Ключ шаблона Fibercell (если из шаблона). */
  templateKey?: string
  question: string
  answer: string
}

/** Анкета кандидата — заполняет HR на собеседовании. */
export type CandidateQuestionnaire = {
  /** Дата заполнения YYYY-MM-DD */
  filledAt?: string
  /** Кто заполнял / заметка HR */
  interviewerNote?: string
  /** Согласие на обработку ПДн */
  consent?: boolean
  items: CandidateQuestionnaireItem[]
  updatedAt: string
}

/** Кандидат — потенциальный сотрудник на позицию. */
export type Candidate = {
  id: string
  fullName: string
  nameKa?: string
  /** ФИО латиницей (черновик из русского). */
  nameEn?: string
  phone?: string
  email?: string
  /** Желаемая / рассматриваемая должность. */
  position?: string
  department?: string
  desiredSalary?: number
  currency?: 'GEL' | 'USD' | 'RUB'
  status: CandidateStatus
  /** Источник: рекомендация, hh, объявление… */
  source?: string
  /** Дата собеседования. */
  interviewDate?: string
  birthDate?: string
  personalId?: string
  citizenship?: string
  address?: string
  gender?: EmployeeGender
  photoDataUrl?: string
  photoStoragePath?: string
  note?: string
  education?: HrEducation[]
  workExperience?: HrWorkExperience[]
  documents?: HrDocument[]
  /** Анкета Fibercell / свободные Q&A с собеседования */
  questionnaire?: CandidateQuestionnaire
  createdAt: string
  updatedAt: string
}

export type TrashCandidate = {
  candidate: Candidate
  deletedAt: string
}

/** Структурное подразделение (штатное расписание). */
export type HrStructuralUnit = {
  id: string
  name: string
  sortOrder: number
  archived?: boolean
}

export type HrPosition = {
  id: string
  title: string
  /** Структурное подразделение (ссылка). */
  structuralUnitId?: string
  /** Дублируется для совместимости и печати. */
  department: string
  /** Разряд. */
  rank?: string
  /** Класс (категория) квалификации. */
  qualificationClass?: string
  grade?: string
  salary: number
  currency: 'RUB' | 'GEL' | 'USD'
  contractType: HrContractType
  probationMonths?: number
  schedule?: string
  duties?: string
  archived?: boolean
}

export type HrDocument = {
  id: string
  title: string
  docType: string
  issuedAt?: string
  uploadedAt: string
  expiresAt?: string
  uploadedBy: string
  fileUrl?: string
  fileName?: string
}

export type HrDocumentTrashItem = {
  deletedAt: string
  document: HrDocument
}

export type HrEmploymentContractTrashItem = {
  deletedAt: string
  contract: HrEmploymentContract
}

export type HrAbsence = {
  id: string
  type: HrAbsenceType
  startDate: string
  endDate: string
  reason?: string
  /**
   * Число рабочих дней по графику в периоде (для больничного —
   * дни, в которые ставится «Б»; лимит оплаты подряд — 40).
   * Для отпуска — дни, списываемые с остатка отпускных.
   */
  workDays?: number
}

/** Сколько отпускных дней начисляется за полный календарный месяц в штате. */
export const LEAVE_DAYS_PER_FULL_MONTH = 2

/**
 * Ручные движения по отпускным (стартовый остаток при переходе на программу,
 * корректировки, компенсация при увольнении).
 * Начисление за месяцы и списание по отпускам считаются отдельно.
 */
export type LeaveLedgerKind = 'opening' | 'adjustment' | 'payout'

export type LeaveLedgerEntry = {
  id: string
  /** YYYY-MM-DD */
  date: string
  kind: LeaveLedgerKind
  /** Знак: + для opening/adjustment, − для payout (или отрицательная корректировка). */
  days: number
  note?: string
  byName?: string
  at: string
  /** Снимок остатка после операции (для отчётов). */
  balanceAfter?: number
  /** Оценка/факт компенсации ₾ (для payout / увольнения). */
  amountGel?: number
  /** Ссылка на запись в hrDocuments (архив на каждую операцию). */
  documentId?: string
  fileUrl?: string
  fileName?: string
}

/**
 * Зафиксированный расчёт при увольнении (снимок для сложных отчётов).
 * Всегда создаёт запись в hrDocuments; опционально — скан приказа/расчёта.
 */
export type DismissalSettlement = {
  id: string
  /** YYYY-MM-DD */
  terminationDate: string
  createdAt: string
  leaveBalanceDays: number
  leaveCompensationGel: number
  dailyRate: number
  monthlySalary?: number
  accruedMonths: number
  usedDays: number
  openingDays: number
  note?: string
  /** Ссылка на hrDocuments */
  documentId?: string
  fileUrl?: string
  fileName?: string
  /** Связанная строка leaveLedger (payout), если списали дни */
  leaveLedgerPayoutId?: string
  status: 'confirmed'
}

/** Журнал HR-действий по сотруднику (отсутствия + движение: бригада, ЗП, должность…). */
export type HrJournalKind =
  | 'sick'
  | 'vacation'
  | 'business_trip'
  | 'absence'
  | 'truancy'
  | 'unpaid_leave'
  | 'idle'
  | 'status'
  | 'leave_opening'
  | 'leave_adjustment'
  | 'leave_payout'
  | 'dismissal_settlement'
  | 'brigade_transfer'
  | 'salary_change'
  | 'position_change'
  | 'schedule_change'
  | 'bank_account_change'
  | 'unit_change'
  | 'name_change'

export type HrJournalEntry = {
  id: string
  at: string
  kind: HrJournalKind
  startDate?: string
  endDate?: string
  dateKey?: string
  month?: string
  code?: string
  note?: string
  source: 'hr_card' | 'timesheet' | 'vacation_form' | 'leave_ledger' | 'brigade_transfer'
  /** Куда попало в табеле при оформлении из HR */
  timesheetTarget?: 'plan' | 'fact' | 'both'
  /** Связь с архивом / ledger / settlement */
  documentId?: string
  leaveLedgerId?: string
  dismissalSettlementId?: string
  /** Движение: откуда → куда (бригада) или старое/новое значение. */
  fromBrigade?: string
  toBrigade?: string
  prev?: string
  next?: string
}

export type HrTraining = {
  id: string
  title: string
  category: HrTrainingCategory
  validUntil?: string
  note?: string
}

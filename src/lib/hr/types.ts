export type HrStatus = 'active' | 'vacation' | 'sick' | 'fired'

export type HrAbsenceType = 'vacation' | 'sick' | 'business_trip' | 'absence'

export type HrContractType = 'full_time' | 'part_time' | 'temporary' | 'internship'

/** Вид трудового договора для выдачи спецодежды */
export type EmploymentAgreementKind = 'permanent' | 'fixed_term'

export type HrTrainingCategory = 'instruction' | 'training' | 'certificate' | 'admission'

/** Семейное положение */
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed'

/** Пол сотрудника / кандидата */
export type EmployeeGender = 'male' | 'female' | 'unknown'

export type HrSection =
  | 'employees'
  | 'cards'
  | 'documents'
  | 'absences'
  | 'trainings'
  | 'pay'
  | 'candidates'
  | 'trash'
  | 'reports'
  | 'settings'

export type HrEmployeeModalTab =
  | 'overview'
  | 'work'
  | 'documents'
  | 'absences'
  | 'trainings'
  | 'education'
  | 'bank'
  | 'extra'
  | 'notes'

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

/** Кандидат — потенциальный сотрудник на позицию. */
export type Candidate = {
  id: string
  fullName: string
  nameKa?: string
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
  uploadedAt: string
  expiresAt?: string
  uploadedBy: string
  fileUrl?: string
  fileName?: string
}

export type HrAbsence = {
  id: string
  type: HrAbsenceType
  startDate: string
  endDate: string
  reason?: string
}

export type HrTraining = {
  id: string
  title: string
  category: HrTrainingCategory
  validUntil?: string
  note?: string
}

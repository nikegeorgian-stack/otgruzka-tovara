export type DayCode = '8' | '11' | 'Н' | '22' | 'В' | 'ОТ' | 'ОО' | 'Б' | 'X' | 'ПР' | ''

import type { CounterpartyStore } from './counterparties/types'
import type { FinishedProductStore } from './finishedProducts/types'
import type { FormulationStore } from './formulations/types'
import type { TechnologistQcStore } from './technologist/types'
import type { WastewaterStore } from './wastewater/types'
import type { PackagingRecipeStore } from './packaging/types'
import type { ProductionStore } from './production/types'
import type { ProcurementStore } from './procurement/types'
import type { SalesStore } from './sales/types'
import type { AiChatStore } from './aiChat/types'
import type { WarehouseStore } from './warehouse/types'
import type { WorkwearStore } from './workwear/types'
import type { ItOfficeStore } from './itOffice/types'
import type { AccessStore } from './access/types'

export type { ProductionStore } from './production/types'
import type {
  EmploymentAgreementKind,
  HrAbsence,
  HrBankAccount,
  HrContractType,
  HrDocument,
  HrEducation,
  HrPosition,
  HrStructuralUnit,
  HrRelative,
  HrStatus,
  HrTraining,
  HrWorkExperience,
  MaritalStatus,
  EmployeeGender,
  Candidate,
  TrashCandidate,
} from './hr/types'

export type {
  EmploymentAgreementKind,
  HrAbsence,
  HrBankAccount,
  HrContractType,
  HrDocument,
  HrEducation,
  HrPosition,
  HrStructuralUnit,
  HrRelative,
  HrStatus,
  HrTraining,
  HrWorkExperience,
  MaritalStatus,
  EmployeeGender,
  HrAbsenceType,
  HrSection,
  HrEmployeeModalTab,
  HrTrainingCategory,
  Candidate,
  CandidateStatus,
  TrashCandidate,
} from './hr/types'

export type {
  WarehouseCategory,
  WarehouseItem,
  StockMovement,
  StockMovementType,
  ItemBalance,
  WarehouseStore,
  WarehouseLocation,
  WarehouseDocument,
  WarehouseAuditEntry,
  UnitConversion,
  TurnoverRow,
} from './warehouse/types'

export type {
  WorkwearCatalogItem,
  WorkwearIssuance,
  WorkwearSeason,
  WorkwearStore,
  WorkwearPpeCategory,
  WorkwearSizeGrid,
} from './workwear/types'

export type ScheduleType = '5/2 8ч' | '2/2 11ч' | '1/1 11ч'

export type Group2x2 = 'А' | 'Б' | ''

export type ShiftMode = 'day' | 'night'

export type Locale = 'ru' | 'ka'

export type EmploymentStatus = 'active' | 'vacation' | 'maternity' | 'terminated'

export type Employee = {
  id: string
  fullName: string
  tabNumber: string
  position: string
  brigade: string
  schedule: ScheduleType
  group2x2: Group2x2
  cycleStart: string
  active: boolean
  hourlyRate?: number
  monthlySalary?: number
  shiftMode?: ShiftMode
  note?: string
  nameKa?: string
  positionKa?: string
  employmentStatus?: EmploymentStatus
  /** Дата окончания отпуска/декрета (YYYY-MM-DD) */
  statusUntil?: string
  /** Миниатюра фото (data URL) */
  photoDataUrl?: string
  /** HR / персонал (из CRM otgruzka) */
  phone?: string
  department?: string
  line?: string
  shiftLabel?: string
  hrStatus?: HrStatus
  birthDate?: string
  /** Пол: мужской / женский / не определено */
  gender?: EmployeeGender
  address?: string
  /** Гражданство (ISO-подобный код: GE, RU, …) */
  citizenship?: string
  /** Грузинский личный номер (11 цифр) */
  personalId?: string
  /** Фамилия по-грузински — для проверки в реестре ЦИК */
  surnameKa?: string
  /** Адрес регистрации (прописка) */
  registrationAddress?: string
  /** Фактический адрес проживания */
  actualAddress?: string
  hireDate?: string
  grade?: string
  manager?: string
  contractType?: HrContractType
  /** Основной или срочный договор — для выдачи спецодежды */
  employmentAgreementKind?: EmploymentAgreementKind
  probationMonths?: number
  currency?: 'RUB' | 'GEL' | 'USD'
  hrNotes?: string
  hrDocuments?: HrDocument[]
  hrAbsences?: HrAbsence[]
  hrTrainings?: HrTraining[]
  /** Дата увольнения (YYYY-MM-DD) — при статусе fired. */
  terminationDate?: string
  email?: string
  maritalStatus?: MaritalStatus
  education?: HrEducation[]
  workExperience?: HrWorkExperience[]
  bankAccounts?: HrBankAccount[]
  /** Контакты родственников / экстренные контакты. */
  relatives?: HrRelative[]
  /** Если сотрудник создан из кандидата — ссылка на исходного кандидата. */
  fromCandidateId?: string
  /** Структурное подразделение (штатное расписание). */
  structuralUnitId?: string
  /** Должность из справочника. */
  positionId?: string
}

export type TimesheetRow = {
  id: string
  brigade: string
  employeeId: string | null
  sortOrder: number
}

/** Замена персонала на один день (факт табеля) */
export type DaySubstitution = {
  absentCode: DayCode
  substituteEmployeeId: string
  substituteCode: DayCode
  note?: string
}

export type MonthSheet = {
  month: string
  rows: TimesheetRow[]
  plan: Record<string, Record<string, DayCode>>
  fact: Record<string, Record<string, DayCode>>
  factOverrides: string[]
  /** rowId|YYYY-MM-DD → комментарий */
  comments: Record<string, string>
  /** rowId|YYYY-MM-DD → замена (отсутствующий = строка rowId) */
  substitutions: Record<string, DaySubstitution>
  /** rowId|YYYY-MM-DD → доп. часы сверх нормы смены в факте (1–6) */
  factExtraHours?: Record<string, number>
}

export type AuditEntry = {
  id: string
  at: string
  action:
    | 'fact_change'
    | 'plan_change'
    | 'comment'
    | 'substitution'
    | 'employee_remove'
    | 'month_remove'
    | 'bulk'
    | 'candidate_remove'
    | 'candidate_hire'
  month?: string
  employeeId?: string
  rowId?: string
  dateKey?: string
  detail: string
  oldValue?: string
  newValue?: string
}

export type TrashEmployee = { employee: Employee; deletedAt: string }
export type TrashMonth = { sheet: MonthSheet; deletedAt: string }

export type ShiftTemplate = {
  id: string
  name: string
  schedule: ScheduleType
  group2x2?: Group2x2
  shiftMode?: ShiftMode
  cycleStart?: string
}

export type PrintSignatures = {
  masterRu?: string
  masterKa?: string
  accountantRu?: string
  accountantKa?: string
  directorRu?: string
  directorKa?: string
}

import type { AiProviderId } from '@/lib/ai/providers'

export type AiSettings = {
  /** off | openai | kimi | custom */
  provider?: AiProviderId
  enabled?: boolean
  apiKey?: string
  /** OpenAI-compatible endpoint, напр. https://api.openai.com/v1 */
  baseUrl?: string
  model?: string
}

export type AppStore = {
  version: 6
  brigades: string[]
  /** Грузинское название бригады (ключ — русское имя) */
  brigadeNamesKa: Record<string, string>
  /** Бригадир (ключ — русское имя бригады, значение — id сотрудника) */
  brigadiers: Record<string, string>
  archivedMonths: string[]
  employees: Employee[]
  /** Кандидаты (воронка найма). */
  candidates: Candidate[]
  months: Record<string, MonthSheet>
  auditLog: AuditEntry[]
  trash: { employees: TrashEmployee[]; months: TrashMonth[]; candidates: TrashCandidate[] }
  shiftTemplates: ShiftTemplate[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  production: ProductionStore
  sales: SalesStore
  /** Неудаляемый лог обращений к ИИ-помощнику (для аналитики затруднений). */
  aiChat: AiChatStore
  counterparties: CounterpartyStore
  finishedProducts: FinishedProductStore
  packagingRecipes: PackagingRecipeStore
  formulations: FormulationStore
  technologistQc: TechnologistQcStore
  wastewater: WastewaterStore
  warehouse: WarehouseStore
  workwear: WorkwearStore
  itOffice: ItOfficeStore
  procurement: ProcurementStore
  access: AccessStore
  settings: {
    responsible: string
    site: string
    locale: Locale
    tourCompleted?: boolean
    lastBackupDate?: string
    signatures?: PrintSignatures
    ai?: AiSettings
  }
}

export const STORAGE_KEY = 'fibercell-tabel-v6'
export const TRASH_RETENTION_DAYS = 7
export const MAX_AUDIT_ENTRIES = 500

export type ViewId =
  | 'month'
  | 'directories'
  /** @deprecated — открывает Справочники → Сотрудники */
  | 'employees'
  | 'hr'
  | 'production'
  | 'planner'
  | 'summary'
  /** @deprecated — открывает Персонал → Оплата */
  | 'pay'
  /** @deprecated — открывает Справочники → Коды */
  | 'codes'
  | 'warehouse'
  | 'procurement'
  | 'finance'
  | 'technologist'
  | 'mixer'
  | 'director'
  | 'journals'
  | 'it'
  | 'settings'

export function commentKey(rowId: string, dateKey: string): string {
  return `${rowId}|${dateKey}`
}

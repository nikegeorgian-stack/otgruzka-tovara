export type DayCode =
  | '4'
  | '6'
  | '8'
  | '10'
  | '11'
  | '12'
  | 'Н'
  | '22'
  | 'В'
  | 'ОТ'
  | 'ОО'
  | 'Б'
  | 'X'
  | 'ПР'
  | ''

import type { PayrollAccrualRules } from './finance/payrollAccrualRules'
import type { CounterpartyStore } from './counterparties/types'
import type { FinishedProductStore } from './finishedProducts/types'
import type { FormulationStore } from './formulations/types'
import type { TechnologistQcStore } from './technologist/types'
import type { OtcStore } from './otc/types'
import type { WastewaterStore } from './wastewater/types'
import type { EngineerLogStore } from './engineerLog/types'
import type { TasksStore } from './tasks/types'
import type { PackagingRecipeStore } from './packaging/types'
import type { ProductionStore } from './production/types'
import type { ProcurementStore } from './procurement/types'
import type { SalesStore } from './sales/types'
import type { AiChatStore } from './aiChat/types'
import type { WarehouseStore } from './warehouse/types'
import type { WorkwearStore } from './workwear/types'
import type { ItOfficeStore } from './itOffice/types'
import type { AccessStore } from './access/types'
import type { FinanceStore } from './finance/types'

export type { ProductionStore } from './production/types'
import type {
  EmploymentAgreementKind,
  HrAbsence,
  HrJournalEntry,
  LeaveLedgerEntry,
  DismissalSettlement,
  HrBankAccount,
  HrContractType,
  HrDocument,
  HrDocumentTrashItem,
  HrEducation,
  HrEmploymentContract,
  HrEmploymentContractTrashItem,
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
  HrEmploymentContract,
  HrPosition,
  HrStructuralUnit,
  HrRelative,
  HrStatus,
  HrTraining,
  HrWorkExperience,
  MaritalStatus,
  EmployeeGender,
  HrAbsenceType,
  HrJournalEntry,
  HrJournalKind,
  LeaveLedgerEntry,
  LeaveLedgerKind,
  DismissalSettlement,
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

export type {
  FinanceStore,
  FinanceAdvance,
  FinanceAdjustment,
  FinanceAdjustmentKind,
  FinancePayout,
  FinancePaymentMethod,
  SickConfirmation,
  PayrollSnapshot,
  PayrollSnapshotRow,
} from './finance/types'

export type ScheduleType = '5/2 8ч' | '2/2 11ч' | '1/1 11ч'

export type Group2x2 = 'А' | 'Б' | ''

export type ShiftMode = 'day' | 'night'

export type Locale = 'ru' | 'ka' | 'en'

export type EmploymentStatus =
  | 'active'
  | 'vacation'
  | 'sick'
  /** @deprecated раньше больничный писал сюда; оставляем для старых данных */
  | 'maternity'
  | 'terminated'

export type Employee = {
  id: string
  fullName: string
  tabNumber: string
  /**
   * Индивидуальный номер навсегда (не табельный).
   * Выдаётся при создании / backfill; дальше не меняется.
   */
  employeeNumber?: string
  position: string
  brigade: string
  schedule: ScheduleType
  /** Часов в смену (если не задано — по умолчанию для графика: 8 для 5/2, 11 для 2/2 и 1/1). */
  shiftHours?: number
  group2x2: Group2x2
  cycleStart: string
  active: boolean
  hourlyRate?: number
  monthlySalary?: number
  /**
   * Штатная ставка (доля единицы): 1 = полная, 0.5 = половина и т.д.
   * Оклад/часовая в карточке — на полную ставку; в расчёте ЗП и аванса умножаются на эту долю.
   * `undefined` = 1.
   */
  staffRate?: number
  /** Индивидуальный оклад/ставка: не перезаписывать из штатного расписания. */
  individualSalary?: boolean
  /** Фиксированный бонус к зарплате ₾/мес (входит в ставку для ЗП/переработки/аванса). */
  monthlyBonus?: number
  /** Включён бонус к зарплате (не из штатки). */
  individualBonus?: boolean
  /** Авто-премия 10% от начисленного по табелю за месяц. */
  bonusPercentFromSalary?: boolean
  /**
   * Единоразовая премия по месяцам (ключ YYYY-MM → ₾).
   * Не входит в почасовую ставку — отдельная строка в расчёте за этот месяц.
   */
  monthPremiums?: Record<string, number>
  /**
   * Правило аванса:
   * default — % из настроек (обычно 30);
   * percent — свой %;
   * fixed — фиксированная сумма;
   * none — не начислять автоматически.
   */
  advanceRule?: 'default' | 'percent' | 'fixed' | 'none'
  /** Свой % аванса (если advanceRule=percent). */
  advancePercent?: number
  /** Фикс аванса ₾ (если advanceRule=fixed). */
  advanceFixedAmount?: number
  shiftMode?: ShiftMode
  note?: string
  nameKa?: string
  /** ФИО латиницей (черновик из русского; можно править вручную). */
  nameEn?: string
  positionKa?: string
  employmentStatus?: EmploymentStatus
  /** Дата окончания отпуска/декрета (YYYY-MM-DD) */
  statusUntil?: string
  /** Миниатюра фото (data URL локально / download URL после hydrate) */
  photoDataUrl?: string
  /** Путь в Firebase Storage (облако) */
  photoStoragePath?: string
  /** PIN для терминала явки (хэш SHA-256) */
  attendancePinHash?: string
  attendancePinSalt?: string
  /**
   * Эмбеддинг лица (face-api 128-d). Старые тестовые 16-вектора игнорируются на киоске.
   */
  attendanceFaceDescriptor?: number[]
  /** Движок эмбеддинга: `faceapi-128` */
  attendanceFaceEngine?: string
  /** Превью кропа лица при регистрации (не полный кадр) */
  attendanceFaceDataUrl?: string
  attendanceFaceEnrolledAt?: string
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
  /** Трудовые договоры: основной + предыдущие. */
  hrContracts?: HrEmploymentContract[]
  /** Удалённые договоры (корзина карточки сотрудника). */
  hrContractsTrash?: HrEmploymentContractTrashItem[]
  currency?: 'RUB' | 'GEL' | 'USD' | 'EUR'
  /**
   * Участник накопительной пенсии (2% сотрудник + 2% работодатель).
   * `undefined` = да (типично для резидентов GE).
   */
  pensionScheme?: boolean
  /** Компенсация питания ₾/мес (для выгрузки 1С / RS; не меняет расчёт табеля). */
  mealAllowanceGel?: number
  hrNotes?: string
  hrDocuments?: HrDocument[]
  /** Удалённые документы (корзина карточки сотрудника). */
  hrDocumentsTrash?: HrDocumentTrashItem[]
  /**
   * Вкладыш для иностранцев: трудовое разрешение, ВНЖ и срок безвизового пребывания.
   * Аддитивно; мониторинг сроков — в инспекторе и окне документов.
   *
   * stayUntil — дата, до которой нужно выехать (визаран) или оформить ВНЖ
   * (в Грузии безвиз обычно до 365 дней с даты въезда; «документ» на границе —
   * штамп въезда / обнуление срока пребывания, не отдельный бланк).
   */
  foreignStatus?: {
    workPermitNumber?: string
    workPermitFrom?: string
    workPermitUntil?: string
    residencePermitNumber?: string
    residencePermitFrom?: string
    residencePermitUntil?: string
    /** Дата последнего въезда в Грузию (штамп в паспорте). YYYY-MM-DD */
    entryDate?: string
    /**
     * Срок законного пребывания без ВНЖ: до этой даты нужно выехать
     * или продлить статус (обычно entryDate + 365 дней).
     */
    stayUntil?: string
    note?: string
  }
  hrAbsences?: HrAbsence[]
  /**
   * Ручной журнал отпускных дней: стартовый остаток (архив при переходе на программу),
   * корректировки, выплаты компенсации. Автоначисление и списание по отпускам — в leaveBalance.
   */
  leaveLedger?: LeaveLedgerEntry[]
  /** Зафиксированные расчёты при увольнении (снимки + архив документов). */
  dismissalSettlements?: DismissalSettlement[]
  hrJournal?: HrJournalEntry[]
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

/** Период работы в конкретном месяце (только этот лист, не меняет карточку HR). */
export type MonthRowBounds = {
  /** С этого дня (включительно) до конца месяца — не работает. */
  inactiveFrom?: string
  /** До этого дня (включительно) — не работает; с следующего дня по графику. */
  inactiveUntil?: string
  /**
   * Снимок графика для этой строки (перевод / смена расписания с даты).
   * Нужен для нормы часов и ставки ₾/ч по правилам оклада, пока в карточке уже новый график.
   * Аддитивно.
   */
  schedule?: ScheduleType
  shiftHours?: number
  group2x2?: Group2x2
  shiftMode?: ShiftMode
  cycleStart?: string
}

/** Замена персонала на один день (факт табеля) */
export type DaySubstitution = {
  absentCode: DayCode
  substituteEmployeeId: string
  substituteCode: DayCode
  note?: string
}

/** Сверка табеля бригады за месяц («посчитано верно»). */
export type BrigadeTimesheetSignoff = {
  verified: true
  at: string
  by?: string
  byName?: string
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
  /** rowId|YYYY-MM-DD → сотрудник был бригадиром в этот день (для бригадирской премии). Добавлено аддитивно. */
  brigadierDays?: Record<string, true>
  /** rowId|YYYY-MM-DD → точное число отработанных часов за смену (ушёл раньше/задержался), заменяет норму кода. Добавлено аддитивно. */
  factHoursOverride?: Record<string, number>
  /**
   * Бригада → сверка табеля за месяц («месяц посчитан верно»).
   * Ставят мастера/кто ведёт свои бригады. Добавлено аддитивно.
   */
  brigadeSignoffs?: Record<string, BrigadeTimesheetSignoff>
  /** employeeId|YYYY-MM-DD → временный перевод в другую бригаду на один день */
  dayTransfers?: Record<string, import('./dayTransfer').DayTransfer>
  /** rowId → период работы только в этом месяце */
  rowBounds?: Record<string, MonthRowBounds>
  /**
   * Техническая очистка листа (ISO). Пока задано — не «лечим» пустой план из графиков;
   * при cloud-merge лист с более новым resetAt побеждает целиком.
   */
  resetAt?: string
}

export type AuditEntry = {
  id: string
  at: string
  action:
    | 'fact_change'
    | 'plan_change'
    | 'plan_save'
    | 'comment'
    | 'substitution'
    | 'employee_remove'
    | 'employee_upsert'
    | 'month_remove'
    | 'month_clear'
    | 'bulk'
    | 'candidate_remove'
    | 'candidate_hire'
    | 'month_close'
    | 'month_reopen'
    | 'advance_give'
    | 'advance_remove'
    | 'advance_document_save'
    | 'advance_document_post'
    | 'advance_document_void'
    | 'advance_accrual_save'
    | 'advance_accrual_post'
    | 'advance_accrual_void'
    | 'payout_document_save'
    | 'payout_document_post'
    | 'payout_document_void'
    | 'adjustment_add'
    | 'adjustment_remove'
    | 'payout_add'
    | 'payout_remove'
    | 'sick_confirm'
    | 'sick_unconfirm'
    | 'vacation_confirm'
    | 'vacation_unconfirm'
    | 'payroll_snapshot'
    | 'user_upsert'
    | 'user_remove'
    | 'role_views'
    | 'role_timesheet'
    | 'role_tasks'
    | 'master_coverage'
    | 'access_user_group'
    | 'night_shift'
    | 'timesheet_entry_post'
    | 'timesheet_entry_void'
    | 'meals_order'
    | 'meals_accept'
    | 'meals_unaccept'
    | 'attendance_punch'
    | 'counterparty_upsert'
    | 'counterparty_remove'
    | 'finished_product_upsert'
    | 'finished_product_remove'
    | 'brigade_rename'
    | 'directory_change'
    | 'meals_catalog'
    | 'meals_week'
    | 'meals_advance'
    | 'sales_order_plan'
    | 'sales_order_status'
    | 'task_create'
    | 'task_update'
    | 'task_move'
    | 'task_assign'
    | 'task_complete'
    | 'task_cancel'
    | 'task_comment'
    | 'task_attach_add'
    | 'task_attach_remove'
    | 'task_form_submit'
    | 'task_approve'
    | 'task_reject'
    | 'protocol_create'
    | 'protocol_update'
    | 'protocol_archive'
    | 'protocol_item_upsert'
    | 'protocol_item_status'
    | 'protocol_ack_send'
    | 'protocol_ack_confirm'
    | 'protocol_ack_admin_fix'
    | 'protocol_attach'
    | 'org_chart_node_upsert'
    | 'org_chart_reparent'
    | 'org_chart_node_archive'
    | 'org_chart_layout'
    | 'org_chart_node_created'
    | 'org_chart_node_updated'
    | 'org_chart_node_reparented'
    | 'org_chart_employee_assigned'
    | 'org_chart_employee_replaced'
    | 'org_chart_employee_unassigned'
    | 'org_chart_hr_link_changed'
    | 'org_chart_node_removed'
    | 'org_chart_subtree_removed'
    | 'org_chart_layout_changed'
    | 'org_chart_auto_layout_applied'
  month?: string
  /** Сотрудник, чья строка табеля затронута (не исполнитель). */
  employeeId?: string
  rowId?: string
  dateKey?: string
  /** Бригада строки (для области ACL / журнала). */
  brigade?: string
  detail: string
  oldValue?: string
  newValue?: string
  /** Кто выполнил действие (учётка). Аддитивно — старые записи без поля. */
  by?: string
  byName?: string
}

export type TrashEmployee = { employee: Employee; deletedAt: string }
export type TrashMonth = { sheet: MonthSheet; deletedAt: string }

/** Кто и когда закрыл (зафиксировал) месяц табеля */
export type MonthClosure = {
  at: string
  by?: string
  byName?: string
}

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
  /** Английское название бригады (ключ — русское имя). Аддитивно. */
  brigadeNamesEn?: Record<string, string>
  /** Бригадир (ключ — русское имя бригады, значение — id сотрудника) */
  brigadiers: Record<string, string>
  /**
   * Есть ли в бригаде роль бригадира (доплата + UI назначения).
   * Ключ — русское имя бригады. Нет ключа / true = да; false = нет (мастер, аппарат…).
   * Аддитивно — старые сторы без поля ведут себя как «есть бригадир».
   */
  brigadeHasBrigadier?: Record<string, boolean>
  /** Структурное подразделение бригады (ключ — русское имя бригады, значение — id подразделения). Добавлено аддитивно. */
  brigadeUnits?: Record<string, string>
  archivedMonths: string[]
  /** Закрытые (зафиксированные) месяцы табеля — план/факт только для чтения (YYYY-MM) */
  closedMonths?: string[]
  /** Метаданные закрытия месяца: кто и когда */
  monthClosures?: Record<string, MonthClosure>
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
  /** ОТК — лаборатория и сортировка качества */
  otc: OtcStore
  wastewater: WastewaterStore
  /** Полевой журнал главного инженера (заметки / задачи / замечания). */
  engineerLog: EngineerLogStore
  /** Канбан-задачи по отделам (YouGile-подобный модуль). Аддитивно. */
  tasks?: TasksStore
  warehouse: WarehouseStore
  workwear: WorkwearStore
  itOffice: ItOfficeStore
  procurement: ProcurementStore
  access: AccessStore
  /** Ночные смены по календарным дням (документ + журнал). Аддитивно. */
  nightShifts?: import('./nightShift/types').NightShiftStore
  /** Пакеты ввода табеля («Готово» → документ ВТ). Аддитивно. */
  timesheetEntries?: import('./timesheetEntries/types').TimesheetEntryStore
  /** Проходы терминала явки (пришёл/ушёл). Аддитивно. */
  attendance?: import('./attendance/types').AttendanceStore
  /** Заказы обедов (сотрудник / повар / принятие дня). Аддитивно. */
  meals?: import('./meals/types').MealsStore
  /** Протоколы совещаний и поручения. Аддитивно. */
  protocols?: import('./protocols/types').ProtocolsStore
  /** Организационная схема (дерево подчинения). Аддитивно. */
  orgChart?: import('./orgChart/types').OrgChartStore
  /** Финансовый отдел: авансы, премии/штрафы, выплаты, больничные, снимки расчёта. Добавлено аддитивно. */
  finance?: FinanceStore
  /** Outbox отложенных Auth/Storage side-effects (SQL-first). Аддитивно. */
  externalEffects?: import('./cloud/externalEffects/types').ExternalEffectsStore
  settings: {
    responsible: string
    site: string
    locale: Locale
    tourCompleted?: boolean
    lastBackupDate?: string
    signatures?: PrintSignatures
    /** Реквизиты работодателя для гос. шапки Грузии (01-15/ნ). */
    employer?: {
      orgRu?: string
      orgKa?: string
      idCode?: string
      unitRu?: string
      unitKa?: string
    }
    /**
     * Опции шапок бланков (Balance / печать): пресеты полей + доп. реквизиты.
     * Аддитивно; пусто = дефолты пресетов.
     */
    docHeader?: import('@/lib/print/docHeaderOptions').DocHeaderSettings
    ai?: AiSettings
    /** Полная бригадирская премия за месяц (₾), масштабируется по факт/план часам. По умолчанию 300. */
    brigadierBonus?: number
    /** % аванса по умолчанию от оклада (если у сотрудника rule=default). */
    defaultAdvancePercent?: number
    /** Коэффициенты начисления (ночь, простой, сверхурочные, нормы часов). */
    payrollAccrual?: PayrollAccrualRules
    /** Одноразовое обнуление складских остатков (миграция). */
    warehouseBalancesZeroedAt?: string
    /**
     * Админ объявил плановое обновление: баннер для всех до untilAt.
     * Аддитивно; после срока UI просто скрывает.
     */
    maintenanceWindow?: {
      announcedAt: string
      untilAt: string
      byName?: string
      message?: string
    }
  }
}

export const STORAGE_KEY = 'fibercell-tabel-v6'
export const TRASH_RETENTION_DAYS = 7
export const MAX_AUDIT_ENTRIES = 2000

export type ViewId =
  | 'month'
  | 'directories'
  /** @deprecated — открывает Справочники → Сотрудники */
  | 'employees'
  | 'hr'
  | 'hr_inspector'
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
  | 'otc'
  | 'mixer'
  | 'director'
  | 'journals'
  | 'engineer_log'
  | 'tasks'
  | 'it'
  | 'office'
  | 'meals'
  /** Протоколы совещаний и поручения */
  | 'protocols'
  /** Организационное древо сотрудников */
  | 'org_tree'
  | 'settings'
  /** Личный кабинет сотрудника (план / факт / оценка ЗП) */
  | 'my'
  /** Терминал явки (киоск: пришёл / ушёл) */
  | 'timeclock'

export function commentKey(rowId: string, dateKey: string): string {
  return `${rowId}|${dateKey}`
}

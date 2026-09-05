import type {
  EmploymentAgreementKind,
  HrAbsenceType,
  HrContractType,
  HrJournalKind,
  HrStatus,
  HrTrainingCategory,
} from './types'
import type { Locale } from '@/i18n/types'

export function hrStatusLabel(status: HrStatus, locale: Locale): string {
  const ru: Record<HrStatus, string> = {
    active: 'Работает',
    vacation: 'Отпуск',
    sick: 'Больничный',
    fired: 'Уволен',
  }
  const ka: Record<HrStatus, string> = {
    active: 'მუშაობს',
    vacation: 'შვებულება',
    sick: 'ავადმყოფობა',
    fired: 'გათავისუფლებული',
  }
  return locale === 'ka' ? ka[status] : ru[status]
}

export function hrAbsenceLabel(type: HrAbsenceType, locale: Locale): string {
  const ru: Record<HrAbsenceType, string> = {
    vacation: 'Отпуск',
    sick: 'Больничный',
    business_trip: 'Командировка',
    absence: 'Прогул',
  }
  const ka: Record<HrAbsenceType, string> = {
    vacation: 'შვებულება',
    sick: 'ავადმყოფობა',
    business_trip: 'მივლინება',
    absence: 'გაცდენა',
  }
  return locale === 'ka' ? ka[type] : ru[type]
}

export function hrJournalKindLabel(kind: HrJournalKind, locale: Locale): string {
  const ru: Record<HrJournalKind, string> = {
    sick: 'Больничный',
    vacation: 'Отпуск',
    business_trip: 'Командировка',
    absence: 'Отсутствие',
    truancy: 'Прогул',
    unpaid_leave: 'Отгул без содержания',
    idle: 'Простой',
    status: 'Статус',
    leave_opening: 'Отпускные: стартовый остаток',
    leave_adjustment: 'Отпускные: корректировка',
    leave_payout: 'Отпускные: компенсация',
    dismissal_settlement: 'Расчёт при увольнении',
    brigade_transfer: 'Перевод бригады',
    salary_change: 'Изменение ЗП',
    position_change: 'Смена должности',
    schedule_change: 'Смена графика',
    bank_account_change: 'Смена счёта',
    unit_change: 'Смена подразделения',
    name_change: 'Смена ФИО',
  }
  const ka: Record<HrJournalKind, string> = {
    sick: 'ავადმყოფობა',
    vacation: 'შვებულება',
    business_trip: 'მივლინება',
    absence: 'არაკვლოვება',
    truancy: 'გაცდენა',
    unpaid_leave: 'შვებულება ფულის გარეშე',
    idle: 'პროსტოი',
    status: 'სტატუსი',
    leave_opening: 'შვებულება: საწყისი ნაშთი',
    leave_adjustment: 'შვებულება: კორექტირება',
    leave_payout: 'შვებულება: კომპენსაცია',
    dismissal_settlement: 'გათავისუფლების გაანგარიშება',
    brigade_transfer: 'ბრიგადის გადაყვანა',
    salary_change: 'ხელფასის ცვლილება',
    position_change: 'თანამდებობის ცვლილება',
    schedule_change: 'გრაფიკის ცვლილება',
    bank_account_change: 'ანგარიშის ცვლილება',
    unit_change: 'ქვედანაყოფის ცვლილება',
    name_change: 'სახელის ცვლილება',
  }
  return locale === 'ka' ? ka[kind] : ru[kind]
}

export function employmentAgreementLabel(
  kind: EmploymentAgreementKind | undefined,
  locale: Locale,
): string {
  if (!kind) return locale === 'ka' ? '— არ არის მითითებული —' : '— not specified —'
  const ru: Record<EmploymentAgreementKind, string> = {
    permanent: 'Основной договор',
    fixed_term: 'Срочный договор',
  }
  const ka: Record<EmploymentAgreementKind, string> = {
    permanent: 'ძირითადი ხელშეკრულება',
    fixed_term: 'ვადიანი ხელშეკრულება',
  }
  return locale === 'ka' ? ka[kind] : ru[kind]
}

export function hrContractLabel(type: HrContractType, locale: Locale): string {
  const ru: Record<HrContractType, string> = {
    full_time: 'Полная занятость',
    part_time: 'Частичная',
    temporary: 'Временный',
    internship: 'Стажировка',
  }
  const ka: Record<HrContractType, string> = {
    full_time: 'სრული',
    part_time: 'ნაწილობრივი',
    temporary: 'დროებითი',
    internship: 'სტაჟირება',
  }
  return locale === 'ka' ? ka[type] : ru[type]
}

export function hrTrainingCategoryLabel(cat: HrTrainingCategory, locale: Locale): string {
  const ru: Record<HrTrainingCategory, string> = {
    instruction: 'Инструктаж',
    training: 'Обучение',
    certificate: 'Сертификат',
    admission: 'Допуск',
  }
  const ka: Record<HrTrainingCategory, string> = {
    instruction: 'ინსტრუქცია',
    training: 'ტრენინგი',
    certificate: 'სერტიფიკატი',
    admission: 'დაშვება',
  }
  return locale === 'ka' ? ka[cat] : ru[cat]
}

export const HR_DOC_TYPES = [
  'Паспорт',
  'Удостоверение личности',
  'ПМЖ',
  'Трудовое разрешение',
  'ВНЖ',
  'Приказ о приёме',
  'Приказ об увольнении',
  'Медосмотр',
  'Обучение',
  'Сертификат',
  'Допуск',
  'Заявление',
  'Отпускные / расчёт',
  'Прочее',
] as const

/**
 * Копии в архиве `hrDocuments` (не цепочка договоров).
 * Трудовой договор ведётся только в `hrContracts`.
 */
export const HR_ARCHIVE_LABOR_CONTRACT_TYPE = 'Трудовой договор'

/** Типы архивных копий, по которым смотрим сроки (не договоры). */
export const HR_MONITORED_DOC_TYPES = [
  'Паспорт',
  'Удостоверение личности',
  'ПМЖ',
  'Трудовое разрешение',
  'ВНЖ',
  'Медосмотр',
  'Сертификат',
  'Допуск',
] as const

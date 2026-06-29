import type {
  EmploymentAgreementKind,
  HrAbsenceType,
  HrContractType,
  HrStatus,
  HrTrainingCategory,
} from './types'

export function hrStatusLabel(status: HrStatus, locale: 'ru' | 'ka'): string {
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

export function hrAbsenceLabel(type: HrAbsenceType, locale: 'ru' | 'ka'): string {
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

export function employmentAgreementLabel(
  kind: EmploymentAgreementKind | undefined,
  locale: 'ru' | 'ka',
): string {
  if (!kind) return locale === 'ka' ? '— არ არის მითითებული —' : '— не указан —'
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

export function hrContractLabel(type: HrContractType, locale: 'ru' | 'ka'): string {
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

export function hrTrainingCategoryLabel(cat: HrTrainingCategory, locale: 'ru' | 'ka'): string {
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
  'Трудовой договор',
  'Приказ о приёме',
  'Медосмотр',
  'Обучение',
  'Сертификат',
  'Допуск',
  'Заявление',
  'Прочее',
] as const

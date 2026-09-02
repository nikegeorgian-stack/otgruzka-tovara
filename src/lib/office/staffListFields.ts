/** Поля списка сотрудников для офис-менеджера — белый список, без ЗП/банка/PIN. */

export const OFFICE_STAFF_FIELD_IDS = [
  'fullName',
  'nameKa',
  'tabNumber',
  'employeeNumber',
  'position',
  'unit',
  'brigade',
  'status',
  'phone',
  'email',
  'personalId',
  'address',
  'citizenship',
  'birthDate',
  'hireDate',
  'schedule',
  'gender',
] as const

export type OfficeStaffFieldId = (typeof OFFICE_STAFF_FIELD_IDS)[number]

export type OfficeStaffFieldGroup = 'main' | 'contacts' | 'extra'

export const OFFICE_STAFF_FIELD_META: Record<
  OfficeStaffFieldId,
  { group: OfficeStaffFieldGroup; labelKey: string; defaultOn: boolean }
> = {
  fullName: { group: 'main', labelKey: 'office.field.fullName', defaultOn: true },
  nameKa: { group: 'main', labelKey: 'office.field.nameKa', defaultOn: true },
  tabNumber: { group: 'main', labelKey: 'office.field.tabNumber', defaultOn: true },
  employeeNumber: { group: 'main', labelKey: 'office.field.employeeNumber', defaultOn: false },
  position: { group: 'main', labelKey: 'office.field.position', defaultOn: true },
  unit: { group: 'main', labelKey: 'office.field.unit', defaultOn: true },
  brigade: { group: 'main', labelKey: 'office.field.brigade', defaultOn: true },
  status: { group: 'main', labelKey: 'office.field.status', defaultOn: true },
  phone: { group: 'contacts', labelKey: 'office.field.phone', defaultOn: true },
  email: { group: 'contacts', labelKey: 'office.field.email', defaultOn: false },
  personalId: { group: 'extra', labelKey: 'office.field.personalId', defaultOn: false },
  address: { group: 'extra', labelKey: 'office.field.address', defaultOn: false },
  citizenship: { group: 'extra', labelKey: 'office.field.citizenship', defaultOn: false },
  birthDate: { group: 'extra', labelKey: 'office.field.birthDate', defaultOn: false },
  hireDate: { group: 'extra', labelKey: 'office.field.hireDate', defaultOn: false },
  schedule: { group: 'extra', labelKey: 'office.field.schedule', defaultOn: false },
  gender: { group: 'extra', labelKey: 'office.field.gender', defaultOn: false },
}

export const OFFICE_STAFF_GROUPS: { id: OfficeStaffFieldGroup; labelKey: string }[] = [
  { id: 'main', labelKey: 'office.group.main' },
  { id: 'contacts', labelKey: 'office.group.contacts' },
  { id: 'extra', labelKey: 'office.group.extra' },
]

export const DEFAULT_OFFICE_STAFF_FIELDS: OfficeStaffFieldId[] = OFFICE_STAFF_FIELD_IDS.filter(
  (id) => OFFICE_STAFF_FIELD_META[id].defaultOn,
)

/** Поля карточки, которые офис-менеджер не должен видеть в таблице/выгрузке. */
export const OFFICE_FORBIDDEN_EMPLOYEE_KEYS = [
  'hourlyRate',
  'monthlySalary',
  'monthlyBonus',
  'staffRate',
  'individualSalary',
  'individualBonus',
  'bonusPercentFromSalary',
  'monthPremiums',
  'advanceRule',
  'advancePercent',
  'advanceFixedAmount',
  'bankAccounts',
  'pensionScheme',
  'mealAllowanceGel',
  'attendancePinHash',
  'attendancePinSalt',
  'attendanceFaceDescriptor',
  'attendanceFaceDataUrl',
] as const

const ALLOWED = new Set<string>(OFFICE_STAFF_FIELD_IDS)

export function isOfficeStaffFieldId(id: string): id is OfficeStaffFieldId {
  return ALLOWED.has(id)
}

export function normalizeOfficeStaffFields(ids: readonly string[] | undefined): OfficeStaffFieldId[] {
  const out: OfficeStaffFieldId[] = []
  const seen = new Set<OfficeStaffFieldId>()
  for (const raw of ids ?? []) {
    if (!isOfficeStaffFieldId(raw) || seen.has(raw)) continue
    seen.add(raw)
    out.push(raw)
  }
  return out.length ? out : [...DEFAULT_OFFICE_STAFF_FIELDS]
}

export function fieldsForGroup(group: OfficeStaffFieldGroup): OfficeStaffFieldId[] {
  return OFFICE_STAFF_FIELD_IDS.filter((id) => OFFICE_STAFF_FIELD_META[id].group === group)
}

import type { UserViewDefaults } from '@/lib/viewDefaults/types'
import type { ViewId } from '@/lib/types'

/** Роль / должность в системе */
export type AccessRoleId =
  | 'sysadmin'
  | 'warehouse_keeper'
  | 'hr'
  | 'hr_inspector'
  | 'operations_director'
  | 'workshop_master'
  | 'procurement_manager'
  | 'chief_engineer'
  | 'technologist'
  | 'mixer'
  | 'finance'

export type AppUser = {
  id: string
  /** Логин для входа */
  login: string
  displayName: string
  roleId: AccessRoleId
  passwordHash: string
  passwordSalt: string
  active: boolean
  /** Привязка к карточке сотрудника в HR */
  employeeId?: string
  /** Бригады по умолчанию в табеле / перекличке (фильтр при открытии) */
  defaultBrigades?: string[]
  /** Настройки отображения по разделам (личные) */
  viewDefaults?: UserViewDefaults
  /** Облачная учётка (Firebase Auth) — пароль не хранится локально */
  webAccount?: boolean
  /** Индивидуальные разделы (если заданы — вместо roleViews для роли) */
  webViews?: import('@/lib/types').ViewId[]
  createdAt: string
  updatedAt: string
}

export type AccessStore = {
  users: AppUser[]
  /** Какие разделы (интерфейсы) доступны каждой роли */
  roleViews: Record<AccessRoleId, ViewId[]>
  /** Разрешить уходить в минус по остатку (замес / расход) */
  roleAllowNegativeStock?: Partial<Record<AccessRoleId, boolean>>
  /** Разрешить сторнирование складских документов */
  roleAllowDocumentCancel?: Partial<Record<AccessRoleId, boolean>>
}

/** Роли, для которых администратор может включить сторно документов */
export const DOCUMENT_CANCEL_ROLES: AccessRoleId[] = ['warehouse_keeper']

/** Отрицательный остаток отключён глобально. */
export const NEGATIVE_STOCK_ROLES: AccessRoleId[] = []

/** Разделы приложения, которыми управляет администратор */
export const MANAGED_VIEWS: ViewId[] = [
  'month',
  'summary',
  'production',
  'planner',
  'warehouse',
  'procurement',
  'hr',
  'hr_inspector',
  'finance',
  'directories',
  'technologist',
  'mixer',
  'director',
  'journals',
  'it',
  'settings',
]

export const SESSION_STORAGE_KEY = 'fibercell-auth-session'

export const SYSTEM_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001'

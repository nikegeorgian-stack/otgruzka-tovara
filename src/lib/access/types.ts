import type { UserViewDefaults } from '@/lib/viewDefaults/types'
import type { ViewId } from '@/lib/types'
import type { TaskAccessLevel } from '@/lib/tasks/types'

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
  /** ОТК / отдел качества */
  | 'otc'
  | 'mixer'
  | 'finance'
  /** Только личный кабинет (привязка к карточке сотрудника) */
  | 'employee'
  /** IT-офис без полного sysadmin */
  | 'it_specialist'
  /** Заказы клиента и погрузка без полного директора */
  | 'sales_dispatcher'
  /** Списки сотрудников: фильтр, печать, Excel — без ЗП и полного HR */
  | 'office_manager'
  /** Терминал явки на стене / телефоне — только киоск */
  | 'timeclock'
  /** Кухня: заказы обедов, принятие дня, отчёты — без HR/цен */
  | 'cook'
  /** Секретарь: протоколы совещаний, поручения, ознакомление — без финансов/склада */
  | 'secretary'

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
  /**
   * Индивидуальные вкладки справочников (если заданы — вместо матрицы роли).
   * Пустой / не задан при сохранении = наследовать с должности.
   */
  directorySections?: import('@/lib/directories/types').DirectorySection[]
  /** Индивидуальный уровень доступа к разделу «Задачи». */
  taskAccessLevel?: TaskAccessLevel
  /** Индивидуальный список досок задач (сужение). */
  taskBoards?: string[]
  /**
   * Индивидуальный уровень табеля (приоритет над roleTimesheetAccess).
   * `none` | `view` | `edit`. Не задан — берётся с должности.
   */
  timesheetLevel?: 'none' | 'view' | 'edit'
  /**
   * Бригады, которые видит в табеле.
   * Задан массив (в т.ч. пустой) — жёсткий список; не задан — политика роли / весь завод.
   */
  timesheetViewBrigades?: string[]
  /**
   * Бригады, которые может править (только при timesheetLevel/роли = edit).
   * Не задан при edit — как view или весь завод / scoped-роль.
   */
  timesheetEditBrigades?: string[]
  /** После сброса пароля админом — пользователь задаёт свой при входе */
  mustChangePassword?: boolean
  createdAt: string
  updatedAt: string
}

/** Временная подмена мастера цеха — документ с периодом действия. */
export type WorkshopMasterCoverageStatus = 'draft' | 'posted' | 'ended'

export type WorkshopMasterCoverage = {
  id: string
  /** Номер документа, напр. ПМ-2026-001 */
  number: string
  /** draft — черновик (ACL нет); posted — действует в периоде; ended — снята */
  status: WorkshopMasterCoverageStatus
  /** Кто подменяет */
  coverUserId: string
  /** Кого замещают */
  absentUserId: string
  /** Снимок бригад на момент выдачи */
  brigades: string[]
  /** YYYY-MM-DD включительно */
  fromDate: string
  toDate: string
  note?: string
  createdBy?: string
  createdByName?: string
  createdAt: string
  postedAt?: string
  postedBy?: string
  postedByName?: string
  /** Досрочное снятие (ISO) */
  endedAt?: string
}

/** Произвольная группа учёток (админ-панель). */
export type AccessUserGroup = {
  id: string
  name: string
  /** Краткая пометка для админа */
  note?: string
  /** id учёток (AppUser.id) */
  userIds: string[]
  createdAt: string
  updatedAt: string
}

export type AccessStore = {
  users: AppUser[]
  /** Какие разделы (интерфейсы) доступны каждой роли */
  roleViews: Record<AccessRoleId, ViewId[]>
  /**
   * Вкладки справочников по роли (если заданы — вместо DEFAULT_ROLE_DIRECTORY_SECTIONS).
   * Не задано для роли — дефолт из `lib/directories/access`.
   */
  roleDirectorySections?: Partial<
    Record<AccessRoleId, import('@/lib/directories/types').DirectorySection[]>
  >
  /**
   * Право на табель по роли: none | view | edit.
   * edit у workshop_master — только бригады учётки; у остальных edit — весь завод.
   */
  roleTimesheetAccess?: Partial<Record<AccessRoleId, 'none' | 'view' | 'edit'>>
  /** Разрешить уходить в минус по остатку (замес / расход) */
  roleAllowNegativeStock?: Partial<Record<AccessRoleId, boolean>>
  /** Разрешить сторнирование складских документов */
  roleAllowDocumentCancel?: Partial<Record<AccessRoleId, boolean>>
  /** Подмены мастеров цеха (админ / HR). */
  workshopMasterCoverages?: WorkshopMasterCoverage[]
  /** Пользовательские группы учёток (фильтр / пакетные права в админке). */
  userGroups?: AccessUserGroup[]
  /** Доступ к разделу «Задачи» по роли. */
  roleTaskAccess?: Partial<Record<AccessRoleId, TaskAccessLevel>>
  /** Доски задач по роли (board id). */
  roleTaskBoards?: Partial<Record<AccessRoleId, string[]>>
}

/** Роли, для которых администратор может включить сторно документов */
export const DOCUMENT_CANCEL_ROLES: AccessRoleId[] = ['warehouse_keeper']

/** Отрицательный остаток отключён глобально. */
export const NEGATIVE_STOCK_ROLES: AccessRoleId[] = []

/** Разделы приложения, которыми управляет администратор */
export const MANAGED_VIEWS: ViewId[] = [
  'my',
  'timeclock',
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
  'otc',
  'mixer',
  'director',
  'journals',
  'engineer_log',
  'tasks',
  'it',
  'office',
  'meals',
  'protocols',
  'org_tree',
  'settings',
]

export const SESSION_STORAGE_KEY = 'fibercell-auth-session'

export const SYSTEM_ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001'

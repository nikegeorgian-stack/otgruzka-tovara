import type { ViewId } from '@/lib/types'
import type { AccessRoleId } from './types'

export type RoleDefinition = {
  id: AccessRoleId
  labelRu: string
  labelKa: string
  descriptionRu: string
  descriptionKa: string
}

export const ACCESS_ROLES: RoleDefinition[] = [
  {
    id: 'sysadmin',
    labelRu: 'Системный администратор',
    labelKa: 'სისტემური ადმინისტრატორი',
    descriptionRu: 'Полный доступ, учётные записи и настройка интерфейсов',
    descriptionKa: 'სრული წვდომა, ანგარიშები და ინტერფეისები',
  },
  {
    id: 'warehouse_keeper',
    labelRu: 'Кладовщик',
    labelKa: 'მეურნე',
    descriptionRu: 'Склад, приёмка и отгрузка, номенклатура',
    descriptionKa: 'საწყობი და ნომენკლატურა',
  },
  {
    id: 'hr',
    labelRu: 'HR',
    labelKa: 'HR',
    descriptionRu: 'Персонал, табель, оплата, справочники кадров',
    descriptionKa: 'პერსონალი და ცხრილი',
  },
  {
    id: 'hr_inspector',
    labelRu: 'Инспектор по кадрам',
    labelKa: 'კადრების ინსპექტორი',
    descriptionRu: 'Контроль документов, иностранного персонала, отпусков и посещаемости',
    descriptionKa: 'დოკუმენტები, უცხოური პერსონალი, შვებულება',
  },
  {
    id: 'operations_director',
    labelRu: 'Генеральный директор',
    labelKa: 'გენერალური დირექტორი',
    descriptionRu: 'Сводка завода, план, заказы и риски — без администрирования',
    descriptionKa: 'ქარხნის შეჯამება, გეგმა, შეკვეთები და რისკები',
  },
  {
    id: 'technologist',
    labelRu: 'Технолог',
    labelKa: 'ტექნოლოგი',
    descriptionRu: 'Рецептуры пропитки, замес партий, этикетки на куб',
    descriptionKa: 'რეცეპტურა და ნაზავი',
  },
  {
    id: 'otc',
    labelRu: 'ОТК',
    labelKa: 'ხარისხის კონტროლი',
    descriptionRu: 'Лабораторные испытания, сортировка качества, дефекты',
    descriptionKa: 'ლაბორატორია, სორტირება, დეფექტები',
  },
  {
    id: 'mixer',
    labelRu: 'Миксер',
    labelKa: 'მიქსერი',
    descriptionRu: 'Получает задания технолога, замешивает пропиточный состав',
    descriptionKa: 'იღებს ტექნოლოგის დავალებებს და ამზადებს ნაზავს',
  },
  {
    id: 'chief_engineer',
    labelRu: 'Главный инженер',
    labelKa: 'მთავარი ინჟინერი',
    descriptionRu: 'Производство, план, рецептуры и технические справочники',
    descriptionKa: 'წარმოება, გეგმა, რეცეპტურები',
  },
  {
    id: 'workshop_master',
    labelRu: 'Мастер цеха',
    labelKa: 'ქვედანაყოფის უფროსი',
    descriptionRu: 'Табель производства, выходы, расстановка по позициям, заявки смены',
    descriptionKa: 'ცხრილი, გამოსვლები, პოზიციები, წარმოება',
  },
  {
    id: 'procurement_manager',
    labelRu: 'Менеджер по закупкам',
    labelKa: 'შესყიდვების მენეჯერი',
    descriptionRu: 'Закупки, поставщики, остатки на складе',
    descriptionKa: 'შესყიდვები და მომწოდებლები',
  },
  {
    id: 'finance',
    labelRu: 'Финансовый отдел',
    labelKa: 'ფინანსური განყოფილება',
    descriptionRu: 'Зарплата, ставки, сводка по табелю',
    descriptionKa: 'ხელფასი, განაკვეთები, ცხრილი',
  },
  {
    id: 'employee',
    labelRu: 'Сотрудник',
    labelKa: 'თანამშრომელი',
    descriptionRu: 'Личный кабинет и заказ обеда себе',
    descriptionKa: 'პირადი კაბინეტი და საკუთარი სადილის შეკვეთა',
  },
  {
    id: 'it_specialist',
    labelRu: 'IT-специалист',
    labelKa: 'IT-სპეციალისტი',
    descriptionRu: 'IT-офис и журналы без полного администрирования',
    descriptionKa: 'IT-ოფისი და ჟურნალები სრული ადმინის გარეშე',
  },
  {
    id: 'sales_dispatcher',
    labelRu: 'Диспетчер продаж / отгрузки',
    labelKa: 'გაყიდვების / ჩატვირთვის დისპეტჩერი',
    descriptionRu: 'Заказы клиентов, склад погрузки и сводка — без HR и закупок',
    descriptionKa: 'კლიენტის შეკვეთები, ჩატვირთვა და შეჯამება — HR და შესყიდვების გარეშე',
  },
  {
    id: 'office_manager',
    labelRu: 'Офис-менеджер',
    labelKa: 'ოფის-მენეჯერი',
    descriptionRu: 'Списки сотрудников: фильтр, печать и Excel — без зарплаты и полного HR',
    descriptionKa: 'თანამშრომლების სიები: ფილტრი, ბეჭდვა და Excel — ხელფასისა და სრული HR-ის გარეშე',
  },
  {
    id: 'timeclock',
    labelRu: 'Терминал явки',
    labelKa: 'დასწრების ტერმინალი',
    descriptionRu: 'Только киоск: фиксация прихода и ухода сотрудников',
    descriptionKa: 'მხოლოდ კიოსკი: მოსვლისა და წასვლის ფიქსაცია',
  },
  {
    id: 'cook',
    labelRu: 'Повар',
    labelKa: 'მზარეული',
    descriptionRu: 'Обеды: заказы на день, принятие и отчёты — без зарплаты и кадров',
    descriptionKa: 'სადილები: დღის შეკვეთები და მიღება — ხელფასისა და კადრების გარეშე',
  },
  {
    id: 'secretary',
    labelRu: 'Секретарь',
    labelKa: 'მდივანი',
    descriptionRu: 'Протоколы совещаний, поручения, ознакомление и бланки — без финансов и склада',
    descriptionKa: 'სხდომის ოქმები, დავალებები და გაცნობა — ფინანსებისა და საწყობის გარეშე',
  },
]

export const DEFAULT_ROLE_VIEWS: Record<AccessRoleId, ViewId[]> = {
  sysadmin: [
    'month',
    'summary',
    'production',
    'planner',
    'warehouse',
    'procurement',
    'hr',
    'finance',
    'hr_inspector',
    'directories',
    'engineer_log',
    'tasks',
    'journals',
    'mixer',
    'director',
    'technologist',
    'otc',
    'it',
    'office',
    'meals',
    'protocols',
    'org_tree',
    'settings',
    'my',
    'timeclock',
  ],
  warehouse_keeper: ['warehouse', 'procurement', 'directories', 'journals', 'meals', 'tasks'],
  hr: ['hr', 'directories', 'month', 'summary', 'journals', 'meals', 'tasks', 'org_tree'],
  hr_inspector: ['hr_inspector', 'summary', 'journals', 'meals', 'tasks'],
  operations_director: [
    'director',
    'summary',
    'month',
    'production',
    'planner',
    'procurement',
    'warehouse',
    'technologist',
    'otc',
    'hr',
    'directories',
    'journals',
    'meals',
    'tasks',
    'protocols',
    'org_tree',
  ],
  workshop_master: ['month', 'production', 'hr', 'directories', 'otc', 'journals', 'meals', 'tasks'],
  procurement_manager: ['procurement', 'warehouse', 'directories', 'journals', 'meals', 'tasks'],
  chief_engineer: [
    'engineer_log',
    'production',
    'planner',
    'directories',
    'warehouse',
    'summary',
    'technologist',
    'otc',
    'mixer',
    'journals',
    'meals',
    'tasks',
  ],
  technologist: [
    'technologist',
    'otc',
    'mixer',
    'warehouse',
    'directories',
    'journals',
    'meals',
    'tasks',
  ],
  otc: ['otc', 'directories', 'journals', 'meals', 'tasks'],
  mixer: ['mixer', 'journals', 'meals', 'tasks'],
  finance: ['finance', 'month', 'summary', 'directories', 'journals', 'meals', 'tasks'],
  employee: ['my', 'meals', 'tasks', 'protocols'],
  timeclock: ['timeclock'],
  it_specialist: ['it', 'journals', 'meals', 'tasks'],
  sales_dispatcher: ['director', 'warehouse', 'summary', 'directories', 'journals', 'meals', 'tasks'],
  office_manager: ['office', 'my', 'meals', 'tasks', 'protocols'],
  cook: ['meals', 'my', 'tasks'],
  secretary: ['protocols', 'org_tree', 'my', 'journals', 'directories', 'tasks'],
}

import { labelRuKa } from '@/i18n/localeFormat'
import type { Locale } from '@/i18n/types'

export function roleLabel(roleId: AccessRoleId, locale: Locale): string {
  const row = ACCESS_ROLES.find((r) => r.id === roleId)
  if (!row) return roleId
  return labelRuKa(locale, row.labelRu, row.labelKa)
}

export function roleDescription(roleId: AccessRoleId, locale: Locale): string {
  const row = ACCESS_ROLES.find((r) => r.id === roleId)
  if (!row) return ''
  if (locale === 'ka') return row.descriptionKa
  return row.descriptionRu
}

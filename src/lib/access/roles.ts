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
    id: 'operations_director',
    labelRu: 'Операционный директор',
    labelKa: 'ოპერაციული დირექტორი',
    descriptionRu: 'Сводка, производство, план, закупки — без администрирования',
    descriptionKa: 'შეჯამება, წარმოება, გეგმა, შესყიდვები',
  },
  {
    id: 'technologist',
    labelRu: 'Технолог',
    labelKa: 'ტექნოლოგი',
    descriptionRu: 'Рецептуры пропитки, замес партий, этикетки на куб',
    descriptionKa: 'რეცეპტურა და ნაზავი',
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
    'directories',
    'journals',
    'settings',
  ],
  warehouse_keeper: ['warehouse', 'procurement', 'directories', 'journals'],
  hr: ['hr', 'directories', 'month', 'summary', 'journals'],
  operations_director: [
    'director',
    'summary',
    'month',
    'production',
    'planner',
    'procurement',
    'warehouse',
    'hr',
    'journals',
  ],
  workshop_master: ['month', 'production', 'hr', 'journals'],
  procurement_manager: ['procurement', 'warehouse', 'directories', 'journals'],
  chief_engineer: [
    'production',
    'planner',
    'directories',
    'warehouse',
    'summary',
    'technologist',
    'mixer',
    'journals',
  ],
  technologist: ['technologist', 'mixer', 'journals'],
  mixer: ['mixer', 'journals'],
  finance: ['finance', 'month', 'summary', 'journals'],
}

export function roleLabel(roleId: AccessRoleId, locale: 'ru' | 'ka'): string {
  const row = ACCESS_ROLES.find((r) => r.id === roleId)
  if (!row) return roleId
  return locale === 'ka' ? row.labelKa : row.labelRu
}

export function roleDescription(roleId: AccessRoleId, locale: 'ru' | 'ka'): string {
  const row = ACCESS_ROLES.find((r) => r.id === roleId)
  if (!row) return ''
  return locale === 'ka' ? row.descriptionKa : row.descriptionRu
}

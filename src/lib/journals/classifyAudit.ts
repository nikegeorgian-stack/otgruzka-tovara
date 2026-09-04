import type { AuditEntry } from '@/lib/types'
import type { JournalCategory } from './types'

const FINANCE: ReadonlySet<AuditEntry['action']> = new Set([
  'advance_give',
  'advance_remove',
  'advance_document_save',
  'advance_document_post',
  'advance_document_void',
  'payout_document_save',
  'payout_document_post',
  'payout_document_void',
  'adjustment_add',
  'adjustment_remove',
  'payout_add',
  'payout_remove',
  'sick_confirm',
  'sick_unconfirm',
  'vacation_confirm',
  'vacation_unconfirm',
  'payroll_snapshot',
])

const HR: ReadonlySet<AuditEntry['action']> = new Set([
  'employee_remove',
  'employee_upsert',
  'candidate_remove',
  'candidate_hire',
])

const ACCESS: ReadonlySet<AuditEntry['action']> = new Set([
  'user_upsert',
  'user_remove',
  'role_views',
  'role_timesheet',
  'role_tasks',
])

const DIRECTORIES: ReadonlySet<AuditEntry['action']> = new Set([
  'counterparty_upsert',
  'counterparty_remove',
  'finished_product_upsert',
  'finished_product_remove',
  'brigade_rename',
  'directory_change',
  'sales_order_plan',
  'sales_order_status',
  // PHASE G5 / G5.1 — critical-store domain audits (sales / MRP / procurement / masterdata)
  'sales_order_confirm',
  'sales_order_change',
  'sales_order_cancel',
  'sales_shipment_post',
  'sales_shipment_cancel',
  'planning_mrp_run',
  'planning_shortage_acknowledge',
  'planning_shortage_resolve',
  'procurement_order_submitted',
  'procurement_order_approved',
  'procurement_order_ordered',
  'procurement_order_cancelled',
  'procurement_receipt_applied',
  'procurement_payment_record',
  'masterdata_domain_activate',
  'sales_domain_activate',
  'procurement_domain_activate',
])

/** Категория журнала для записи глобального auditLog */
export function classifyAuditEntry(entry: AuditEntry): JournalCategory {
  if (FINANCE.has(entry.action)) return 'finance'
  if (HR.has(entry.action)) return 'hr'
  if (ACCESS.has(entry.action)) return 'access'
  if (DIRECTORIES.has(entry.action)) return 'directories'
  if (entry.action === 'master_coverage') return 'timesheet'
  if (entry.action === 'night_shift') return 'timesheet'
  if (entry.action === 'timesheet_entry_post' || entry.action === 'timesheet_entry_void') {
    return 'timesheet'
  }
  if (
    entry.action === 'meals_order' ||
    entry.action === 'meals_accept' ||
    entry.action === 'meals_unaccept' ||
    entry.action === 'meals_catalog' ||
    entry.action === 'meals_week' ||
    entry.action === 'meals_advance'
  ) {
    return 'finance'
  }
  if (
    entry.action === 'task_create' ||
    entry.action === 'task_update' ||
    entry.action === 'task_move' ||
    entry.action === 'task_assign' ||
    entry.action === 'task_complete' ||
    entry.action === 'task_cancel' ||
    entry.action === 'task_comment' ||
    entry.action === 'task_attach_add' ||
    entry.action === 'task_attach_remove' ||
    entry.action === 'task_form_submit' ||
    entry.action === 'task_approve' ||
    entry.action === 'task_reject'
  ) {
    return 'directories'
  }
  if (
    entry.action === 'protocol_create' ||
    entry.action === 'protocol_update' ||
    entry.action === 'protocol_archive' ||
    entry.action === 'protocol_item_upsert' ||
    entry.action === 'protocol_item_status' ||
    entry.action === 'protocol_ack_send' ||
    entry.action === 'protocol_ack_confirm' ||
    entry.action === 'protocol_ack_admin_fix' ||
    entry.action === 'protocol_attach' ||
    entry.action === 'org_chart_node_upsert' ||
    entry.action === 'org_chart_reparent' ||
    entry.action === 'org_chart_node_archive' ||
    entry.action === 'org_chart_layout' ||
    entry.action === 'org_chart_node_created' ||
    entry.action === 'org_chart_node_updated' ||
    entry.action === 'org_chart_node_reparented' ||
    entry.action === 'org_chart_employee_assigned' ||
    entry.action === 'org_chart_employee_replaced' ||
    entry.action === 'org_chart_employee_unassigned' ||
    entry.action === 'org_chart_hr_link_changed' ||
    entry.action === 'org_chart_node_removed' ||
    entry.action === 'org_chart_subtree_removed' ||
    entry.action === 'org_chart_layout_changed' ||
    entry.action === 'org_chart_auto_layout_applied'
  ) {
    return 'hr'
  }
  if (entry.action === 'bulk') {
    const d = entry.detail.toLowerCase()
    if (
      d.includes('org structure') ||
      d.includes('registry import') ||
      d.includes('clear personnel') ||
      d.includes('candidate')
    ) {
      return 'hr'
    }
  }
  return 'timesheet'
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  fact_change: 'Изменение факта',
  plan_change: 'Изменение плана',
  plan_save: 'Сохранение плана',
  comment: 'Комментарий',
  substitution: 'Подмена',
  employee_remove: 'Удаление сотрудника',
  employee_upsert: 'Изменение сотрудника',
  month_remove: 'Удаление месяца',
  month_clear: 'Очистка месяца',
  month_close: 'Закрытие месяца',
  month_reopen: 'Переоткрытие месяца',
  advance_give: 'Выдача аванса',
  advance_remove: 'Удаление аванса',
  advance_document_save: 'Черновик аванса',
  advance_document_post: 'Ведомость авансов',
  advance_document_void: 'Аннулирование аванса',
  payout_document_save: 'Черновик выплаты ЗП',
  payout_document_post: 'Ведомость выплат ЗП',
  payout_document_void: 'Аннулирование выплаты ЗП',
  adjustment_add: 'Премия / штраф',
  adjustment_remove: 'Отмена премии / штрафа',
  payout_add: 'Выплата ЗП',
  payout_remove: 'Отмена выплаты',
  sick_confirm: 'Больничный подтверждён',
  sick_unconfirm: 'Больничный снят',
  vacation_confirm: 'Отпуск подтверждён',
  vacation_unconfirm: 'Отпуск снят с подтверждения',
  payroll_snapshot: 'Фиксация расчёта ЗП',
  bulk: 'Массовая операция',
  candidate_remove: 'Удаление кандидата',
  candidate_hire: 'Приём кандидата',
  user_upsert: 'Изменение пользователя',
  user_remove: 'Удаление пользователя',
  role_views: 'Права роли',
  role_timesheet: 'Доступ к табелю',
  role_tasks: 'Доступ к задачам',
  master_coverage: 'Подмена мастера цеха',
  night_shift: 'Ночная смена',
  timesheet_entry_post: 'Ввод табеля (проведён)',
  timesheet_entry_void: 'Ввод табеля (аннулирован)',
  meals_order: 'Заказ обеда',
  meals_accept: 'Принятие обедов за день',
  meals_unaccept: 'Снятие принятия обедов',
  counterparty_upsert: 'Контрагент',
  counterparty_remove: 'Удаление контрагента',
  finished_product_upsert: 'Готовая продукция',
  finished_product_remove: 'Удаление ГП',
  brigade_rename: 'Переименование бригады',
  directory_change: 'Справочник',
  meals_catalog: 'Каталог обедов',
  meals_week: 'Недельное меню',
  meals_advance: 'Аванс кухни',
  sales_order_plan: 'Планирование заказа клиента',
  sales_order_status: 'Статус заказа клиента',
  sales_order_confirm: 'Подтверждение заказа клиента (G5)',
  sales_order_change: 'Изменение заказа клиента (G5)',
  sales_order_cancel: 'Отмена заказа клиента (G5)',
  sales_shipment_post: 'Отгрузка по заказу клиента (G5)',
  sales_shipment_cancel: 'Сторно отгрузки (G5)',
  planning_mrp_run: 'Расчёт MRP',
  planning_shortage_acknowledge: 'Подтверждение дефицита',
  planning_shortage_resolve: 'Закрытие дефицита',
  procurement_order_submitted: 'ЗЗ отправлен',
  procurement_order_approved: 'ЗЗ утверждён',
  procurement_order_ordered: 'ЗЗ заказан',
  procurement_order_cancelled: 'ЗЗ отменён',
  procurement_receipt_applied: 'Приход по ЗЗ',
  procurement_payment_record: 'Оплата по ЗЗ',
  masterdata_domain_activate: 'Активация master data (G5)',
  sales_domain_activate: 'Активация sales/planning (G5)',
  procurement_domain_activate: 'Активация закупок (G5)',
  task_create: 'Создание задачи',
  task_update: 'Изменение задачи',
  task_move: 'Перенос задачи',
  task_assign: 'Назначение задачи',
  task_complete: 'Задача выполнена',
  task_cancel: 'Задача отменена',
  task_comment: 'Комментарий к задаче',
  task_attach_add: 'Вложение к задаче',
  task_attach_remove: 'Удаление вложения',
  task_form_submit: 'Форма по задаче',
  task_approve: 'Согласование задачи',
  task_reject: 'Отклонение задачи',
  protocol_create: 'Создание протокола',
  protocol_update: 'Изменение протокола',
  protocol_archive: 'Архив протокола',
  protocol_item_upsert: 'Пункт протокола',
  protocol_item_status: 'Статус поручения',
  protocol_ack_send: 'Передача на ознакомление',
  protocol_ack_confirm: 'Ознакомление подтверждено',
  protocol_ack_admin_fix: 'Исправление ознакомления',
  protocol_attach: 'Вложение к протоколу',
  org_chart_node_upsert: 'Оргсхема: узел',
  org_chart_reparent: 'Оргсхема: подчинение',
  org_chart_node_archive: 'Оргсхема: архив узла',
  org_chart_layout: 'Оргсхема: раскладка',
  org_chart_node_created: 'Оргсхема: создание ячейки',
  org_chart_node_updated: 'Оргсхема: изменение ячейки',
  org_chart_node_reparented: 'Оргсхема: смена руководителя',
  org_chart_employee_assigned: 'Оргсхема: назначение сотрудника',
  org_chart_employee_replaced: 'Оргсхема: замена сотрудника',
  org_chart_employee_unassigned: 'Оргсхема: освобождение должности',
  org_chart_hr_link_changed: 'Оргсхема: связь с HR',
  org_chart_node_removed: 'Оргсхема: удаление ячейки',
  org_chart_subtree_removed: 'Оргсхема: удаление ветки',
  org_chart_layout_changed: 'Оргсхема: сдвиг ячейки',
  org_chart_auto_layout_applied: 'Оргсхема: авто-раскладка',
}

export const AUDIT_DOC_TYPE_KEY: Partial<Record<JournalCategory, string>> = {
  timesheet: 'nav.month',
  finance: 'nav.finance',
  hr: 'nav.hr',
  access: 'nav.settings',
  directories: 'nav.directories',
}

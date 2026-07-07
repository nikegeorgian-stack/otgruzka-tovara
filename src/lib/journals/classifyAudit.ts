import type { AuditEntry } from '@/lib/types'
import type { JournalCategory } from './types'

const FINANCE: ReadonlySet<AuditEntry['action']> = new Set([
  'advance_give',
  'advance_remove',
  'adjustment_add',
  'adjustment_remove',
  'payout_add',
  'payout_remove',
  'sick_confirm',
  'sick_unconfirm',
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
])

const DIRECTORIES: ReadonlySet<AuditEntry['action']> = new Set([
  'counterparty_upsert',
  'counterparty_remove',
  'finished_product_upsert',
  'finished_product_remove',
])

/** Категория журнала для записи глобального auditLog */
export function classifyAuditEntry(entry: AuditEntry): JournalCategory {
  if (FINANCE.has(entry.action)) return 'finance'
  if (HR.has(entry.action)) return 'hr'
  if (ACCESS.has(entry.action)) return 'access'
  if (DIRECTORIES.has(entry.action)) return 'directories'
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
  comment: 'Комментарий',
  substitution: 'Подмена',
  employee_remove: 'Удаление сотрудника',
  employee_upsert: 'Изменение сотрудника',
  month_remove: 'Удаление месяца',
  month_close: 'Закрытие месяца',
  month_reopen: 'Переоткрытие месяца',
  advance_give: 'Выдача аванса',
  advance_remove: 'Удаление аванса',
  adjustment_add: 'Премия / штраф',
  adjustment_remove: 'Отмена премии / штрафа',
  payout_add: 'Выплата ЗП',
  payout_remove: 'Отмена выплаты',
  sick_confirm: 'Больничный подтверждён',
  sick_unconfirm: 'Больничный снят',
  payroll_snapshot: 'Фиксация расчёта ЗП',
  bulk: 'Массовая операция',
  candidate_remove: 'Удаление кандидата',
  candidate_hire: 'Приём кандидата',
  user_upsert: 'Изменение пользователя',
  user_remove: 'Удаление пользователя',
  role_views: 'Права роли',
  counterparty_upsert: 'Контрагент',
  counterparty_remove: 'Удаление контрагента',
  finished_product_upsert: 'Готовая продукция',
  finished_product_remove: 'Удаление ГП',
}

export const AUDIT_DOC_TYPE_KEY: Partial<Record<JournalCategory, string>> = {
  timesheet: 'nav.month',
  finance: 'nav.finance',
  hr: 'nav.hr',
  access: 'nav.settings',
  directories: 'nav.directories',
}

import type { DayCode } from '@/lib/types'
import { daysInMonth, parseMonthKey } from '@/lib/dates'
import { findEmployeeByVoiceName } from '@/lib/voiceNames'
import type { AppStore, Employee } from '@/lib/types'
import type { TimesheetCode, TimesheetTarget } from './types'
import { type AiPendingConfirmation, type AiToolName, type AiToolResult } from './types'

const CODE_ALIASES: Record<string, TimesheetCode> = {
  '8': '8',
  '11': '11',
  н: 'Н',
  ночь: 'Н',
  ночная: 'Н',
  '22': '22',
  в: 'В',
  выходной: 'В',
  от: 'ОТ',
  отпуск: 'ОТ',
  оо: 'ОО',
  'неоплачиваемыйотпуск': 'ОО',
  'отпускбезсодержания': 'ОО',
  б: 'Б',
  больничный: 'Б',
  x: 'X',
  х: 'X',
  пр: 'ПР',
  прогул: 'ПР',
}

export function normalizeCode(raw: unknown): DayCode | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = s.toLowerCase().replace(/\s+/g, '')
  if (CODE_ALIASES[n]) return CODE_ALIASES[n]
  const up = s.toUpperCase() as DayCode
  if (['8', '11', 'Н', '22', 'В', 'ОТ', 'ОО', 'Б', 'X', 'ПР', ''].includes(up)) return up
  return null
}

export function normalizeTarget(raw: unknown): TimesheetTarget {
  const s = String(raw ?? 'fact').toLowerCase()
  if (s === 'plan' || s.includes('план')) return 'plan'
  return 'fact'
}

export function parseMonthArg(args: Record<string, unknown>, activeMonth: string): string {
  const m = String(args.month ?? activeMonth).trim()
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error('Месяц: YYYY-MM')
  return m
}

export function parseDayRange(
  args: Record<string, unknown>,
  month: string,
  requireDay = true,
): { fromDay: number; toDay: number; count: number } {
  const { year, month: mo } = parseMonthKey(month)
  const max = daysInMonth(year, mo)
  const day = Number(args.day) || 0
  let fromDay = Number(args.fromDay) || day || 0
  let toDay = Number(args.toDay) || day || fromDay || 0
  if (!fromDay && !toDay && requireDay) throw new Error('Укажите day или fromDay/toDay')
  if (!fromDay) fromDay = 1
  if (!toDay) toDay = fromDay
  fromDay = Math.max(1, Math.min(max, fromDay))
  toDay = Math.max(1, Math.min(max, toDay))
  if (toDay < fromDay) [fromDay, toDay] = [toDay, fromDay]
  return { fromDay, toDay, count: toDay - fromDay + 1 }
}

export function resolveEmployee(
  store: AppStore,
  args: Record<string, unknown>,
): { ok: true; employee: Employee } | { ok: false; error: string } {
  const q = String(args.employee ?? args.query ?? '').trim()
  if (!q) return { ok: false, error: 'Укажите сотрудника' }

  const active = store.employees.filter((e) => e.active)
  const one = findEmployeeByVoiceName(active, q)
  if (one) return { ok: true, employee: one }

  const partial = active.filter((e) => e.fullName.toLowerCase().includes(q.toLowerCase()))
  if (partial.length === 1) return { ok: true, employee: partial[0]! }
  if (partial.length > 1) {
    return {
      ok: false,
      error: `Несколько: ${partial.map((e) => e.fullName).join(', ')}. Уточните.`,
    }
  }
  return { ok: false, error: `Не найден: ${q}` }
}

export function findRowForEmployee(store: AppStore, month: string, employeeId: string): string | null {
  const sheet = store.months[month]
  if (!sheet) return null
  return sheet.rows.find((r) => r.employeeId === employeeId)?.id ?? null
}

export function matchBrigade(store: AppStore, query: string): string | null {
  const q = query.trim().toLowerCase()
  const exact = store.brigades.find((b) => b.toLowerCase() === q)
  if (exact) return exact
  const partial = store.brigades.filter(
    (b) => b.toLowerCase().includes(q) || q.includes(b.toLowerCase()),
  )
  if (partial.length === 1) return partial[0]!
  if (partial.length > 1) {
    throw new Error(`Несколько бригад: ${partial.join(', ')}. Уточните.`)
  }
  return null
}

export function newConfirmToken(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function requestConfirmation(
  action: AiToolName,
  args: Record<string, unknown>,
  message: string,
  danger: AiPendingConfirmation['danger'] = 'manual',
): AiToolResult {
  const clean = { ...args }
  delete clean.confirmationToken
  return {
    ok: false,
    requiresConfirmation: true,
    confirmation: {
      token: newConfirmToken(),
      action,
      args: clean,
      message,
      danger,
      createdAt: Date.now(),
    },
  }
}

export function isApproved(
  args: Record<string, unknown>,
  ctx: { isConfirmationApproved: (t: string) => boolean },
): boolean {
  const token = String(args.confirmationToken ?? '')
  return token ? ctx.isConfirmationApproved(token) : false
}

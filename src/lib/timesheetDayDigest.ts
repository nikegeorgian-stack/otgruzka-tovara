import { monthProblems } from './problems'
import type { AppStore, AuditEntry, MonthSheet } from './types'

const TIMESHEET_ACTIONS = new Set<AuditEntry['action']>([
  'fact_change',
  'plan_change',
  'plan_save',
  'comment',
  'substitution',
  'bulk',
  'month_clear',
  'month_close',
  'month_reopen',
  'master_coverage',
])

const RISKY_ACTIONS = new Set<AuditEntry['action']>([
  'bulk',
  'month_clear',
  'month_close',
  'month_reopen',
])

function dayKeyLocal(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isAuditToday(entry: AuditEntry, today = dayKeyLocal()): boolean {
  return entry.at.slice(0, 10) === today
}

export function isRiskyAudit(entry: AuditEntry): boolean {
  if (RISKY_ACTIONS.has(entry.action)) return true
  const d = entry.detail.toLowerCase()
  return d.includes('copy plan') || d.includes('план→факт') || d.includes('plan→fact')
}

export function filterTimesheetAudit(opts: {
  store: AppStore
  month: string
  brigadeScope?: string[] | 'all'
  todayOnly?: boolean
  riskyOnly?: boolean
  query?: string
}): AuditEntry[] {
  const scopeSet =
    opts.brigadeScope && opts.brigadeScope !== 'all'
      ? new Set(opts.brigadeScope)
      : null
  const q = opts.query?.trim().toLowerCase() ?? ''
  const today = dayKeyLocal()

  return opts.store.auditLog.filter((e) => {
    if (!TIMESHEET_ACTIONS.has(e.action)) return false
    if (e.action === 'master_coverage') {
      if (e.month && e.month !== opts.month) {
        if (!e.detail.includes(opts.month) && !e.detail.includes(`${opts.month}-`)) {
          return false
        }
      }
    } else if (e.month !== opts.month) {
      return false
    }
    if (scopeSet && e.brigade && !scopeSet.has(e.brigade)) return false
    if (opts.todayOnly && !isAuditToday(e, today)) return false
    if (opts.riskyOnly && !isRiskyAudit(e)) return false
    if (q) {
      const hay = `${e.detail} ${e.byName ?? ''} ${e.action} ${e.dateKey ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Текст сводки дня — удобно вставить в чат с агентом. */
export function buildTimesheetDayDigest(opts: {
  store: AppStore
  sheet: MonthSheet
  month: string
  brigadeScope?: string[] | 'all'
}): string {
  const today = dayKeyLocal()
  const todayEntries = filterTimesheetAudit({
    store: opts.store,
    month: opts.month,
    brigadeScope: opts.brigadeScope,
    todayOnly: true,
  })
  const risky = todayEntries.filter(isRiskyAudit)
  const problems = monthProblems(opts.store, opts.sheet)
  const lines: string[] = [
    `Сводка табеля ${opts.month} · ${today}`,
    `Изменений сегодня: ${todayEntries.length} (рискованных: ${risky.length})`,
  ]

  if (problems.length === 0) {
    lines.push('Проблемы листа: нет')
  } else {
    lines.push('Проблемы листа:')
    for (const p of problems) {
      lines.push(`  - ${p.messageKey}${p.count != null ? ` (${p.count})` : ''}`)
    }
  }

  if (risky.length > 0) {
    lines.push('Рискованные действия сегодня:')
    for (const e of risky.slice(0, 30)) {
      lines.push(`  - ${e.at.slice(11, 19)} · ${e.action} · ${e.detail} · ${e.byName ?? '—'}`)
    }
  }

  if (todayEntries.length > 0) {
    lines.push('Все действия сегодня (до 40):')
    for (const e of todayEntries.slice(0, 40)) {
      lines.push(`  - ${e.at.slice(11, 19)} · ${e.action} · ${e.detail} · ${e.byName ?? '—'}`)
    }
    if (todayEntries.length > 40) {
      lines.push(`  … ещё ${todayEntries.length - 40}`)
    }
  } else {
    lines.push('Действий сегодня по журналу нет.')
  }

  lines.push('')
  lines.push('(скопировано из журнала табеля Otgruzka)')
  return lines.join('\n')
}

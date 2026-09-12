import type { AppStore } from '@/lib/types'
import type { AccessStore } from '@/lib/access/types'
import type { FinanceStore } from '@/lib/finance/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

/** Сколько непустых ячеек план+факт (анти-wipe табеля). */
export function countFilledTimesheetCells(months: AppStore['months'] | undefined): number {
  let n = 0
  for (const sheet of Object.values(months ?? {})) {
    for (const map of [sheet.plan, sheet.fact]) {
      for (const row of Object.values(map ?? {})) {
        for (const code of Object.values(row ?? {})) {
          if (code != null && String(code).trim() !== '') n++
        }
      }
    }
  }
  return n
}

/** Объём склада: номенклатура + движения + документы (анти-wipe). */
export function countWarehouseFootprint(warehouse: WarehouseStore | undefined): number {
  if (!warehouse) return 0
  return (
    (warehouse.items?.length ?? 0) +
    (warehouse.movements?.length ?? 0) +
    (warehouse.documents?.length ?? 0)
  )
}

/** Записи журнала действий табеля (auditLog). */
export function countAuditJournal(auditLog: AppStore['auditLog'] | undefined): number {
  return auditLog?.length ?? 0
}

export function countFinanceFootprint(finance: FinanceStore | undefined): number {
  if (!finance) return 0
  return (
    (finance.advances?.length ?? 0) +
    (finance.advanceDocuments?.length ?? 0) +
    (finance.advanceAccruals?.length ?? 0) +
    (finance.payoutDocuments?.length ?? 0) +
    (finance.adjustments?.length ?? 0) +
    (finance.payouts?.length ?? 0) +
    Object.keys(finance.snapshots ?? {}).length
  )
}

export function countHrContractFootprint(employees: AppStore['employees'] | undefined): number {
  let n = 0
  for (const e of employees ?? []) n += e.hrContracts?.length ?? 0
  return n
}

export function countAccessViewsFootprint(access: AccessStore | undefined): number {
  let n = 0
  for (const list of Object.values(access?.roleViews ?? {})) {
    if (Array.isArray(list)) n += list.length
  }
  for (const list of Object.values(access?.roleDirectorySections ?? {})) {
    if (Array.isArray(list)) n += list.length
  }
  for (const u of access?.users ?? []) {
    if (Array.isArray(u.webViews)) n += u.webViews.length
    if (Array.isArray(u.directorySections)) n += u.directorySections.length
  }
  return n
}

export function countMealsFootprint(meals: AppStore['meals'] | undefined): number {
  if (!meals) return 0
  return (
    (meals.orders?.length ?? 0) +
    (meals.acceptedDays?.length ?? 0) +
    (meals.weeks?.length ?? 0) +
    (meals.catalog?.length ?? 0) +
    (meals.advances?.length ?? 0)
  )
}

export function countOrgChartFootprint(orgChart: AppStore['orgChart'] | undefined): number {
  return orgChart?.nodes?.length ?? 0
}

export function countProtocolsFootprint(
  protocols: AppStore['protocols'] | undefined,
): number {
  if (!protocols) return 0
  return (
    (protocols.protocols?.length ?? 0) +
    (protocols.items?.length ?? 0) +
    (protocols.attachments?.length ?? 0)
  )
}

function refuseIfSparse(
  remote: number,
  merged: number,
  minRemote: number,
  code: string,
): void {
  if (remote >= minRemote && merged < Math.ceil(remote * 0.85)) {
    throw new Error(`${code}:remote=${remote}:merged=${merged}`)
  }
}

/**
 * Запрет массового затирания облачного стора «пустым»/seed локальным merge.
 * Бросает cloud_refuse_* — одинаковые коды для Firestore и SQL Connect.
 */
export function countTimesheetEntriesFootprint(
  te: AppStore['timesheetEntries'] | undefined,
): number {
  return te?.documents?.length ?? 0
}

export function assertNoMassStoreWipe(
  remote: AppStore | null | undefined,
  merged: AppStore,
): void {
  refuseIfSparse(
    remote?.employees?.length ?? 0,
    merged.employees?.length ?? 0,
    8,
    'cloud_refuse_employee_wipe',
  )
  refuseIfSparse(
    remote?.access?.users?.length ?? 0,
    merged.access?.users?.length ?? 0,
    3,
    'cloud_refuse_user_wipe',
  )
  refuseIfSparse(
    countFilledTimesheetCells(remote?.months),
    countFilledTimesheetCells(merged.months),
    30,
    'cloud_refuse_timesheet_wipe',
  )
  refuseIfSparse(
    countAuditJournal(remote?.auditLog),
    countAuditJournal(merged.auditLog),
    40,
    'cloud_refuse_audit_wipe',
  )
  refuseIfSparse(
    countWarehouseFootprint(remote?.warehouse),
    countWarehouseFootprint(merged.warehouse),
    25,
    'cloud_refuse_warehouse_wipe',
  )
  refuseIfSparse(
    countFinanceFootprint(remote?.finance),
    countFinanceFootprint(merged.finance),
    8,
    'cloud_refuse_finance_wipe',
  )
  refuseIfSparse(
    remote?.sales?.orders?.length ?? 0,
    merged.sales?.orders?.length ?? 0,
    5,
    'cloud_refuse_sales_wipe',
  )
  refuseIfSparse(
    remote?.procurement?.orders?.length ?? 0,
    merged.procurement?.orders?.length ?? 0,
    5,
    'cloud_refuse_procurement_wipe',
  )
  refuseIfSparse(
    countMealsFootprint(remote?.meals),
    countMealsFootprint(merged.meals),
    4,
    'cloud_refuse_meals_wipe',
  )
  refuseIfSparse(
    countProtocolsFootprint(remote?.protocols),
    countProtocolsFootprint(merged.protocols),
    3,
    'cloud_refuse_protocols_wipe',
  )
  refuseIfSparse(
    countOrgChartFootprint(remote?.orgChart),
    countOrgChartFootprint(merged.orgChart),
    5,
    'cloud_refuse_org_chart_wipe',
  )
  refuseIfSparse(
    countHrContractFootprint(remote?.employees),
    countHrContractFootprint(merged.employees),
    8,
    'cloud_refuse_hr_contracts_wipe',
  )
  refuseIfSparse(
    countAccessViewsFootprint(remote?.access),
    countAccessViewsFootprint(merged.access),
    10,
    'cloud_refuse_access_views_wipe',
  )
  refuseIfSparse(
    countTimesheetEntriesFootprint(remote?.timesheetEntries),
    countTimesheetEntriesFootprint(merged.timesheetEntries),
    5,
    'cloud_refuse_timesheet_entries_wipe',
  )
  assertBrigadesNotWiped(remote, merged)
}

/** Audit detail from `removeBrigade` / `directory_change`. */
export function isBrigadeDeletedAudit(
  detail: string | undefined,
  brigadeName: string,
): boolean {
  return typeof detail === 'string' && detail.includes(`Бригада удалена: ${brigadeName}`)
}

/**
 * Нельзя сохранить отсутствующий/незагруженный список бригад поверх непустого remote.
 * - `brigades` missing/null/undefined → неполная загрузка → refuse.
 * - `getBrigades()`/`?? []` → `[]` без аудита удаления → refuse (incomplete load must not wipe).
 * - Сокращение / `[]` разрешено только если для каждой исчезнувшей бригады есть
 *   `directory_change` с `Бригада удалена: {name}` (механизм `removeBrigade`).
 *
 * Защищённые пути: `assertNoMassStoreWipe` (SQL Connect / Firestore) и
 * `saveToLocalDb(store, previous)` (локальный SQLite); также `saveStore` (localStorage).
 */
export function assertBrigadesNotWiped(
  remote: AppStore | null | undefined,
  merged: AppStore,
): void {
  const remoteBrigades = Array.isArray(remote?.brigades) ? remote!.brigades : null
  if (!remoteBrigades || remoteBrigades.length === 0) return
  if (!Array.isArray(merged.brigades)) {
    throw new Error(
      `cloud_refuse_brigades_wipe:remote=${remoteBrigades.length}:merged=missing`,
    )
  }
  const kept = new Set(merged.brigades)
  const removed = remoteBrigades.filter((name) => !kept.has(name))
  if (removed.length === 0) return
  const audits = merged.auditLog ?? []
  const intentional = removed.every((name) =>
    audits.some(
      (a) =>
        a.action === 'directory_change' && isBrigadeDeletedAudit(a.detail, name),
    ),
  )
  if (!intentional) {
    throw new Error(
      `cloud_refuse_brigades_wipe:remote=${remoteBrigades.length}:merged=${merged.brigades.length}`,
    )
  }
}

const WIPE_HINTS: Array<{ code: string; sql: string; firestore: string }> = [
  {
    code: 'cloud_refuse_employee_wipe',
    sql: 'Сохранение отклонено: в браузере неполный список сотрудников относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: локально слишком мало сотрудников относительно облака (защита от затирания людей). Обновите страницу (Ctrl+F5) и не сохраняйте, пока не подтянется полный список.',
  },
  {
    code: 'cloud_refuse_user_wipe',
    sql: 'Сохранение отклонено: в браузере слишком мало учёток относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: локально слишком мало учёток относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_timesheet_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть табеля относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть табеля относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_audit_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть журнала действий относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть журнала действий относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_warehouse_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть склада (номенклатура/движения/документы) относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть склада относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_finance_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть финансов (авансы/выплаты/снимки ЗП) относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть финансов относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_sales_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть заказов продаж относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть заказов продаж относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_procurement_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть заказов закупки относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть заказов закупки относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_meals_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть заказов обедов относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть заказов обедов относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_hr_contracts_wipe',
    sql: 'Сохранение отклонено: в браузере пропала большая часть трудовых договоров относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропала большая часть трудовых договоров относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_access_views_wipe',
    sql: 'Сохранение отклонено: в браузере пропали настройки разделов ролей относительно SQL. Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: в браузере пропали настройки разделов ролей относительно облака. Обновите страницу (Ctrl+F5).',
  },
  {
    code: 'cloud_refuse_brigades_wipe',
    sql: 'Сохранение отклонено: пустой список бригад поверх непустого SQL (защита от wipe). Обновите страницу (Ctrl+F5).',
    firestore:
      'Сохранение отклонено: пустой список бригад поверх непустого облака (защита от wipe). Обновите страницу (Ctrl+F5).',
  },
]

/** Текст для UI, если save упал на анти-wipe. Иначе null — вызывающий даёт свой fallback. */
export function cloudRefuseWipeUserMessage(
  err: unknown,
  source: 'sql' | 'firestore',
): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  for (const row of WIPE_HINTS) {
    if (msg.includes(row.code)) return row[source]
  }
  return null
}

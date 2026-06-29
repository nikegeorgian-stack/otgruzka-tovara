import {
  addDaysIso,
  formatShortDate,
  parseIsoDate,
  weekdayShort,
} from '@/lib/dates'
import type { Employee } from '@/lib/types'

export type AttendanceLogDay = {
  iso: string
  weekdayRu: string
  weekdayKa: string
  dateShort: string
}

/**
 * Вместимость листа зависит от шапки:
 *  - первый лист — полная шапка (логотип, реквизиты) → строк меньше;
 *  - последующие — компактная шапка (одна строка) → строк больше.
 * При высоте строки 8.5мм на A4-альбоме это даёт безопасный запас по высоте.
 */
export const ATTENDANCE_LOG_ROWS_FIRST_PAGE = 17
export const ATTENDANCE_LOG_ROWS_OTHER_PAGE = 19
/** Пустые строки «вписать от руки» на последнем листе. */
export const ATTENDANCE_LOG_MANUAL_ROWS = 5
/** Запас под примечание + строку подписей (≈ высота 2 строк). */
export const ATTENDANCE_LOG_FOOTER_RESERVE_ROWS = 2

/** Совместимость: «полный» лист = первый. */
export const ATTENDANCE_LOG_ROWS_PER_PAGE = ATTENDANCE_LOG_ROWS_FIRST_PAGE

export const ATTENDANCE_LOG_SELECTION_KEY = 'fibercell-attendance-log-selection'

export function weekDaysFromMonday(mondayIso: string): AttendanceLogDay[] {
  return Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(mondayIso, i)
    const { year, month, day } = parseIsoDate(iso)
    return {
      iso,
      weekdayRu: weekdayShort(year, month, day, 'ru'),
      weekdayKa: weekdayShort(year, month, day, 'ka'),
      dateShort: formatShortDate(iso, 'ru'),
    }
  })
}

/** ФИО для печати — две строки (RU + KA). */
export function formatEmployeeAttendanceNameLines(emp: Employee): { ru: string; ka?: string } {
  const ru = emp.fullName?.trim() ?? ''
  const ka = emp.nameKa?.trim() ?? ''
  if (ru && ka && ka !== ru) return { ru, ka }
  if (ru) return { ru }
  if (ka) return { ru: ka }
  return { ru: '—' }
}

export function scheduleShortLabel(schedule: Employee['schedule']): string {
  if (schedule === '5/2 8ч') return '5/2'
  if (schedule === '1/1 11ч') return '1/1'
  return '2/2'
}

/** По умолчанию — активные не на графике 5/2. */
export function defaultAttendanceEmployeeIds(employees: Employee[]): string[] {
  return employees
    .filter((e) => e.active !== false && e.schedule !== '5/2 8ч')
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
    .map((e) => e.id)
}

export function sortEmployeesForAttendance(a: Employee, b: Employee): number {
  return a.fullName.localeCompare(b.fullName, 'ru')
}

/** Сколько сотрудников вмещает лист с учётом его типа и резерва на последнем. */
function attendanceEmployeeCapacity(isFirstPage: boolean, isLastPage: boolean): number {
  const base = isFirstPage
    ? ATTENDANCE_LOG_ROWS_FIRST_PAGE
    : ATTENDANCE_LOG_ROWS_OTHER_PAGE
  if (!isLastPage) return base
  return Math.max(
    1,
    base - ATTENDANCE_LOG_MANUAL_ROWS - ATTENDANCE_LOG_FOOTER_RESERVE_ROWS,
  )
}

/**
 * Разбивает сотрудников по листам A4: каждый лист заполняется максимально,
 * остаток — на последнем (с ручными строками и подписями).
 * Точная высота строк подгоняется в fitAttendanceLogPages() после рендера.
 */
export function chunkAttendancePages<T>(items: T[]): T[][] {
  const total = items.length
  if (total === 0) return [[]]

  const pages: T[][] = []
  let i = 0

  while (i < total) {
    const isFirst = pages.length === 0
    const remaining = total - i
    const maxNonLast = attendanceEmployeeCapacity(isFirst, false)
    const maxLast = attendanceEmployeeCapacity(isFirst, true)

    if (remaining <= maxLast) {
      pages.push(items.slice(i))
      break
    }

    // Один лист: влезает без переноса (высоту строк подожмёт fitAttendanceLogPages).
    if (isFirst && remaining <= maxNonLast) {
      pages.push(items.slice(i))
      break
    }

    pages.push(items.slice(i, i + maxNonLast))
    i += maxNonLast
  }

  return pages
}

const ATTENDANCE_MIN_ROW_MM = 6.2
const MM_TO_PX = 96 / 25.4

/** Растягивает строки таблицы на всю высоту листа (превью и печать). */
export function fitAttendanceLogPages(container: HTMLElement | null): void {
  if (!container) return

  container.querySelectorAll<HTMLElement>('.print-attendance-log-page').forEach((page) => {
    const content = page.querySelector<HTMLElement>('.print-attendance-content')
    const table = page.querySelector<HTMLElement>('.print-attendance-log-table')
    const tbody = table?.querySelector<HTMLElement>('tbody')
    const thead = table?.querySelector<HTMLElement>('thead')
    if (!content || !table || !tbody) return

    tbody.querySelectorAll<HTMLElement>('tr').forEach((tr) => {
      tr.style.removeProperty('height')
      tr.querySelectorAll<HTMLElement>(
        '.print-att-time-cell, .print-att-name, .print-att-manual-name',
      ).forEach((cell) => {
        cell.style.removeProperty('height')
        cell.style.removeProperty('min-height')
      })
    })

    const rows = tbody.querySelectorAll('tr')
    const rowCount = rows.length
    if (rowCount === 0) return

    const header = page.querySelector<HTMLElement>('header')
    const note = page.querySelector<HTMLElement>('.print-attendance-hr-note')
    const footer = page.querySelector<HTMLElement>('.print-attendance-footer')

    let reserved = (header?.offsetHeight ?? 0) + (thead?.offsetHeight ?? 0)
    if (note) reserved += note.offsetHeight + 4
    if (footer) reserved += footer.offsetHeight + 4
    reserved += 8 // flex-gap между блоками

    const available = content.clientHeight - reserved
    if (available <= 0) return

    const minRowPx = ATTENDANCE_MIN_ROW_MM * MM_TO_PX
    const rowH = Math.max(minRowPx, available / rowCount)

    rows.forEach((tr) => {
      tr.style.height = `${rowH}px`
      tr.querySelectorAll<HTMLElement>(
        '.print-att-time-cell, .print-att-name, .print-att-manual-name',
      ).forEach((cell) => {
        cell.style.height = `${rowH}px`
        cell.style.minHeight = `${rowH}px`
      })
    })

    page.classList.add('print-attendance-fitted')
  })
}

export function resetAttendanceLogFit(container: HTMLElement | null): void {
  if (!container) return
  container.querySelectorAll<HTMLElement>('.print-attendance-log-page').forEach((page) => {
    page.classList.remove('print-attendance-fitted')
    page.querySelectorAll<HTMLElement>('tbody tr').forEach((tr) => {
      tr.style.removeProperty('height')
      tr.querySelectorAll<HTMLElement>(
        '.print-att-time-cell, .print-att-name, .print-att-manual-name',
      ).forEach((cell) => {
        cell.style.removeProperty('height')
        cell.style.removeProperty('min-height')
      })
    })
  })
}

export function loadAttendanceLogSelection(employees: Employee[]): Set<string> {
  const fallback = new Set(defaultAttendanceEmployeeIds(employees))
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(ATTENDANCE_LOG_SELECTION_KEY)
    if (!raw) return fallback
    const ids = JSON.parse(raw) as unknown
    if (!Array.isArray(ids)) return fallback
    if (ids.length === 0) return new Set()
    const activeIds = new Set(
      employees.filter((e) => e.active !== false).map((e) => e.id),
    )
    const saved = ids.filter((id): id is string => typeof id === 'string' && activeIds.has(id))
    if (saved.length === 0) return fallback
    return new Set(saved)
  } catch {
    return fallback
  }
}

export function saveAttendanceLogSelection(selected: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(ATTENDANCE_LOG_SELECTION_KEY, JSON.stringify([...selected]))
  } catch {
    /* ignore quota */
  }
}

export function formatWeekRange(mondayIso: string, locale: 'ru' | 'ka'): string {
  const start = formatShortDate(mondayIso, locale)
  const end = formatShortDate(addDaysIso(mondayIso, 6), locale)
  const { year } = parseIsoDate(mondayIso)
  return locale === 'ka' ? `${start} — ${end}, ${year}` : `${start} — ${end} ${year} г.`
}

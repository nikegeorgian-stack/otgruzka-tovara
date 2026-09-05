/** Первый лист с логотипом: по превью 2026-08-14 влезает 16–17 строк; 22 обрезались. */
export const OFFICE_STAFF_PRINT_ROWS_FIRST = 16
/** Продолжение — короткая шапка, больше строк. */
export const OFFICE_STAFF_PRINT_ROWS_OTHER = 20
const MAX_ROW_MM = 8.2
const MM_TO_PX = 96 / 25.4

export function chunkOfficeStaffPrintPages<T>(items: T[]): T[][] {
  if (items.length === 0) return [[]]
  const pages: T[][] = []
  let i = 0
  while (i < items.length) {
    const cap = pages.length === 0 ? OFFICE_STAFF_PRINT_ROWS_FIRST : OFFICE_STAFF_PRINT_ROWS_OTHER
    const remaining = items.length - i
    if (remaining <= cap) {
      pages.push(items.slice(i))
      break
    }
    pages.push(items.slice(i, i + cap))
    i += cap
  }
  return pages
}

/** Растягивает строки, но никогда не выше available/n — иначе overflow:hidden режет людей. */
export function fitOfficeStaffPrintPages(container: HTMLElement | null): void {
  if (!container) return
  const maxPx = MAX_ROW_MM * MM_TO_PX

  container.querySelectorAll<HTMLElement>('.office-staff-print-page').forEach((page) => {
    const content = page.querySelector<HTMLElement>('.print-sheet-content')
    const table = page.querySelector<HTMLElement>('.office-staff-print-table')
    const tbody = table?.querySelector<HTMLElement>('tbody')
    const thead = table?.querySelector<HTMLElement>('thead')
    const header = page.querySelector<HTMLElement>('header')
    if (!content || !tbody) return

    tbody.querySelectorAll<HTMLElement>('tr').forEach((tr) => tr.style.removeProperty('height'))

    const rows = tbody.querySelectorAll('tr')
    if (rows.length === 0) return

    const reserved = (header?.offsetHeight ?? 0) + (thead?.offsetHeight ?? 0) + 8
    const available = content.clientHeight - reserved
    if (available <= 0) return

    const rowH = Math.min(maxPx, available / rows.length)
    rows.forEach((tr) => {
      ;(tr as HTMLElement).style.height = `${rowH}px`
    })
  })
}

/** Геометрия листа для автоподгонки бланков (96dpi CSS). */
const PAPER_MM = {
  a4: { landscape: { w: 297, h: 210 }, portrait: { w: 210, h: 297 } },
  a3: { landscape: { w: 420, h: 297 }, portrait: { w: 297, h: 420 } },
} as const

/** Внутренние поля листа (согласовано с padding .print-sheet-page). */
const MARGIN_MM = 16
const MM_TO_PX = 96 / 25.4

export type PrintFitOpts = {
  /** Только уменьшать (документы/накладные). false — можно слегка увеличить до ~92% fill. */
  shrinkOnly?: boolean
  /** Книжная ориентация. По умолчанию альбом. */
  portrait?: boolean
  /** Размер бумаги. По умолчанию A4. */
  paper?: 'a4' | 'a3'
}

function pageScale(
  page: HTMLElement,
  maxHPx: number,
  maxWPx: number,
  shrinkOnly: boolean,
): number {
  const content =
    page.querySelector<HTMLElement>('.print-sheet-content') ?? page

  const h = Math.max(page.scrollHeight, content.scrollHeight)
  const w = Math.max(content.scrollWidth, page.clientWidth)

  let scale = 1

  if (h > maxHPx) {
    scale = Math.min(scale, (maxHPx / h) * 0.98)
  }
  if (w > maxWPx) {
    scale = Math.min(scale, (maxWPx / w) * 0.98)
  }

  if (!shrinkOnly) {
    const targetFill = 0.92
    if (h < maxHPx * targetFill && w < maxWPx * targetFill) {
      const scaleUp = Math.min(
        (maxHPx / h) * targetFill,
        (maxWPx / w) * targetFill,
        1.15,
      )
      scale = Math.max(scale, scaleUp)
    }
  }

  return scale
}

/**
 * Подгоняет все `.print-sheet-page` в контейнере под один лист A4
 * (единый zoom на все страницы превью, чтобы комплекты не «плясали»).
 */
export function fitPrintPages(
  container: HTMLElement | null,
  opts?: PrintFitOpts,
): void {
  if (!container) return

  const shrinkOnly = opts?.shrinkOnly ?? false
  const paper = opts?.paper ?? 'a4'
  const orient = opts?.portrait ? 'portrait' : 'landscape'
  const { w: pageWmm, h: pageHmm } = PAPER_MM[paper][orient]
  const maxHPx = (pageHmm - MARGIN_MM) * MM_TO_PX
  const maxWPx = (pageWmm - MARGIN_MM) * MM_TO_PX

  const pages = [...container.querySelectorAll<HTMLElement>('.print-sheet-page')].filter(
    (page) => !page.classList.contains('print-sheet-page--work-schedule'),
  )
  if (!pages.length) return

  pages.forEach((page) => {
    page.style.removeProperty('zoom')
    page.classList.remove('print-scaled')
  })

  let scale = 1
  for (const page of pages) {
    scale = Math.min(scale, pageScale(page, maxHPx, maxWPx, shrinkOnly))
  }

  if (Math.abs(scale - 1) < 0.02) return

  pages.forEach((page) => {
    page.style.zoom = String(scale)
    page.classList.add('print-scaled')
  })
}

export function resetPrintFit(container: HTMLElement | null): void {
  if (!container) return
  container.querySelectorAll('.print-sheet-page').forEach((page) => {
    page.classList.remove('print-scaled')
    const el = page as HTMLElement
    el.style.removeProperty('zoom')
  })
}

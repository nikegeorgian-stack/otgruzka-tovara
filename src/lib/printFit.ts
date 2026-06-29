/** A4 альбом: высота и ширина печатной области (мм) */
const PAGE_H_MM = 210
const PAGE_W_MM = 297
const MARGIN_MM = 16
const MM_TO_PX = 96 / 25.4

function pageScale(
  page: HTMLElement,
  maxHPx: number,
  maxWPx: number,
  shrinkOnly: boolean,
): number {
  const content = page.querySelector<HTMLElement>('.print-sheet-content')
  if (!content) return 1

  const h = page.scrollHeight
  const w = content.scrollWidth

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

export function fitPrintPages(
  container: HTMLElement | null,
  opts?: { shrinkOnly?: boolean; portrait?: boolean },
): void {
  if (!container) return

  const shrinkOnly = opts?.shrinkOnly ?? false
  // Портрет: высота/ширина страницы меняются местами.
  const pageHmm = opts?.portrait ? PAGE_W_MM : PAGE_H_MM
  const pageWmm = opts?.portrait ? PAGE_H_MM : PAGE_W_MM
  const maxHPx = (pageHmm - MARGIN_MM) * MM_TO_PX
  const maxWPx = (pageWmm - MARGIN_MM) * MM_TO_PX

  const pages = [...container.querySelectorAll<HTMLElement>('.print-sheet-page')]
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

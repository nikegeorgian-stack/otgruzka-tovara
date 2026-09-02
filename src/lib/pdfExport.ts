type PdfOrientation = 'landscape' | 'portrait'

type ExportPdfOptions = {
  /** Каждый элемент — отдельная страница PDF. Если не найдено — экспорт всего блока. */
  pageSelector?: string
  orientation?: PdfOrientation
  /** Формат листа PDF. По умолчанию a4. */
  format?: 'a4' | 'a3'
}

async function loadPdfLibs() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])
  return { html2canvas, jsPDF }
}

function addCanvasToPdf(
  pdf: InstanceType<Awaited<ReturnType<typeof loadPdfLibs>>['jsPDF']>,
  canvas: HTMLCanvasElement,
  pageW: number,
  pageH: number,
  isFirst: boolean,
) {
  if (!isFirst) pdf.addPage()
  const ratio = Math.min(pageW / canvas.width, pageH / canvas.height)
  const w = canvas.width * ratio
  const h = canvas.height * ratio
  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    (pageW - w) / 2,
    (pageH - h) / 2,
    w,
    h,
  )
}

/** Клон вне overflow-модалки — html2canvas иначе часто даёт пустой/обрезанный PDF. */
function mountOffscreenClone(
  source: HTMLElement,
  widthPx = 794,
): { host: HTMLDivElement; clone: HTMLElement } {
  const host = document.createElement('div')
  host.setAttribute('data-pdf-capture-host', '1')
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthPx}px;background:#fff;z-index:-1;pointer-events:none;`
  const clone = source.cloneNode(true) as HTMLElement
  clone.style.cssText = [
    `width:${widthPx}px`,
    `max-width:${widthPx}px`,
    'background:#ffffff',
    'color:#1c1917',
    'box-shadow:none',
    'margin:0',
    'overflow:visible',
  ].join(';')
  host.appendChild(clone)
  document.body.appendChild(host)
  return { host, clone }
}

async function captureElement(
  html2canvas: Awaited<ReturnType<typeof loadPdfLibs>>['html2canvas'],
  el: HTMLElement,
  scale: number,
) {
  return html2canvas(el, {
    scale,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    foreignObjectRendering: false,
    scrollX: 0,
    scrollY: 0,
    windowWidth: Math.max(el.scrollWidth, el.offsetWidth, 794),
    windowHeight: Math.max(el.scrollHeight, el.offsetHeight),
    onclone: (_doc, cloned) => {
      cloned.style.color = '#1c1917'
      cloned.style.background = '#ffffff'
      cloned.querySelectorAll<HTMLElement>('*').forEach((node) => {
        const cs = (cloned.ownerDocument.defaultView ?? window).getComputedStyle(node)
        // oklch/lab в Tailwind ломают html2canvas — упрощаем цвет текста/фона
        if (cs.color.includes('oklch') || cs.color.includes('lab(')) node.style.color = '#1c1917'
        if (cs.backgroundColor.includes('oklch') || cs.backgroundColor.includes('lab(')) {
          node.style.backgroundColor = 'transparent'
        }
      })
    },
  })
}

export async function exportPrintAreaToPdf(
  element: HTMLElement,
  filename: string,
  opts?: ExportPdfOptions,
): Promise<void> {
  const { html2canvas, jsPDF } = await loadPdfLibs()
  const orientation = opts?.orientation ?? 'landscape'
  const pageSelector = opts?.pageSelector ?? '.print-sheet-page'
  const format = opts?.format ?? 'a4'
  const pages = [...element.querySelectorAll<HTMLElement>(pageSelector)]
  const targets = pages.length > 0 ? pages : [element]

  const pdf = new jsPDF({ orientation, unit: 'mm', format })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < targets.length; i++) {
    const captureW = format === 'a3' ? 1587 : 1123
    const { host, clone } = mountOffscreenClone(targets[i]!, captureW)
    try {
      // дать браузеру отрисовать клон
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await captureElement(html2canvas, clone, pages.length > 0 ? 2.5 : 2)
      if (!canvas.width || !canvas.height) {
        throw new Error('PDF capture produced empty canvas')
      }
      addCanvasToPdf(pdf, canvas, pageW, pageH, i === 0)
    } finally {
      host.remove()
    }
  }

  pdf.save(filename)
}

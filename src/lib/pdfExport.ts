type PdfOrientation = 'landscape' | 'portrait'

type ExportPdfOptions = {
  /** Каждый элемент — отдельная страница PDF. Если не найдено — экспорт всего блока. */
  pageSelector?: string
  orientation?: PdfOrientation
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

export async function exportPrintAreaToPdf(
  element: HTMLElement,
  filename: string,
  opts?: ExportPdfOptions,
): Promise<void> {
  const { html2canvas, jsPDF } = await loadPdfLibs()
  const orientation = opts?.orientation ?? 'landscape'
  const pageSelector = opts?.pageSelector ?? '.print-sheet-page'
  const pages = [...element.querySelectorAll<HTMLElement>(pageSelector)]

  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()

  if (pages.length === 0) {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
    })
    addCanvasToPdf(pdf, canvas, pageW, pageH, true)
    pdf.save(filename)
    return
  }

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    const canvas = await html2canvas(page, {
      scale: 3,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: page.offsetWidth,
      height: page.offsetHeight,
      windowWidth: page.scrollWidth,
      windowHeight: page.scrollHeight,
    })
    addCanvasToPdf(pdf, canvas, pageW, pageH, i === 0)
  }

  pdf.save(filename)
}

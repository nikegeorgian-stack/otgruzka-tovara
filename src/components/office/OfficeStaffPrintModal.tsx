import { useEffect, useRef, useState } from 'react'
import { OfficeStaffPrintSheet } from '@/components/office/OfficeStaffPrintSheet'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Skeleton'
import { useI18n } from '@/context/I18nContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { fitOfficeStaffPrintPages } from '@/lib/office/staffListPrint'

type Props = {
  headers: string[]
  rows: string[][]
  site: string
  onClose: () => void
}

export function OfficeStaffPrintModal({ headers, rows, site, onClose }: Props) {
  const { t, locale } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const printedAt = new Date().toLocaleString(locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-GB' : 'ru-RU')

  useEffect(() => {
    document.body.classList.add('print-preview-open', 'print-office-staff')
    const runFit = () => fitOfficeStaffPrintPages(printRef.current)
    const raf = requestAnimationFrame(() => requestAnimationFrame(runFit))
    return () => {
      cancelAnimationFrame(raf)
      document.body.classList.remove('print-preview-open', 'print-office-staff')
    }
  }, [headers, rows, locale])

  function handlePrint() {
    fitOfficeStaffPrintPages(printRef.current)
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      fitOfficeStaffPrintPages(printRef.current)
      await exportPrintAreaToPdf(printRef.current, 'office-staff.pdf', {
        pageSelector: '.office-staff-print-page',
        orientation: 'landscape',
      })
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <PrintModalShell open onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white print:hidden">
        <p className="text-sm font-semibold">{t('office.printPreview')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="print" size="sm" type="button" onClick={handlePrint}>
            {t('office.print')}
          </Button>
          <Button variant="secondary" size="sm" type="button" disabled={pdfBusy} onClick={() => void handlePdf()}>
            {pdfBusy ? <Spinner className="h-4 w-4" /> : t('office.pdf')}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('office.close')}
          </Button>
        </div>
      </div>
      <div className="print-modal-body">
        <div ref={printRef}>
          <OfficeStaffPrintSheet
            headers={headers}
            rows={rows}
            site={site}
            locale={locale}
            printedAt={printedAt}
          />
        </div>
      </div>
    </PrintModalShell>
  )
}

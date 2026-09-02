import { useRef, useState } from 'react'
import { ProtocolAckBlankSheet, type ProtocolAckBlankData } from '@/components/protocols/ProtocolAckBlankSheet'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Skeleton'
import { useI18n } from '@/context/I18nContext'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'

type Props = {
  data: ProtocolAckBlankData
  onClose: () => void
}

export function ProtocolAckPrintModal({ data, onClose }: Props) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  function handlePrint() {
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      const safeNum = data.protocolNumber.replace(/[^\w\-]+/g, '_')
      await exportPrintAreaToPdf(
        printRef.current,
        `protocol-ack-${safeNum}-p${data.itemSortOrder}.pdf`,
        {
          pageSelector: '.protocol-ack-print-page',
          orientation: 'portrait',
        },
      )
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <PrintModalShell open onClose={onClose}>
      <div className="flex items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white print:hidden">
        <p className="text-sm font-semibold">{t('protocols.ack.printPreview')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="print" size="sm" type="button" onClick={handlePrint}>
            {t('protocols.ack.print')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={pdfBusy}
            onClick={() => void handlePdf()}
          >
            {pdfBusy ? <Spinner className="h-4 w-4" /> : t('protocols.ack.pdf')}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
      <div className="print-modal-body">
        <div ref={printRef}>
          <ProtocolAckBlankSheet data={data} />
        </div>
      </div>
    </PrintModalShell>
  )
}

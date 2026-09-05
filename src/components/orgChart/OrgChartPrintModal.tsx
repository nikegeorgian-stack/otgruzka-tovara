import { useRef, useState } from 'react'
import {
  OrgChartPrintSheet,
  type OrgChartPrintPaper,
} from '@/components/orgChart/OrgChartPrintSheet'
import { PrintModalShell } from '@/components/print/PrintModalShell'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Skeleton'
import { useI18n } from '@/context/I18nContext'
import { usePrintFit } from '@/hooks/usePrintFit'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import type { OrgChartDisplayMode, OrgChartNode } from '@/lib/orgChart/types'

type Props = {
  organization: string
  nodes: OrgChartNode[]
  displayMode: OrgChartDisplayMode
  rootId?: string
  onClose: () => void
}

export function OrgChartPrintModal({ organization, nodes, displayMode, rootId, onClose }: Props) {
  const { t, locale } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [paper, setPaper] = useState<OrgChartPrintPaper>('a4')
  const printedAt = new Date().toLocaleString(
    locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-GB' : 'ru-RU',
  )

  const { runFit } = usePrintFit(printRef, {
    shrinkOnly: true,
    paper,
    deps: [nodes, displayMode, paper, organization],
  })

  return (
    <PrintModalShell open onClose={onClose}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white print:hidden">
        <p className="text-sm font-semibold">{t('orgTree.printPreview')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-md border border-stone-600 bg-stone-800 p-0.5 text-xs"
            role="group"
            aria-label={t('orgTree.printPaper')}
          >
            {(['a4', 'a3'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`rounded px-2.5 py-1 ${
                  paper === p ? 'bg-white font-semibold text-stone-900' : 'text-stone-300'
                }`}
                onClick={() => setPaper(p)}
              >
                {t(`orgTree.paper.${p}`)}
              </button>
            ))}
          </div>
          <Button
            variant="print"
            size="sm"
            type="button"
            onClick={() => {
              runFit()
              requestAnimationFrame(() => window.print())
            }}
          >
            {t('orgTree.print')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={pdfBusy}
            onClick={async () => {
              if (!printRef.current) return
              setPdfBusy(true)
              try {
                runFit()
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
                await exportPrintAreaToPdf(printRef.current, 'org-chart.pdf', {
                  pageSelector: '.org-chart-print-page',
                  orientation: 'landscape',
                  format: paper,
                })
              } finally {
                setPdfBusy(false)
              }
            }}
          >
            {pdfBusy ? <Spinner className="h-4 w-4" /> : t('orgTree.pdf')}
          </Button>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
      <div className="print-modal-body">
        <div ref={printRef}>
          <OrgChartPrintSheet
            organization={organization}
            nodes={nodes}
            displayMode={displayMode}
            rootId={rootId}
            paper={paper}
            printedAt={printedAt}
            title={t('orgTree.printTitle')}
          />
        </div>
      </div>
    </PrintModalShell>
  )
}

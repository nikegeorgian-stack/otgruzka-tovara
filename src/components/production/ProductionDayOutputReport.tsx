import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { KpiCard } from '@/components/ui/KpiCard'
import { useI18n } from '@/context/I18nContext'
import { varianceLevelClass } from '@/lib/formulations/batchAnalysis'
import { exportDayOutputExcel } from '@/lib/export/dayOutputExcel'
import { formatNum } from '@/lib/production/stats'
import {
  buildDayOutputReport,
  dayOutputReportPrintHtml,
} from '@/lib/production/dayOutputReport'
import type { ProductionRequest } from '@/lib/production/types'
import type { FormulationStore } from '@/lib/formulations/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  date: string
  requests: ProductionRequest[]
  formulations: FormulationStore
  warehouse: WarehouseStore
  orders?: ProductionOrder[]
  asOfIso?: string
}

export function ProductionDayOutputReport({
  date,
  requests,
  formulations,
  warehouse,
  orders,
  asOfIso,
}: Props) {
  const { t } = useI18n()
  const printBusy = useRef(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const report = useMemo(
    () => buildDayOutputReport(date, requests, formulations, warehouse, asOfIso, orders),
    [date, requests, formulations, warehouse, asOfIso, orders],
  )

  function handlePrint() {
    if (printBusy.current) return
    printBusy.current = true
    const html = dayOutputReportPrintHtml(report, {
      title: t('production.dayOutput.title'),
      plannerPlan: t('production.dayOutput.plannerPlan'),
      requestPlan: t('production.dayOutput.requestPlan'),
      fact: t('production.dayOutput.factMp'),
      batches: t('production.dayOutput.batchesOut'),
      cost: t('production.dayOutput.batchCost'),
    })
    const w = window.open('', '_blank', 'noopener,noreferrer')
    if (!w) {
      printBusy.current = false
      return
    }
    w.document.open()
    w.document.write(html)
    w.document.close()
    w.focus()
    w.onload = () => {
      w.print()
      printBusy.current = false
    }
    setTimeout(() => {
      try {
        w.print()
      } catch {
        /* ignore */
      }
      printBusy.current = false
    }, 400)
  }

  async function handleExcel() {
    if (excelBusy) return
    setExcelBusy(true)
    try {
      await exportDayOutputExcel(report, {
        sheetSummary: t('production.dayOutput.excel.summary'),
        sheetBatches: t('production.dayOutput.excel.batches'),
        sheetDocs: t('production.dayOutput.excel.docs'),
        title: t('production.dayOutput.title'),
        date: t('production.date'),
        plannerPlan: t('production.dayOutput.plannerPlan'),
        requestPlan: t('production.dayOutput.requestPlan'),
        fact: t('production.dayOutput.factMp'),
        material: t('production.dayOutput.materialIn'),
        batchCost: t('production.dayOutput.batchCost'),
        postedReq: t('production.dayOutput.postedReq'),
        draftReq: t('production.dayOutput.draftReq'),
        batchesOk: t('production.dayOutput.batchesOk'),
        batchesPending: t('production.dayOutput.batchesPending'),
        docs: t('production.dayOutput.docs'),
        colBatch: t('production.dayOutput.colBatch'),
        colRecipe: t('production.dayOutput.colRecipe'),
        colStatus: t('technologist.col.status'),
        colOut: t('production.dayOutput.colOut'),
        colMat: t('production.dayOutput.colMat'),
        colCost: t('production.dayOutput.colCost'),
        colCostPerKg: t('production.dayOutput.colCostPerKg'),
        colVar: t('production.dayOutput.colVar'),
        colDoc: t('technologist.col.doc'),
        colType: t('production.dayOutput.colDocType'),
        colRole: t('production.dayOutput.colDocRole'),
        colLines: t('production.dayOutput.colDocLines'),
      })
    } finally {
      setExcelBusy(false)
    }
  }

  return (
    <section className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t('production.dayOutput.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-stone-500">
            {t('production.dayOutput.hint')} · {date}
          </p>
          <Button size="sm" variant="secondary" onClick={handlePrint}>
            {t('production.dayOutput.print')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={excelBusy}
            onClick={() => void handleExcel()}
          >
            {t('production.dayOutput.excel')}
          </Button>
        </div>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t('production.dayOutput.plannerPlan')}
          value={formatNum(report.plannerPlanMp)}
        />
        <KpiCard
          label={t('production.dayOutput.requestPlan')}
          value={formatNum(report.requestPlanMp)}
        />
        <KpiCard label={t('production.dayOutput.factMp')} value={formatNum(report.factMp)} />
        <KpiCard
          label={t('production.dayOutput.batchesOut')}
          value={`${formatNum(report.outputKgTotal)} кг`}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-stone-600">
        <span>
          {t('production.dayOutput.materialIn')}:{' '}
          <strong>{formatNum(report.materialKgTotal)} кг</strong>
        </span>
        <span>
          {t('production.dayOutput.docs')}:{' '}
          <strong>{report.issueDocs + report.receiptDocs}</strong>
        </span>
        <span>
          {t('production.dayOutput.postedReq')}: <strong>{report.postedRequests}</strong>
        </span>
        <span>
          {t('production.dayOutput.draftReq')}: <strong>{report.draftRequests}</strong>
        </span>
        <span>
          {t('production.dayOutput.batchesOk')}: <strong>{report.batchesConfirmed}</strong>
        </span>
        <span>
          {t('production.dayOutput.batchesPending')}: <strong>{report.batchesPending}</strong>
        </span>
        {report.batchCostTotal != null ? (
          <span>
            {t('production.dayOutput.batchCost')}:{' '}
            <strong>{formatNum(report.batchCostTotal)}</strong>
          </span>
        ) : null}
      </div>

      {report.batches.length > 0 ? (
        <div className="mb-3 overflow-auto">
          <table className="w-full min-w-[32rem] text-xs">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="pb-1 pr-2">{t('production.dayOutput.colBatch')}</th>
                <th className="pb-1 pr-2">{t('production.dayOutput.colRecipe')}</th>
                <th className="pb-1 pr-2 text-right">{t('production.dayOutput.colOut')}</th>
                <th className="pb-1 pr-2 text-right">{t('production.dayOutput.colMat')}</th>
                <th className="pb-1 pr-2 text-right">{t('production.dayOutput.colCost')}</th>
                <th className="pb-1 text-right">{t('production.dayOutput.colVar')}</th>
              </tr>
            </thead>
            <tbody>
              {report.batches.map((b) => (
                <tr key={b.runId} className="border-t border-stone-100">
                  <td className="py-1 pr-2 font-medium">{b.documentNumber}</td>
                  <td className="py-1 pr-2">
                    {b.recipeCode} · {b.recipeName}
                    <span className="ml-1 text-stone-400">({b.status})</span>
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatNum(b.outputKg)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{formatNum(b.materialKg)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.costTotal != null ? formatNum(b.costTotal) : '—'}
                  </td>
                  <td
                    className={`py-1 text-right tabular-nums ${varianceLevelClass(b.varianceLevel)}`}
                  >
                    {b.maxAbsVariancePct != null ? `${formatNum(b.maxAbsVariancePct)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-stone-400">{t('production.dayOutput.varHint')}</p>
        </div>
      ) : (
        <p className="mb-2 text-xs text-stone-500">{t('production.dayOutput.noBatches')}</p>
      )}

      {report.warehouseDocs.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {report.warehouseDocs.map((d) => (
            <span
              key={d.id}
              className="rounded-sm bg-stone-50 px-2 py-1 ring-1 ring-stone-200"
            >
              {d.number} · {d.type}
              {d.docRole ? ` · ${d.docRole}` : ''} · {d.lineCount}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-stone-500">{t('production.dayOutput.noDocs')}</p>
      )}
    </section>
  )
}

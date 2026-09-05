import type { ShiftReportPrintModel } from '@/lib/production/shiftReportPrint'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'

type Props = {
  model: ShiftReportPrintModel
  labels: {
    title: string
    correction: string
    corrects: string
    order: string
    line: string
    shift: string
    master: string
    recipe: string
    materials: string
    norm: string
    fact: string
    deviation: string
    reason: string
    waste: string
    output: string
    rolls: string
    docs: string
    eSign: string
    manualSign: string
    date: string
  }
}

export function ProductionShiftReportPrintSheet({ model, labels }: Props) {
  return (
    <div className="print-sheet mx-auto max-w-[210mm] bg-white p-6 text-[11px] text-black">
      <div className="flex items-start justify-between gap-4 border-b border-black pb-2">
        <FiberCellBrand />
        <h1 className="text-right text-sm font-bold uppercase tracking-wide">{labels.title}</h1>
      </div>
      {model.isCorrection && (
        <p className="mt-2 rounded border border-amber-600 bg-amber-50 px-2 py-1 font-semibold">
          {labels.correction}
          {model.correctsReportNumber
            ? ` · ${labels.corrects}: ${model.correctsReportNumber}`
            : ''}
          {model.correctionReason ? ` · ${model.correctionReason}` : ''}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <span className="text-stone-500">{labels.title} №</span> {model.number}
        </div>
        <div>
          <span className="text-stone-500">{labels.date}</span> {model.shiftDate}
        </div>
        <div>
          <span className="text-stone-500">{labels.order}</span>{' '}
          {model.productionOrderNumber || model.productionOrderId}
        </div>
        <div>
          <span className="text-stone-500">{labels.line}</span> {model.lineId} · {labels.shift}:{' '}
          {model.shift}
        </div>
        <div>
          <span className="text-stone-500">{labels.master}</span>{' '}
          {model.responsibleNameSnapshot || '—'}
        </div>
        <div>
          <span className="text-stone-500">{labels.recipe}</span> v{model.recipeVersionNumber} ·{' '}
          {model.recipeVersionId} · {model.recipeContentHash}
          {model.legacyCapture ? ' · legacy' : ''}
        </div>
      </div>

      <h3 className="mt-4 border-b border-black pb-1 text-xs font-bold">{labels.materials}</h3>
      <table className="mt-1 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="py-0.5">ID / code</th>
            <th>{labels.norm}</th>
            <th>{labels.fact}</th>
            <th>{labels.deviation}</th>
            <th>{labels.reason}</th>
            <th>batch</th>
          </tr>
        </thead>
        <tbody>
          {model.materialLines.map((l) => (
            <tr key={l.itemId} className="border-b border-stone-300 align-top">
              <td className="py-0.5">
                {l.itemCodeSnapshot || l.itemId}
                {l.itemNameSnapshot ? ` · ${l.itemNameSnapshot}` : ''}
                <div className="text-[9px] text-stone-500">{l.itemId}</div>
              </td>
              <td>
                {l.normQty.toFixed(3)} {l.unitSnapshot}
              </td>
              <td>
                {l.actualInputQty.toFixed(3)} ({l.processConsumedQty.toFixed(3)}+
                {l.wasteQty.toFixed(3)})
              </td>
              <td>
                {l.deviationQty.toFixed(3)} ({l.deviationPct.toFixed(1)}% / ±{l.tolerancePct}%)
              </td>
              <td>{l.deviationReason || '—'}</td>
              <td>{l.batchNo || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <span className="font-semibold">{labels.output}:</span> {model.outputM2} м² ·{' '}
          {labels.rolls}: {model.rollCount}
          {model.m2PerRollSnapshot != null ? ` · m²/roll=${model.m2PerRollSnapshot}` : ''}
          <div className="text-[9px] text-stone-500">SF item: {model.semiFinishedItemId}</div>
        </div>
        <div>
          <span className="font-semibold">{labels.docs}:</span>
          <ul className="list-inside list-disc">
            {model.consumptionDocumentNumber && <li>РС: {model.consumptionDocumentNumber}</li>}
            {model.wipReceiptDocumentNumber && <li>ПФ: {model.wipReceiptDocumentNumber}</li>}
            {model.wasteDocumentNumbers.map((n) => (
              <li key={n}>ОТ: {n}</li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="mt-3 border-b border-black pb-1 text-xs font-bold">{labels.waste}</h3>
      {model.wasteLines.length === 0 ? (
        <p className="text-stone-500">—</p>
      ) : (
        <table className="mt-1 w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th>itemId</th>
              <th>qty</th>
              <th>batch</th>
              <th>{labels.reason}</th>
            </tr>
          </thead>
          <tbody>
            {model.wasteLines.map((w, i) => (
              <tr key={`${w.itemId}-${i}`} className="border-b border-stone-300">
                <td>{w.itemId}</td>
                <td>
                  {w.quantity} {w.unitSnapshot}
                </td>
                <td>{w.batchNo || '—'}</td>
                <td>
                  {w.reasonCode}
                  {w.comment ? ` · ${w.comment}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="mt-4 border-b border-black pb-1 text-xs font-bold">{labels.eSign}</h3>
      <ul className="mt-1 space-y-1">
        {model.electronicSignatures.map((s, i) => (
          <li key={i}>
            {s.role}: {s.name}
            {s.at ? ` · ${s.at}` : ''}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 border-b border-black pb-1 text-xs font-bold">{labels.manualSign}</h3>
      <div className="mt-2 grid grid-cols-3 gap-4">
        {model.manualSignatureSlots.map((slot) => (
          <div key={slot} className="border-b border-black pt-8 text-center text-[10px]">
            {slot}
          </div>
        ))}
      </div>
    </div>
  )
}

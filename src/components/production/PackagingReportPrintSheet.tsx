import type { PackagingReportPrintModel, QcDecisionPrintModel } from '@/lib/production/packagingReportPrint'

type Props = {
  model: PackagingReportPrintModel
}

export function PackagingReportPrintSheet({ model }: Props) {
  return (
    <div className="print-sheet text-sm text-slate-900">
      {model.banner ? (
        <div className="mb-2 border border-slate-800 px-2 py-1 text-center text-xs font-semibold tracking-wide">
          {model.banner}
        </div>
      ) : null}
      <h1 className="mb-1 text-base font-semibold">Упаковочный отчёт {model.number}</h1>
      <p className="mb-3 text-xs text-slate-600">
        {model.shiftDate} · смена {model.shift} · линия {model.lineId}
        {model.productionOrderNumber ? ` · заказ ${model.productionOrderNumber}` : ''}
      </p>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <div>ГП productId: {model.finishedProductId}</div>
        <div>Склад itemId: {model.warehouseItemId}</div>
        <div>ПФ itemId: {model.semiFinishedItemId}</div>
        <div>Партия: {model.batchNo}</div>
        <div>
          Выпуск: {model.outputM2} м² / {model.rollCount} рул. / {model.palletCount} пал.
        </div>
        <div>QC: {model.qcStatus ?? '—'}</div>
      </div>
      <h2 className="mb-1 text-xs font-semibold uppercase">WIP</h2>
      <table className="mb-3 w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border px-1 py-0.5 text-left">Shift report</th>
            <th className="border px-1 py-0.5 text-left">Item</th>
            <th className="border px-1 py-0.5 text-right">Qty</th>
            <th className="border px-1 py-0.5 text-left">Batch</th>
          </tr>
        </thead>
        <tbody>
          {model.wipLines.map((line) => (
            <tr key={`${line.shiftReportId}-${line.itemId}`}>
              <td className="border px-1 py-0.5">{line.shiftReportId}</td>
              <td className="border px-1 py-0.5">{line.itemId}</td>
              <td className="border px-1 py-0.5 text-right">
                {line.quantity} {line.unitSnapshot}
              </td>
              <td className="border px-1 py-0.5">{line.batchNo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mb-1 text-xs font-semibold uppercase">Материалы упаковки</h2>
      <table className="mb-3 w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="border px-1 py-0.5 text-left">Item</th>
            <th className="border px-1 py-0.5 text-right">Qty</th>
            <th className="border px-1 py-0.5 text-left">Batch</th>
          </tr>
        </thead>
        <tbody>
          {model.materialLines.map((line) => (
            <tr key={`${line.itemId}-${line.batchNo ?? ''}`}>
              <td className="border px-1 py-0.5">
                {line.itemCodeSnapshot ?? line.itemId}
                {line.itemNameSnapshot ? ` · ${line.itemNameSnapshot}` : ''}
              </td>
              <td className="border px-1 py-0.5 text-right">
                {line.quantity} {line.unitSnapshot}
              </td>
              <td className="border px-1 py-0.5">{line.batchNo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mb-2 text-xs">
        Документы: {model.relatedDocumentNumbers.join(', ') || '—'}
      </p>
      <p className="mb-2 text-xs">
        Паспорт: {model.passportAttachment?.displayName ?? '—'} (
        {model.passportAttachment?.uploadStatus ?? 'missing'}) · Протокол:{' '}
        {model.protocolAttachment?.displayName ?? '—'} (
        {model.protocolAttachment?.uploadStatus ?? 'missing'})
      </p>
      {model.isCorrection ? (
        <p className="mb-2 text-xs font-medium">
          Исправление{model.correctsReportNumber ? ` к ${model.correctsReportNumber}` : ''}:{' '}
          {model.correctionReason}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        {model.electronicSignatures.map((sig) => (
          <div key={`${sig.role}-${sig.name}`} className="border-t border-slate-400 pt-1">
            Эл. подпись {sig.role}: {sig.name || '—'}
            {sig.at ? ` · ${sig.at}` : ''}
          </div>
        ))}
        {model.manualSignatureSlots.map((slot) => (
          <div key={slot} className="border-t border-dashed border-slate-400 pt-6">
            {slot} ________________
          </div>
        ))}
      </div>
    </div>
  )
}

type QcProps = {
  model: QcDecisionPrintModel
}

export function QcDecisionPrintSheet({ model }: QcProps) {
  return (
    <div className="print-sheet text-sm text-slate-900">
      {model.banner ? (
        <div className="mb-2 border border-slate-800 px-2 py-1 text-center text-xs font-semibold">
          {model.banner}
        </div>
      ) : null}
      <h1 className="mb-2 text-base font-semibold">Решение ОТК · партия {model.batchNo}</h1>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
        <div>Lot ID: {model.lotId}</div>
        <div>Статус: {model.qcStatus}</div>
        <div>Product: {model.finishedProductId}</div>
        <div>Item: {model.warehouseItemId}</div>
        <div>Произведено: {model.quantityProduced} м²</div>
        <div>Допущено: {model.quantityQcReleased} м²</div>
        <div>Отгружено: {model.quantityShipped} м²</div>
        <div>Остаток: {model.quantityRemaining} м²</div>
      </div>
      <p className="mb-2 text-xs">
        Паспорт: {model.passportRef ?? '—'} · Протокол: {model.protocolRef ?? '—'}
      </p>
      {model.regradeReason ? (
        <p className="mb-2 text-xs">Переквалификация: {model.regradeReason}</p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        {model.electronicSignatures.map((sig) => (
          <div key={`${sig.role}-${sig.name}`} className="border-t border-slate-400 pt-1">
            Эл. подпись {sig.role}: {sig.name}
            {sig.at ? ` · ${sig.at}` : ''}
          </div>
        ))}
        {model.manualSignatureSlots.map((slot) => (
          <div key={slot} className="border-t border-dashed border-slate-400 pt-6">
            {slot} ________________
          </div>
        ))}
      </div>
    </div>
  )
}

import { createHash } from 'node:crypto'

/**
 * Pure helpers for authoritative G3 shift stock checks.
 *
 * A material request is identified by the complete stock-lineage tuple.  In
 * particular, two request rows for the same lot must be added together before
 * either is compared with the available balance.
 */

function text(value) {
  return String(value ?? '').trim()
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function sortedRows(rows) {
  return rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

export function canonicalShiftBusinessKey(command) {
  return [
    'production-shift',
    text(command?.orderId),
    text(command?.lineId),
    text(command?.shiftDate).slice(0, 10),
    text(command?.shiftSlot) || 'day',
  ].join(':')
}

/** Full semantic fingerprint; transport/report keys are deliberately excluded. */
export function shiftCommandFingerprint(command) {
  const canonical = {
    originalReportId: text(command?.originalReportId),
    correctionReason: text(command?.correctionReason ?? command?.reason),
    emergencyReason: text(command?.emergencyReason),
    orderId: text(command?.orderId),
    lineId: text(command?.lineId),
    shiftDate: text(command?.shiftDate).slice(0, 10),
    shiftSlot: text(command?.shiftSlot) || 'day',
    outputMp: finiteNumber(command?.outputMp),
    outputRolls: finiteNumber(command?.outputRolls) ?? 0,
    semiFinishedItemId: text(command?.semiFinishedItemId),
    packLocationId: text(command?.packLocationId),
    impregnationQcDecisionId: text(command?.impregnationQcDecisionId),
    batchRunId: text(command?.batchRunId),
    actualInputs: sortedRows(
      (Array.isArray(command?.actualInputs) ? command.actualInputs : []).map((row) => ({
        ...shiftStockTuple(row),
        quantity: finiteNumber(row?.quantity),
        deviationReason: text(row?.deviationReason),
      })),
    ),
    wasteLines: sortedRows(
      (Array.isArray(command?.wasteLines) ? command.wasteLines : []).map((row) => ({
        ...shiftStockTuple(row),
        quantity: finiteNumber(row?.quantity),
        reason: text(row?.reason ?? row?.reasonCode),
        unit: text(row?.unit),
      })),
    ),
  }
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex')
}

export function shiftStockTuple(row) {
  return {
    itemId: text(row?.itemId),
    batchNo: text(row?.batchNo),
    expiryDate: text(row?.expiryDate),
    batchRunId: text(row?.batchRunId),
  }
}

export function shiftStockLineage(row) {
  const tuple = shiftStockTuple(row)
  return {
    batchNo: tuple.batchNo || undefined,
    expiryDate: tuple.expiryDate || undefined,
    batchRunId: tuple.batchRunId || undefined,
  }
}

export function shiftStockTupleKey(row) {
  const tuple = shiftStockTuple(row)
  return JSON.stringify([
    tuple.itemId,
    tuple.batchNo,
    tuple.expiryDate,
    tuple.batchRunId,
  ])
}

export function aggregateShiftActualInputs(actuals) {
  const byTuple = new Map()
  for (const row of Array.isArray(actuals) ? actuals : []) {
    const tuple = shiftStockTuple(row)
    const key = shiftStockTupleKey(tuple)
    const quantity = Number(row?.quantity)
    const current = byTuple.get(key)
    if (current) current.quantity += quantity
    else byTuple.set(key, { ...tuple, quantity })
  }
  return [...byTuple.values()]
}

export function shiftLineStockBalance(movements, request, route) {
  const tuple = shiftStockTuple(request)
  let balance = 0
  for (const movement of Array.isArray(movements) ? movements : []) {
    if (text(movement?.itemId) !== tuple.itemId) continue
    if (
      route?.exactLineage === true
        ? text(movement?.batchNo) !== tuple.batchNo
        : tuple.batchNo && text(movement?.batchNo) !== tuple.batchNo
    ) continue
    if (
      route?.exactLineage === true
        ? text(movement?.expiryDate) !== tuple.expiryDate
        : tuple.expiryDate && text(movement?.expiryDate) !== tuple.expiryDate
    ) continue
    if (
      route?.exactLineage === true
        ? text(movement?.batchRunId) !== tuple.batchRunId
        : tuple.batchRunId && text(movement?.batchRunId) !== tuple.batchRunId
    ) continue
    if (text(movement?.warehouseId) !== text(route?.productionWarehouseId)) continue
    if (text(movement?.locationId) !== text(route?.productionLocationId)) continue
    if (text(movement?.productionOrderId) !== text(route?.productionOrderId)) continue
    if (
      route?.requireProductionLineId === true &&
      text(movement?.productionLineId) !== text(route?.productionLineId)
    ) {
      continue
    }
    const rawQuantity = Number(movement?.quantity)
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return Number.NaN
    const quantity = rawQuantity
    if (movement.type === 'receipt' || movement.type === 'in') balance += quantity
    if (movement.type === 'issue' || movement.type === 'out') balance -= quantity
  }
  return balance
}

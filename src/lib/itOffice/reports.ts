import type { Employee } from '@/lib/types'
import type { ItAsset, ItOfficeStore } from './types'
import { IT_PRINTER_KINDS } from './types'
import { listLowStockConsumables } from './consumables'
import { listMaintenanceOverdue, listMaintenanceDue } from './maintenance'

export function assetsByEmployee(store: ItOfficeStore): Map<string, ItAsset[]> {
  const map = new Map<string, ItAsset[]>()
  for (const a of store.assets.filter((x) => x.status === 'issued' && x.currentEmployeeId)) {
    const list = map.get(a.currentEmployeeId!) ?? []
    list.push(a)
    map.set(a.currentEmployeeId!, list)
  }
  return map
}

export function assetsInStock(store: ItOfficeStore): ItAsset[] {
  return store.assets.filter((a) => a.status === 'stock')
}

export function printerAssets(store: ItOfficeStore): ItAsset[] {
  return store.assets.filter(
    (a) => IT_PRINTER_KINDS.includes(a.kind) && a.status !== 'written_off',
  )
}

export function employeeNameMap(employees: Employee[]): Map<string, string> {
  return new Map(employees.map((e) => [e.id, e.fullName]))
}

export type ItOfficeReportSummary = {
  totalAssets: number
  inStock: number
  issued: number
  inRepair: number
  writtenOff: number
  printers: number
  actsPosted: number
  actsDraft: number
  lowStockCount: number
  maintenanceDue: number
  maintenanceOverdue: number
}

export function itOfficeReportSummary(store: ItOfficeStore): ItOfficeReportSummary {
  return {
    totalAssets: store.assets.length,
    inStock: store.assets.filter((a) => a.status === 'stock').length,
    issued: store.assets.filter((a) => a.status === 'issued').length,
    inRepair: store.assets.filter((a) => a.status === 'repair').length,
    writtenOff: store.assets.filter((a) => a.status === 'written_off').length,
    printers: printerAssets(store).length,
    actsPosted: store.acts.filter((a) => a.status === 'posted').length,
    actsDraft: store.acts.filter((a) => a.status === 'draft').length,
    lowStockCount: listLowStockConsumables(store).length,
    maintenanceDue: listMaintenanceDue(store).length,
    maintenanceOverdue: listMaintenanceOverdue(store).length,
  }
}

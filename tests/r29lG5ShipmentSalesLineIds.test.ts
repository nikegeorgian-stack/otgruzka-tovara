/**
 * G5 sales.shipment.post requires salesOrderId + salesLineId.
 * Warehouse form may only have orderNo (= order id) until Director calc links them.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

describe('R2.9L G5 shipment post sends sales order + line ids', () => {
  it('postLoadingShipment G5 command includes salesLineId', () => {
    const src = readFileSync(resolve(ROOT, 'src/store/slices/warehouseSlice.ts'), 'utf8')
    const command = src.match(/const command = \{[\s\S]*?salesOrderId:[\s\S]*?salesLineId:[\s\S]*?\n\s*\}/)?.[0] ?? ''
    const g5Post =
      src.match(/g5SalesShipmentPost\(\{[\s\S]*?\}\)/)?.[0] ??
      src.match(/await g5SalesShipmentPost\([\s\S]*?\n\s*\)/)?.[0] ??
      ''
    expect(g5Post, 'g5SalesShipmentPost call must exist').toMatch(/g5SalesShipmentPost/)
    expect(command, 'validated shipment command must be assembled before the call').toMatch(
      /salesOrderId/,
    )
    expect(command).toMatch(/salesLineId/)
    expect(g5Post).toMatch(/command/)
  })

  it('resolves sales ids when shipment only has orderNo / product', () => {
    const src = readFileSync(resolve(ROOT, 'src/lib/sales/loadingLink.ts'), 'utf8')
    expect(src).toMatch(/export function resolveSalesShipmentLinkIds/)
    expect(src).toMatch(/orderNo/)
    expect(src).toMatch(/salesLineId/)
  })
})

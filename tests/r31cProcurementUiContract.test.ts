import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('R3.1C visible authoritative procurement workflow', () => {
  it('keeps free-text supplier/item creation out of the authoritative order path', () => {
    const modal = readFileSync(
      new URL('../src/components/procurement/PurchaseOrderModal.tsx', import.meta.url),
      'utf8',
    )

    expect(modal).toContain("!authoritativeMode ? (")
    expect(modal).toContain("setSupplierMode('new')")
    expect(modal).toContain('readOnly={authoritativeMode}')
    expect(modal).toContain('await onSave(')
    expect(modal.indexOf('await onSave(')).toBeLessThan(modal.indexOf('setSaving(false)'))
  })

  it('submits the receipt modal selection once and has no MRP first-line shortcut', () => {
    const receiptModal = readFileSync(
      new URL('../src/components/procurement/ReceivePurchaseOrderModal.tsx', import.meta.url),
      'utf8',
    )
    const mrp = readFileSync(
      new URL('../src/components/planner/G5MrpWorkspace.tsx', import.meta.url),
      'utf8',
    )

    expect(receiptModal).toContain('for (const { line, remaining } of remainingLines)')
    expect(receiptModal).toContain('const res = await onConfirm({ date, lineQtys })')
    expect(receiptModal.match(/await onConfirm\(/g)).toHaveLength(1)
    expect(mrp).not.toContain('handlePoPartialReceipt')
    expect(mrp).not.toContain('g5ProcurementReceiptPost')
  })
})

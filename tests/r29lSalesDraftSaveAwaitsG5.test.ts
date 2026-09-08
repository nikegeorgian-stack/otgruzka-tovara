/**
 * Director sales save must await authoritative G5 ack before closing.
 * Soft-only success (void upsert + immediate close) is forbidden.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

describe('R2.9L sales draft.save awaits G5 ack', () => {
  it('DirectorPage does not soft-close before upsert settles', () => {
    const src = readFileSync(resolve(ROOT, 'src/pages/DirectorPage.tsx'), 'utf8')
    const saveBlock = src.match(/onSave=\{\(o\)\s*=>\s*\{[\s\S]*?\}\}/)?.[0]
      ?? src.match(/onSave=\{async\s*\(o\)\s*=>\s*\{[\s\S]*?\}\}/)?.[0]
      ?? ''
    expect(saveBlock, 'SalesOrderModal onSave handler must exist').toMatch(/onUpsertSalesOrder/)
    expect(saveBlock).not.toMatch(/void\s+onUpsertSalesOrder/)
    expect(saveBlock).toMatch(/await\s+onUpsertSalesOrder/)
    expect(saveBlock.indexOf('await onUpsertSalesOrder')).toBeLessThan(
      saveBlock.indexOf('setEditing(null)'),
    )
  })

  it('SalesOrderModal keeps dirty/error when onSave rejects', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/director/SalesOrderModal.tsx'), 'utf8')
    expect(src).toMatch(/async function handleSave|async function handleSave\(/)
    expect(src).toMatch(/await\s+onSave\(/)
    expect(src).toMatch(/setError\(/)
    expect(src).toMatch(/setDirty\(true\)/)
  })
})

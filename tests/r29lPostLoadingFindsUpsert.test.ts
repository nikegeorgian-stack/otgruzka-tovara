/**
 * R2.9L: Провести after Сохранить/upsert must see the draft in getStore().
 * storeRef must update inside setStore (not only on next React render),
 * otherwise G5 post returns warehouse.loading.errNotFound.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '..')

describe('R2.9L postLoadingShipment sees upsert via sync getStore', () => {
  it('useAppStore setStore eagerly writes storeRef.current', () => {
    const src = readFileSync(resolve(ROOT, 'src/hooks/useAppStore.ts'), 'utf8')
    expect(src).toMatch(/storeRef\.current\s*=\s*next/)
    const setStoreBlock = src.match(/const setStore = useCallback<SetStore>\([\s\S]*?\}, \[\]\)/)?.[0] ?? ''
    expect(setStoreBlock, 'setStore must assign storeRef inside updater').toMatch(
      /storeRef\.current\s*=\s*next/,
    )
  })

  it('postLoadingShipment re-reads getStore after G5 activation import', () => {
    const src = readFileSync(resolve(ROOT, 'src/store/slices/warehouseSlice.ts'), 'utf8')
    const g5Block =
      src.match(
        /async postLoadingShipment\([\s\S]*?isG5SalesPlanningActive\(storeNow\)[\s\S]*?isG5WebPath\(\)/,
      )?.[0] ?? ''
    expect(g5Block).toMatch(/await import\(['"]@\/lib\/planner\/g5Activation['"]\)/)
    expect(g5Block).toMatch(/const storeNow = getStore\(\)/)
    const importIdx = g5Block.indexOf("await import('@/lib/planner/g5Activation')")
    const getIdx = g5Block.lastIndexOf('const storeNow = getStore()')
    expect(importIdx).toBeGreaterThanOrEqual(0)
    expect(getIdx).toBeGreaterThan(importIdx)
  })
})

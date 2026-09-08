import { describe, expect, it } from 'vitest'
import { resolveWarehouseLocationsForPicker } from '@/lib/warehouse/resolveWarehouseLocationsForPicker'
import type { WarehouseStore } from '@/lib/warehouse/types'

describe('R29L resolveWarehouseLocationsForPicker', () => {
  it('returns catalogue locations when present', () => {
    const locs = resolveWarehouseLocationsForPicker({
      locations: [
        { id: 'b', name: 'B', sortOrder: 2 },
        { id: 'a', name: 'A', sortOrder: 1 },
      ],
      documents: [],
      movements: [],
      accountingByWarehouse: [],
    })
    expect(locs.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('recovers location ids from documents when locations empty', () => {
    const locs = resolveWarehouseLocationsForPicker({
      locations: [],
      documents: [
        {
          id: 'd1',
          warehouseId: '1bc8f872-ded1-4ee9-8ed8-f70d3c54027c',
        } as WarehouseStore['documents'][number],
      ],
      movements: [],
      accountingByWarehouse: [],
      items: [],
    })
    expect(locs).toHaveLength(1)
    expect(locs[0].id).toBe('1bc8f872-ded1-4ee9-8ed8-f70d3c54027c')
  })
})

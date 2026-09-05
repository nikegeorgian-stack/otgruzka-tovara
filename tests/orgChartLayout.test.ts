import { describe, expect, it } from 'vitest'
import { buildFiberCellOrgChartSeed } from '@/lib/orgChart/seed'
import {
  autoLayoutOrgChart,
  ORG_CHART_MAX_BAND_W,
  ORG_CHART_NODE_W,
  orgChartCanvasSize,
} from '@/lib/orgChart/layout'

describe('orgChart compact layout', () => {
  it('keeps FiberCell seed within print-friendly width', () => {
    const laid = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const size = orgChartCanvasSize(laid)
    expect(size.width).toBeLessThanOrEqual(ORG_CHART_MAX_BAND_W + ORG_CHART_NODE_W)
    expect(size.width).toBeLessThan(1400)
    expect(size.height).toBeGreaterThan(400)
  })

  it('does not overlap sibling boxes on the same row', () => {
    const laid = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const byParent = new Map<string, typeof laid>()
    for (const node of laid) {
      const key = node.parentId ?? '__root__'
      const list = byParent.get(key) ?? []
      list.push(node)
      byParent.set(key, list)
    }
    for (const siblings of byParent.values()) {
      for (let i = 0; i < siblings.length; i++) {
        for (let j = i + 1; j < siblings.length; j++) {
          const a = siblings[i]!
          const b = siblings[j]!
          if (Math.abs(a.layoutY - b.layoutY) >= 1) continue
          const gap = Math.abs(a.layoutX - b.layoutX)
          expect(gap).toBeGreaterThanOrEqual(ORG_CHART_NODE_W)
        }
      }
    }
  })
})

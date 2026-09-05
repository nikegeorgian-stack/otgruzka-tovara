import { describe, expect, it } from 'vitest'
import { formatOrgShortLabel, orgNodeLabelParts } from '@/lib/orgChart/display'
import {
  orgChartReportsToChain,
  orgChartWouldCycle,
} from '@/lib/orgChart/hierarchy'
import { buildFiberCellOrgChartSeed } from '@/lib/orgChart/seed'
import { orgChartToneForNode } from '@/lib/orgChart/visual'
import type { OrgChartNode } from '@/lib/orgChart/types'

describe('orgChart display', () => {
  it('wraps short label in guillemets', () => {
    expect(formatOrgShortLabel('ГД')).toBe('«ГД»')
  })

  it('both mode shows abbrev + full', () => {
    const parts = orgNodeLabelParts('Генеральный директор', 'ГД', 'both')
    expect(parts.primary).toBe('«ГД»')
    expect(parts.secondary).toBe('Генеральный директор')
    expect(parts.isAbbrev).toBe(true)
  })

  it('branch tones differ for OD vs KD', () => {
    const nodes = buildFiberCellOrgChartSeed()
    const od = orgChartToneForNode(nodes, 'odp')
    const kd = orgChartToneForNode(nodes, 'kd-sales')
    expect(od.accent).not.toBe(kd.accent)
    expect(od.bg).toMatch(/^#/)
  })
})

describe('orgChart hierarchy', () => {
  const nodes: OrgChartNode[] = buildFiberCellOrgChartSeed()

  it('builds reports-to chain to root', () => {
    const chain = orgChartReportsToChain(nodes, 'odpp1')
    expect(chain[0]?.nameShort).toBe('ОДП1')
    expect(chain.some((n) => n.nameShort === 'ГД')).toBe(true)
  })

  it('detects reparent cycles', () => {
    expect(orgChartWouldCycle(nodes, 'gd', 'odpp1')).toBe(true)
    expect(orgChartWouldCycle(nodes, 'odpp1', 'gi')).toBe(false)
  })
})

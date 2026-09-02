import { describe, expect, it } from 'vitest'
import {
  applyOrgChartRemove,
  autoLayoutOrgChartBranch,
  setOrgChartEmployee,
} from '@/lib/orgChart/ops'
import { buildFiberCellOrgChartSeed } from '@/lib/orgChart/seed'
import { orgChartHiddenByCollapse, orgChartCountDescendants } from '@/lib/orgChart/subtree'
import {
  validateOrgChartDraft,
  validateOrgChartReparent,
  validateOrgChartRemove,
} from '@/lib/orgChart/validate'
import { searchOrgChartNodes } from '@/lib/orgChart/search'
import { autoLayoutOrgChart } from '@/lib/orgChart/layout'

describe('orgChart validate', () => {
  const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())

  it('blocks self as parent', () => {
    expect(validateOrgChartReparent(nodes, 'od', 'od').ok).toBe(false)
  })

  it('blocks descendant as parent', () => {
    expect(validateOrgChartReparent(nodes, 'od', 'odpp1').ok).toBe(false)
  })

  it('allows valid reparent', () => {
    expect(validateOrgChartReparent(nodes, 'odpp1', 'gi').ok).toBe(true)
  })

  it('requires names', () => {
    expect(
      validateOrgChartDraft(nodes, { nameFull: '', nameShort: 'X', parentId: 'gd' }).ok,
    ).toBe(false)
    expect(
      validateOrgChartDraft(nodes, { nameFull: 'Test', nameShort: '', parentId: 'gd' }).ok,
    ).toBe(false)
  })

  it('blocks second root', () => {
    expect(
      validateOrgChartDraft(nodes, { nameFull: 'Extra', nameShort: 'EX' }).ok,
    ).toBe(false)
  })
})

describe('orgChart remove', () => {
  it('reparents children when removing middle node', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const beforeKids = nodes.filter((n) => n.parentId === 'odp').length
    expect(beforeKids).toBeGreaterThan(0)
    const result = applyOrgChartRemove(nodes, 'odp', 'node')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.nodes.find((n) => n.id === 'odp')).toBeUndefined()
    const reparented = result.nodes.filter((n) => result.reparentedIds.includes(n.id))
    expect(reparented.every((n) => n.parentId === 'od')).toBe(true)
  })

  it('subtree remove counts descendants', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const count = orgChartCountDescendants(nodes, 'od') + 1
    const result = applyOrgChartRemove(nodes, 'od', 'subtree')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.removedIds.length).toBe(count)
  })

  it('blocks removing root with children via node mode', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    expect(validateOrgChartRemove(nodes, 'gd', 'node').ok).toBe(false)
  })
})

describe('orgChart collapse / employee', () => {
  it('collapse hides descendants without mutating nodes', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const snapshot = JSON.stringify(nodes)
    const hidden = orgChartHiddenByCollapse(nodes, new Set(['od']))
    expect(hidden.has('odp')).toBe(true)
    expect(hidden.has('od')).toBe(false)
    expect(JSON.stringify(nodes)).toBe(snapshot)
  })

  it('assign employee only changes employeeId', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const next = setOrgChartEmployee(nodes, 'od', 'emp-1')
    const od = next.find((n) => n.id === 'od')!
    expect(od.employeeId).toBe('emp-1')
    expect(od.nameFull).toBe(nodes.find((n) => n.id === 'od')!.nameFull)
  })

  it('branch layout keeps other branches', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const kdBefore = nodes.find((n) => n.id === 'kd')!
    const next = autoLayoutOrgChartBranch(nodes, 'od')
    const kdAfter = next.find((n) => n.id === 'kd')!
    expect(kdAfter.layoutX).toBe(kdBefore.layoutX)
    expect(kdAfter.layoutY).toBe(kdBefore.layoutY)
  })
})

describe('orgChart search', () => {
  it('finds by short name', () => {
    const nodes = autoLayoutOrgChart(buildFiberCellOrgChartSeed())
    const hits = searchOrgChartNodes(nodes, 'одп', {
      employeeNameById: new Map(),
      unitNameById: new Map(),
      positionTitleById: new Map(),
    })
    expect(hits.some((h) => h.node.nameShort === 'ОДП')).toBe(true)
  })
})

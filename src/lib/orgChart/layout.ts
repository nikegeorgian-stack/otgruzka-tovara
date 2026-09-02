import type { OrgChartNode } from './types'

/**
 * Компактные ячейки + перенос рядов под ширину печатного листа.
 * Цель: A4 альбом (~1040px полезной ширины @96dpi) без микроскопического текста.
 */
const NODE_W = 98
const NODE_H = 40
const GAP_X = 8
const GAP_Y = 36
const ROW_GAP = 12
const PAD = 16
/** Макс. ширина одного «этажа» детей (A4 landscape content). */
const MAX_BAND_W = 1040

type Size = { w: number; h: number }

function childrenOf(nodes: OrgChartNode[], parentId?: string): OrgChartNode[] {
  return nodes
    .filter((n) => (n.parentId ?? undefined) === (parentId ?? undefined))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.nameFull.localeCompare(b.nameFull, 'ru'))
}

function setPos(nodes: OrgChartNode[], id: string, x: number, y: number): OrgChartNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, layoutX: x, layoutY: y } : n))
}

/** Упаковка блоков в ряды с лимитом ширины. */
function packRows(sizes: Size[], maxW: number): { items: Size[]; w: number; h: number }[] {
  const rows: { items: Size[]; w: number; h: number }[] = []
  let cur: Size[] = []
  let curW = 0
  let curH = 0

  const flush = () => {
    if (!cur.length) return
    rows.push({ items: cur, w: curW, h: curH })
    cur = []
    curW = 0
    curH = 0
  }

  for (const size of sizes) {
    const need = size.w + (cur.length ? GAP_X : 0)
    if (cur.length && curW + need > maxW) flush()
    cur.push(size)
    curW += need
    curH = Math.max(curH, size.h)
  }
  flush()
  return rows
}

function subtreeSize(nodes: OrgChartNode[], id: string): Size {
  const kids = childrenOf(nodes, id)
  if (kids.length === 0) return { w: NODE_W, h: NODE_H }
  const childSizes = kids.map((k) => subtreeSize(nodes, k.id))
  const rows = packRows(childSizes, MAX_BAND_W)
  const rowsW = Math.max(...rows.map((r) => r.w), NODE_W)
  const rowsH =
    rows.reduce((sum, r) => sum + r.h, 0) + Math.max(0, rows.length - 1) * ROW_GAP
  return { w: Math.max(NODE_W, rowsW), h: NODE_H + GAP_Y + rowsH }
}

function placeSubtree(
  nodes: OrgChartNode[],
  id: string,
  left: number,
  top: number,
): OrgChartNode[] {
  const kids = childrenOf(nodes, id)
  const size = subtreeSize(nodes, id)
  const nodeX = left + size.w / 2 - NODE_W / 2
  let next = setPos(nodes, id, nodeX, top)
  if (kids.length === 0) return next

  const childMeta = kids.map((k) => ({ id: k.id, ...subtreeSize(nodes, k.id) }))
  const rows = packRows(
    childMeta.map((c) => ({ w: c.w, h: c.h })),
    MAX_BAND_W,
  )

  let y = top + NODE_H + GAP_Y
  let offset = 0
  for (const row of rows) {
    const rowItems = childMeta.slice(offset, offset + row.items.length)
    offset += row.items.length
    let x = left + (size.w - row.w) / 2
    for (const item of rowItems) {
      next = placeSubtree(next, item.id, x, y)
      x += item.w + GAP_X
    }
    y += row.h + ROW_GAP
  }
  return next
}

/** Авто-раскладка дерева сверху вниз (компактно, с переносом рядов). */
export function autoLayoutOrgChart(nodes: OrgChartNode[]): OrgChartNode[] {
  const active = nodes.filter((n) => !n.archived)
  const roots = childrenOf(active, undefined)
  if (roots.length === 0) return active

  const rootSizes = roots.map((r) => ({ id: r.id, ...subtreeSize(active, r.id) }))
  const rows = packRows(
    rootSizes.map((r) => ({ w: r.w, h: r.h })),
    MAX_BAND_W,
  )

  let laid = active
  let y = PAD
  let offset = 0
  for (const row of rows) {
    const rowItems = rootSizes.slice(offset, offset + row.items.length)
    offset += row.items.length
    let x = PAD
    for (const item of rowItems) {
      laid = placeSubtree(laid, item.id, x, y)
      x += item.w + GAP_X * 2
    }
    y += row.h + GAP_Y
  }
  return laid
}

/**
 * Раскладка только для печати (не пишет в store).
 * Та же компактная упаковка — лист читаемый без сильного scale-down.
 */
export function layoutOrgChartForPrint(nodes: OrgChartNode[]): OrgChartNode[] {
  return autoLayoutOrgChart(nodes.map((n) => ({ ...n })))
}

export function orgChartCanvasSize(nodes: OrgChartNode[]): { width: number; height: number } {
  let maxX = 640
  let maxY = 420
  for (const n of nodes) {
    maxX = Math.max(maxX, n.layoutX + NODE_W + PAD)
    maxY = Math.max(maxY, n.layoutY + NODE_H + PAD)
  }
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) }
}

export const ORG_CHART_NODE_W = NODE_W
export const ORG_CHART_NODE_H = NODE_H
/** Полезная ширина полосы раскладки (для тестов / печати). */
export const ORG_CHART_MAX_BAND_W = MAX_BAND_W

export function edgePath(from: OrgChartNode, to: OrgChartNode): string {
  const x1 = from.layoutX + NODE_W / 2
  const y1 = from.layoutY + NODE_H
  const x2 = to.layoutX + NODE_W / 2
  const y2 = to.layoutY
  const midY = y1 + Math.max(8, (y2 - y1) * 0.4)
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`
}

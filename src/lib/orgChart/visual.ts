import type { OrgChartNode } from './types'

/** Палитра ветки оргсхемы (экран + печать, hex — дружит с html2canvas). */
export type OrgChartTone = {
  bg: string
  border: string
  accent: string
  text: string
  muted: string
  edge: string
}

const DEFAULT_TONE: OrgChartTone = {
  bg: '#F5F6F7',
  border: '#B0B7BA',
  accent: '#4A5154',
  text: '#191B1C',
  muted: '#626C70',
  edge: '#959FA3',
}

/** Цвета по корневой ветке (id из seed FiberCell). */
const BRANCH_TONES: Record<string, OrgChartTone> = {
  gd: {
    bg: '#F0F6FF',
    border: '#9FBFF0',
    accent: '#005CE8',
    text: '#0B1F4D',
    muted: '#4A6FA5',
    edge: '#6E9FE8',
  },
  'gd-strat': {
    bg: '#F5F3FF',
    border: '#C4B5FD',
    accent: '#7C3AED',
    text: '#2E1065',
    muted: '#6D28D9',
    edge: '#A78BFA',
  },
  'gd-security': {
    bg: '#FFF1F2',
    border: '#FDA4AF',
    accent: '#E11D48',
    text: '#4C0519',
    muted: '#9F1239',
    edge: '#FB7185',
  },
  od: {
    bg: '#ECFDF5',
    border: '#6EE7B7',
    accent: '#059669',
    text: '#064E3B',
    muted: '#047857',
    edge: '#34D399',
  },
  odp: {
    bg: '#F0FDFA',
    border: '#5EEAD4',
    accent: '#0D9488',
    text: '#134E4A',
    muted: '#0F766E',
    edge: '#2DD4BF',
  },
  gi: {
    bg: '#EFF6FF',
    border: '#93C5FD',
    accent: '#2563EB',
    text: '#1E3A8A',
    muted: '#1D4ED8',
    edge: '#60A5FA',
  },
  gt: {
    bg: '#EEF2FF',
    border: '#A5B4FC',
    accent: '#4F46E5',
    text: '#312E81',
    muted: '#4338CA',
    edge: '#818CF8',
  },
  omts: {
    bg: '#F0FDF4',
    border: '#86EFAC',
    accent: '#16A34A',
    text: '#14532D',
    muted: '#15803D',
    edge: '#4ADE80',
  },
  kd: {
    bg: '#FFF7ED',
    border: '#FDBA74',
    accent: '#EA580C',
    text: '#7C2D12',
    muted: '#C2410C',
    edge: '#FB923C',
  },
  fd: {
    bg: '#ECFEFF',
    border: '#67E8F9',
    accent: '#0891B2',
    text: '#164E63',
    muted: '#0E7490',
    edge: '#22D3EE',
  },
  hr: {
    bg: '#FDF2F8',
    border: '#F9A8D4',
    accent: '#DB2777',
    text: '#831843',
    muted: '#BE185D',
    edge: '#F472B6',
  },
  otk: {
    bg: '#FEFCE8',
    border: '#FDE047',
    accent: '#CA8A04',
    text: '#713F12',
    muted: '#A16207',
    edge: '#FACC15',
  },
  legal: {
    bg: '#F8FAFC',
    border: '#CBD5E1',
    accent: '#475569',
    text: '#0F172A',
    muted: '#475569',
    edge: '#94A3B8',
  },
  safety: {
    bg: '#F7FEE7',
    border: '#BEF264',
    accent: '#65A30D',
    text: '#365314',
    muted: '#4D7C0F',
    edge: '#A3E635',
  },
  secretariat: {
    bg: '#FFF1F2',
    border: '#FECDD3',
    accent: '#E11D48',
    text: '#881337',
    muted: '#BE123C',
    edge: '#FB7185',
  },
  it: {
    bg: '#F5F3FF',
    border: '#DDD6FE',
    accent: '#7C3AED',
    text: '#4C1D95',
    muted: '#6D28D9',
    edge: '#A78BFA',
  },
  dev: {
    bg: '#FAF5FF',
    border: '#E9D5FF',
    accent: '#9333EA',
    text: '#581C87',
    muted: '#7E22CE',
    edge: '#C084FC',
  },
}

const BRANCH_ROOT_IDS = new Set(Object.keys(BRANCH_TONES))

/** Ближайший «корневой» id ветки вверх по дереву (иначе gd / default). */
export function orgChartBranchRootId(nodes: OrgChartNode[], nodeId: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  let cur = byId.get(nodeId)
  const seen = new Set<string>()
  let last = nodeId
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    last = cur.id
    if (BRANCH_ROOT_IDS.has(cur.id) && cur.id !== 'gd') return cur.id
    if (!cur.parentId) break
    cur = byId.get(cur.parentId)
  }
  if (BRANCH_ROOT_IDS.has(last)) return last
  return 'gd'
}

export function orgChartToneForNode(nodes: OrgChartNode[], nodeId: string): OrgChartTone {
  const root = orgChartBranchRootId(nodes, nodeId)
  return BRANCH_TONES[root] ?? DEFAULT_TONE
}

export function orgChartToneForId(branchId: string): OrgChartTone {
  return BRANCH_TONES[branchId] ?? DEFAULT_TONE
}

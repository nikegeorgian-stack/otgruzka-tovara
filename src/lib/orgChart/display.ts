import type { OrgChartDisplayMode } from './types'

/** Маркер сокращения — угловые кавычки « » как на бланке. */
export function formatOrgShortLabel(short: string): string {
  const s = short.trim()
  if (!s) return '—'
  if (s.startsWith('«') && s.endsWith('»')) return s
  return `«${s}»`
}

export type OrgNodeLabelParts = {
  primary: string
  secondary?: string
  isAbbrev: boolean
}

export function orgNodeLabelParts(
  nameFull: string,
  nameShort: string,
  mode: OrgChartDisplayMode,
): OrgNodeLabelParts {
  const short = formatOrgShortLabel(nameShort)
  if (mode === 'full') {
    return { primary: nameFull, isAbbrev: false }
  }
  if (mode === 'short') {
    return { primary: short, isAbbrev: true }
  }
  return { primary: short, secondary: nameFull, isAbbrev: true }
}

/** Одна строка для списка / боковой панели. */
export function orgNodeDisplayLabel(
  nameFull: string,
  nameShort: string,
  mode: OrgChartDisplayMode,
): string {
  const parts = orgNodeLabelParts(nameFull, nameShort, mode)
  if (parts.secondary) return `${parts.primary} — ${parts.secondary}`
  return parts.primary
}

import type { FormulationColorVariant } from './types'

const MAP: Record<FormulationColorVariant, string> = {
  white: '#f8fafc',
  yellow: '#eab308',
  orange: '#ea580c',
  red: '#dc2626',
  blue: '#2563eb',
  green: '#16a34a',
  black: '#1c1917',
  grey: '#9ca3af',
  other: '#a8a29e',
}

export function colorVariantToProductColor(
  variant: FormulationColorVariant | undefined,
): string | undefined {
  if (!variant) return undefined
  return MAP[variant]
}

/** Относительная яркость hex-цвета (0..1) для выбора контрастного текста. */
function hexLuminance(hex: string): number {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export type ProductColorSwatch = {
  fill: string
  /** Контрастный цвет текста поверх заливки. */
  text: string
  /** Рамка — нужна для очень светлых заливок, чтобы плашка читалась. */
  border: string
}

export function productColorSwatch(
  variant: FormulationColorVariant | undefined,
): ProductColorSwatch | undefined {
  const fill = colorVariantToProductColor(variant)
  if (!fill) return undefined
  const lum = hexLuminance(fill)
  const text = lum > 0.55 ? '#1c1917' : '#ffffff'
  const border = lum > 0.8 ? '#d6d3d1' : 'transparent'
  return { fill, text, border }
}

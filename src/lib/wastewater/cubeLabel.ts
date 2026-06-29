import type { WastewaterCube } from './types'

export type WastewaterLabelFieldOpts = {
  includeQr: boolean
  includeNumber: boolean
  includeInternalCode: boolean
  includeWasteType: boolean
  includeColor: boolean
  includeStatus: boolean
  includeLocation: boolean
  includeMass: boolean
  includeFillDates: boolean
}

export const DEFAULT_WW_LABEL_FIELDS: WastewaterLabelFieldOpts = {
  includeQr: true,
  includeNumber: true,
  includeInternalCode: true,
  includeWasteType: true,
  includeColor: true,
  includeStatus: true,
  includeLocation: true,
  includeMass: false,
  includeFillDates: false,
}

export type WastewaterCubeLabelModel = {
  cube: WastewaterCube
  site?: string
  statusLabel: string
  qrDataUrl?: string
  fields: WastewaterLabelFieldOpts
}

export function buildWastewaterQrPayload(cube: WastewaterCube, site?: string): string {
  return JSON.stringify({
    v: 1,
    t: 'ww',
    code: cube.internalCode,
    id: cube.id,
    n: cube.cubeNumber,
    waste: cube.wasteType || undefined,
    color: cube.color || undefined,
    ...(site ? { site } : {}),
  })
}

export async function buildWastewaterCubeLabelModel(
  cube: WastewaterCube,
  opts: WastewaterLabelFieldOpts,
  statusLabel: string,
  site?: string,
): Promise<WastewaterCubeLabelModel> {
  let qrDataUrl: string | undefined
  if (opts.includeQr && cube.internalCode) {
    const QRCode = (await import('qrcode')).default
    qrDataUrl = await QRCode.toDataURL(buildWastewaterQrPayload(cube, site), {
      margin: 1,
      width: 120,
      errorCorrectionLevel: 'M',
    })
  }
  return { cube, site, statusLabel, qrDataUrl, fields: opts }
}

export function formatWwDate(iso: string | undefined, locale: 'ru' | 'ka'): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  if (locale === 'ka') return `${d}.${m}.${y}`
  return `${d}.${m}.${y}`
}

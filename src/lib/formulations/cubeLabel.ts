import type { FormulationBatchRun } from './types'
import { formulationColorLabel } from './types'
import { productColorSwatch, type ProductColorSwatch } from './colorMap'

export type CubeLabelModel = {
  run: FormulationBatchRun
  productTitle: string
  colorLabel?: string
  colorSwatch?: ProductColorSwatch
  grammage?: number
  variantCode?: string
  labelText?: string
  site?: string
  warehouseName?: string
  qrDataUrl?: string
  /** Внутренний линейный штрихкод (Code128) для быстрого сканирования на линии */
  barcodeDataUrl?: string
  internalCode?: string
}

/** Линейный штрихкод Code128 из внутреннего кода (PM-NNNNNN) */
async function buildBarcodeDataUrl(code: string): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined
  try {
    const JsBarcode = (await import('jsbarcode')).default
    const canvas = document.createElement('canvas')
    JsBarcode(canvas, code, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      height: 48,
      width: 1.6,
    })
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

export async function buildCubeLabelModel(
  run: FormulationBatchRun,
  opts: {
    locale: 'ru' | 'ka'
    site?: string
    warehouseName?: string
    labelText?: string
    includeQr?: boolean
    includeBarcode?: boolean
  },
): Promise<CubeLabelModel> {
  const productTitle = [run.recipeCode, run.recipeName].filter(Boolean).join(' · ')
  const colorLabel = run.colorVariant
    ? formulationColorLabel(run.colorVariant, opts.locale)
    : undefined
  const colorSwatch = productColorSwatch(run.colorVariant)

  let qrDataUrl: string | undefined
  if (opts.includeQr !== false) {
    const QRCode = (await import('qrcode')).default
    qrDataUrl = await QRCode.toDataURL(
      JSON.stringify({
        v: 1,
        t: 'mix',
        doc: run.documentNumber,
        id: run.id,
        code: run.internalCode,
        recipe: run.recipeCode,
        vol: run.targetVolumeL,
        at: run.mixedAt,
      }),
      { margin: 1, width: 240 },
    )
  }

  let barcodeDataUrl: string | undefined
  if (opts.includeBarcode !== false && run.internalCode) {
    barcodeDataUrl = await buildBarcodeDataUrl(run.internalCode)
  }

  return {
    run,
    productTitle,
    colorLabel,
    colorSwatch,
    grammage: run.grammageGsm,
    variantCode: run.variantCode,
    labelText: opts.labelText,
    site: opts.site,
    warehouseName: opts.warehouseName,
    qrDataUrl,
    barcodeDataUrl,
    internalCode: run.internalCode,
  }
}

export function formatMixDate(iso: string, locale: 'ru' | 'ka'): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString(locale === 'ka' ? 'ka-GE' : 'ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

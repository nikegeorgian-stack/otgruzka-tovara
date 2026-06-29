import { parseInternalCodeNum } from './itemHistory'
import type { WarehouseItem } from './types'

export type LabelPrintOptions = {
  includeQr: boolean
  includeBarcode: boolean
  /** При отсутствии штрихкода — сгенерировать внутренний EAN-13 */
  generateBarcodeIfMissing: boolean
}

export type LabelModel = {
  item: WarehouseItem
  categoryName: string
  locationName: string
  site?: string
  qrDataUrl?: string
  barcodeValue?: string
  barcodeSvg?: string
  /** Сохранить в номенклатуру при печати */
  patch?: Partial<WarehouseItem>
}

export function buildQrPayload(item: WarehouseItem, site?: string): string {
  return JSON.stringify({
    v: 1,
    t: 'wh',
    code: item.internalCode,
    id: item.id,
    name: item.name,
    sku: item.sku ?? undefined,
    unit: item.unit,
    ...(site ? { site } : {}),
  })
}

function ean13CheckDigit(body12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const n = Number(body12[i])
    sum += i % 2 === 0 ? n : n * 3
  }
  return String((10 - (sum % 10)) % 10)
}

/** Внутренний штрихкод EAN-13 на базе кода FC-000123 */
export function suggestInternalBarcode(internalCode: string): string {
  const num = parseInternalCodeNum(internalCode)
  const body = `486000${String(num).padStart(6, '0')}`
  return body + ean13CheckDigit(body)
}

export async function barcodeToSvg(value: string): Promise<string> {
  const JsBarcode = (await import('jsbarcode')).default
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const format = value.length === 13 && /^\d+$/.test(value) ? 'EAN13' : 'CODE128'
  JsBarcode(svg, value, {
    format,
    width: 1.35,
    height: 34,
    margin: 0,
    fontSize: 8,
    displayValue: true,
    textMargin: 0,
  })
  return new XMLSerializer().serializeToString(svg)
}

export async function buildLabelModels(
  items: WarehouseItem[],
  categoryNames: Map<string, string>,
  locationNames: Map<string, string>,
  opts: LabelPrintOptions,
  site?: string,
): Promise<LabelModel[]> {
  const models: LabelModel[] = []

  for (const item of items) {
    let working = item
    let patch: Partial<WarehouseItem> | undefined

    if (opts.includeBarcode && opts.generateBarcodeIfMissing && !item.barcode?.trim()) {
      const barcode = suggestInternalBarcode(item.internalCode)
      working = { ...item, barcode }
      patch = { barcode }
    }

    const model: LabelModel = {
      item: working,
      categoryName: categoryNames.get(working.categoryId) ?? '',
      locationName: locationNames.get(working.warehouseId) ?? '',
      site,
      patch,
    }

    if (opts.includeQr && working.internalCode) {
      const QRCode = (await import('qrcode')).default
      model.qrDataUrl = await QRCode.toDataURL(buildQrPayload(working, site), {
        margin: 0,
        width: 120,
        errorCorrectionLevel: 'M',
      })
    }

    if (opts.includeBarcode) {
      const barcodeValue = working.barcode?.trim() || working.internalCode
      model.barcodeValue = barcodeValue
      model.barcodeSvg = await barcodeToSvg(barcodeValue)
    }

    models.push(model)
  }

  return models
}

export function expandLabelCopies(labels: LabelModel[], copies: number): LabelModel[] {
  const n = Math.max(1, Math.min(99, Math.floor(copies)))
  return labels.flatMap((label) => Array.from({ length: n }, () => label))
}

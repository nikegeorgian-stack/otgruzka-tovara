export type ProductColorPreset = {
  id: string
  hex: string
  labelRu: string
  labelKa: string
}

/** Типовые цвета готовой продукции */
export const PRODUCT_COLOR_PRESETS: ProductColorPreset[] = [
  { id: 'white', hex: '#f8fafc', labelRu: 'Белый', labelKa: 'თეთრი' },
  { id: 'blue', hex: '#2563eb', labelRu: 'Синий', labelKa: 'ლურჯი' },
  { id: 'orange', hex: '#ea580c', labelRu: 'Оранжевый', labelKa: 'ნარინჯისფერი' },
  { id: 'green', hex: '#16a34a', labelRu: 'Зелёный', labelKa: 'მწვანე' },
  { id: 'yellow', hex: '#eab308', labelRu: 'Жёлтый', labelKa: 'ყვითელი' },
  { id: 'red', hex: '#dc2626', labelRu: 'Красный', labelKa: 'წითელი' },
  { id: 'grey', hex: '#9ca3af', labelRu: 'Серый', labelKa: 'ნაცარი' },
  { id: 'black', hex: '#1c1917', labelRu: 'Чёрный', labelKa: 'შავი' },
  { id: 'brown', hex: '#92400e', labelRu: 'Коричневый', labelKa: 'ყავისფერი' },
]

const NAME_COLOR_RULES: { re: RegExp; hex: string }[] = [
  { re: /бел|white|თეთ/i, hex: '#f8fafc' },
  { re: /син|blue|ლურჯ/i, hex: '#2563eb' },
  { re: /оранж|orange|ნარინჯ/i, hex: '#ea580c' },
  { re: /зелен|green|მწვან/i, hex: '#16a34a' },
  { re: /желт|yellow|ყვით/i, hex: '#eab308' },
  { re: /красн|red|წით/i, hex: '#dc2626' },
  { re: /сер|grey|gray|ნაცარ/i, hex: '#9ca3af' },
  { re: /черн|black|შავ/i, hex: '#1c1917' },
  { re: /коричн|brown|ყავ/i, hex: '#92400e' },
]

export function isValidProductColor(hex: string | undefined): boolean {
  return !!hex && /^#[0-9a-fA-F]{6}$/.test(hex)
}

export function guessColorFromText(text: string | undefined): string | undefined {
  if (!text?.trim()) return undefined
  for (const rule of NAME_COLOR_RULES) {
    if (rule.re.test(text)) return rule.hex
  }
  return undefined
}

export function resolveProductColor(
  productColor: string | undefined,
  colorLogo: string | undefined,
): string | undefined {
  if (isValidProductColor(productColor)) return productColor
  return guessColorFromText(colorLogo)
}

export function productColorLabel(
  hex: string | undefined,
  locale: 'ru' | 'ka',
): string {
  if (!hex) return '—'
  const preset = PRODUCT_COLOR_PRESETS.find(
    (p) => p.hex.toLowerCase() === hex.toLowerCase(),
  )
  if (preset) return locale === 'ka' ? preset.labelKa : preset.labelRu
  return hex
}

/** Контрастная обводка для светлых цветов */
export function productColorBorder(hex: string): string {
  const light = ['#f8fafc', '#eab308', '#9ca3af']
  return light.includes(hex.toLowerCase()) ? '#d6d3d1' : hex
}

type ColorCarrier = {
  productColor?: string
  colorLogo?: string
  finishedProductId?: string
}

type ProductColorSource = {
  id: string
  productColor?: string
  colorLogo?: string
}

export function resolveOrderProductColor(
  order: ColorCarrier,
  products: ProductColorSource[],
): string | undefined {
  if (isValidProductColor(order.productColor)) return order.productColor
  const fp = products.find((p) => p.id === order.finishedProductId)
  return resolveProductColor(fp?.productColor, order.colorLogo ?? fp?.colorLogo)
}

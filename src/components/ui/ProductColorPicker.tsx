import { useI18n } from '@/context/I18nContext'
import {
  PRODUCT_COLOR_PRESETS,
  productColorBorder,
  resolveProductColor,
} from '@/lib/finishedProducts/colors'

type Props = {
  productColor?: string
  colorLogo?: string
  onColorChange: (hex: string | undefined) => void
  onLogoChange: (text: string) => void
}

export function ProductColorPicker({
  productColor,
  colorLogo,
  onColorChange,
  onLogoChange,
}: Props) {
  const { t, locale } = useI18n()
  const activeHex = resolveProductColor(productColor, colorLogo)

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-stone-500">{t('finishedProduct.productColor')}</p>
      <div className="flex flex-wrap gap-2">
        {PRODUCT_COLOR_PRESETS.map((preset) => {
          const selected = activeHex?.toLowerCase() === preset.hex.toLowerCase()
          return (
            <button
              key={preset.id}
              type="button"
              title={locale === 'ka' ? preset.labelKa : preset.labelRu}
              className={`h-8 w-8 rounded-sm border-2 transition-transform hover:scale-110 ${
                selected ? 'ring-2 ring-accent ring-offset-1' : ''
              }`}
              style={{
                backgroundColor: preset.hex,
                borderColor: productColorBorder(preset.hex),
              }}
              onClick={() => onColorChange(preset.hex)}
            />
          )
        })}
        <label
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border border-dashed border-grid text-xs text-stone-400 hover:bg-stone-50"
          title={t('finishedProduct.customColor')}
        >
          +
          <input
            type="color"
            className="sr-only"
            value={isValidHex(productColor) ? productColor! : '#2563eb'}
            onChange={(e) => onColorChange(e.target.value)}
          />
        </label>
        {productColor && (
          <button
            type="button"
            className="text-xs text-stone-500 hover:text-red-600"
            onClick={() => onColorChange(undefined)}
          >
            {t('finishedProduct.colorClear')}
          </button>
        )}
      </div>
      <label className="block text-xs font-medium text-stone-500">
        {t('finishedProduct.colorLogo')}
        <input
          className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('finishedProduct.colorLogoHint')}
          value={colorLogo ?? ''}
          onChange={(e) => onLogoChange(e.target.value)}
        />
      </label>
      {activeHex && (
        <div className="flex items-center gap-2 rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm">
          <span
            className="h-6 w-6 rounded-sm border-2"
            style={{
              backgroundColor: activeHex,
              borderColor: productColorBorder(activeHex),
            }}
          />
          <span>{colorLogo?.trim() || activeHex}</span>
        </div>
      )}
    </div>
  )
}

function isValidHex(hex: string | undefined): boolean {
  return !!hex && /^#[0-9a-fA-F]{6}$/.test(hex)
}

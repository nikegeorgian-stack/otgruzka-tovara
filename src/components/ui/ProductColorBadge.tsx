import {
  productColorBorder,
  productColorLabel,
  resolveProductColor,
} from '@/lib/finishedProducts/colors'
import { useI18n } from '@/context/I18nContext'

type Props = {
  productColor?: string
  colorLogo?: string
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function ProductColorBadge({
  productColor,
  colorLogo,
  showLabel = true,
  size = 'sm',
  className = '',
}: Props) {
  const { locale } = useI18n()
  const hex = resolveProductColor(productColor, colorLogo)
  if (!hex) {
    return showLabel ? (
      <span className={`text-stone-400 ${className}`}>—</span>
    ) : null
  }

  const dim = size === 'md' ? 'h-5 w-5' : 'h-3.5 w-3.5'
  const label = colorLogo?.trim() || productColorLabel(hex, locale)

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`${dim} shrink-0 rounded-sm border-2 shadow-sm`}
        style={{
          backgroundColor: hex,
          borderColor: productColorBorder(hex),
        }}
        title={label}
      />
      {showLabel && (
        <span className="text-inherit">{label}</span>
      )}
    </span>
  )
}

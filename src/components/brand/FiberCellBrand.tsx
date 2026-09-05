import { BRAND } from '@/lib/brand'

type Variant = 'sidebar' | 'page' | 'print' | 'onDark'

type Props = {
  variant?: Variant
  className?: string
}

/**
 * Логотип FiberCell.
 * sidebar/page/print — светлый фон (lockup on light);
 * onDark — оранжевая плашка для тёмного фона;
 * в свёрнутом сайдбаре CSS показывает только mark.
 */
export function FiberCellBrand({ variant = 'page', className = '' }: Props) {
  const lockup =
    variant === 'onDark' ? BRAND.lockupOnDark : BRAND.lockupOnLight

  return (
    <div className={`fc-brand fc-brand--${variant} ${className}`.trim()}>
      <img src={lockup} alt="FiberCell" className="fc-brand__lockup" />
      <img
        src={BRAND.mark}
        alt=""
        aria-hidden
        className="fc-brand__mark-only"
      />
    </div>
  )
}

export function PrintBrandWatermark() {
  return (
    <img
      src={BRAND.mark}
      alt=""
      aria-hidden
      className="print-fc-watermark"
    />
  )
}

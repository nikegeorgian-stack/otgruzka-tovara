type Props = {
  photoDataUrl?: string
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-16 w-16',
} as const

export function WarehouseItemThumb({ photoDataUrl, name, size = 'sm', className = '' }: Props) {
  const dim = SIZES[size]
  if (photoDataUrl) {
    return (
      <img
        src={photoDataUrl}
        alt=""
        className={`${dim} shrink-0 rounded-sm border border-grid object-cover ${className}`}
      />
    )
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span
      className={`${dim} flex shrink-0 items-center justify-center rounded-sm border border-grid bg-stone-100 text-xs font-bold text-stone-400 ${className}`}
      aria-hidden
    >
      {initial}
    </span>
  )
}

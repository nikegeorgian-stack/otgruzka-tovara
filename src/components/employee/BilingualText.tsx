import type { BilingualLines } from '@/i18n/employeeText'

type Props = {
  lines: BilingualLines
  className?: string
  secondaryClassName?: string
}

/** ФИО или должность в двух строках (основной язык + второй). */
export function BilingualText({
  lines,
  className = '',
  secondaryClassName = 'text-[10px] text-stone-500',
}: Props) {
  if (!lines.secondary) {
    return <span className={`block ${className}`.trim()}>{lines.primary}</span>
  }
  return (
    <span className={`block leading-tight ${className}`}>
      <span className="block">{lines.primary}</span>
      <span className={`block ${secondaryClassName}`}>{lines.secondary}</span>
    </span>
  )
}

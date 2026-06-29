import type { ReactNode } from 'react'

type Props = {
  label: string
  htmlFor?: string
  hint?: string
  children: ReactNode
  className?: string
}

export function FormField({ label, htmlFor, hint, children, className = '' }: Props) {
  return (
    <label className={`fc-field ${className}`.trim()} htmlFor={htmlFor}>
      <span className="fc-field__label">{label}</span>
      {children}
      {hint && <span className="fc-field__hint">{hint}</span>}
    </label>
  )
}

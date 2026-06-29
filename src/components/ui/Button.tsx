import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'print'

export type ButtonSize = 'xs' | 'sm' | 'md'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'fc-btn fc-btn--primary',
  secondary: 'fc-btn fc-btn--secondary',
  ghost: 'fc-btn fc-btn--ghost',
  danger: 'fc-btn fc-btn--danger',
  success: 'fc-btn fc-btn--success',
  print: 'fc-btn fc-btn--print',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'fc-btn--xs',
  sm: 'fc-btn--sm',
  md: 'fc-btn--md',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={`${VARIANT[variant]} ${SIZE[size]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  )
}

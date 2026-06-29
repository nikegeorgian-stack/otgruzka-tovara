import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  as?: 'input'
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  as: 'textarea'
}

type Props = InputProps | TextareaProps

export function Input(props: Props) {
  if (props.as === 'textarea') {
    const { as: _, className = '', ...rest } = props
    return <textarea className={`fc-input ${className}`.trim()} {...rest} />
  }
  const { className = '', ...rest } = props
  return <input className={`fc-input ${className}`.trim()} {...rest} />
}

import type { KeyboardEvent } from 'react'

/**
 * Делает не-кнопочный элемент (div/li/tr) доступным с клавиатуры:
 * добавляет role, tabIndex и обработку Enter/Space.
 *
 * Использование:
 *   <div {...clickableProps(() => open(id))}>…</div>
 *
 * Если по семантике подходит <button> — предпочитайте его.
 */
export function clickableProps(
  onActivate: () => void,
  opts?: { disabled?: boolean; role?: 'button' | 'link' },
) {
  const disabled = opts?.disabled ?? false
  return {
    role: opts?.role ?? 'button',
    tabIndex: disabled ? -1 : 0,
    'aria-disabled': disabled || undefined,
    onClick: disabled ? undefined : () => onActivate(),
    onKeyDown: disabled
      ? undefined
      : (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate()
          }
        },
  }
}

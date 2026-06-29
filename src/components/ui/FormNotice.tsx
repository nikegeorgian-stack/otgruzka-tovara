import { CloseIcon } from '@/components/ui/icons'

type Props = {
  type: 'error' | 'success' | 'info'
  message: string
  onDismiss?: () => void
}

export function FormNotice({ type, message, onDismiss }: Props) {
  const styles =
    type === 'error'
      ? 'border-red-200 bg-red-50 text-red-900'
      : type === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-amber-200 bg-amber-50 text-amber-950'

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${styles}`}
    >
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          className="shrink-0 opacity-70 hover:opacity-100"
          onClick={onDismiss}
          aria-label="Закрыть"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  )
}

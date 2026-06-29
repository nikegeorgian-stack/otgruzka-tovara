import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type Props = {
  displayName: string
  email: string
  onLogout: () => void
  compact?: boolean
}

export function WebAccountBar({ displayName, email, onLogout, compact }: Props) {
  const { t } = useI18n()

  if (compact) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 border-b border-stone-200/80 bg-white/90 px-3 py-2 print:hidden">
        <span className="min-w-0 truncate text-xs text-stone-500">
          <span className="font-semibold text-ink">{displayName}</span>
          <span className="mx-1.5 text-stone-300">·</span>
          <span className="text-stone-400">{email}</span>
        </span>
        <Button variant="secondary" size="sm" className="!text-xs" onClick={onLogout}>
          {t('access.switchAccount')}
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-sm border border-stone-200 bg-stone-50/90 p-2.5">
      <p className="truncate text-xs font-semibold text-ink">{displayName}</p>
      <p className="mt-0.5 truncate text-[10px] text-stone-500">{email}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <Button variant="secondary" size="sm" className="w-full !text-xs" onClick={onLogout}>
          {t('access.switchAccount')}
        </Button>
        <Button variant="ghost" size="sm" className="w-full !text-xs text-stone-500" onClick={onLogout}>
          {t('access.logout')}
        </Button>
      </div>
    </div>
  )
}

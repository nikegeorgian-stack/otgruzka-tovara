import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'
import type { EditLockRecord } from '@/lib/editLocks/types'

type Props = {
  lock: EditLockRecord
  onTakeOver: () => void
  onResetLock?: () => void
  onReadonly: () => void
  readonly: boolean
  /** Показывать кнопку перехвата (sysadmin). */
  canTakeOver?: boolean
}

export function EditLockBanner({
  lock,
  onTakeOver,
  onResetLock,
  onReadonly,
  readonly,
  canTakeOver = false,
}: Props) {
  const { t, tf } = useI18n()
  const name = lock.holder.name || t('editLock.someone')

  return (
    <div
      className="shrink-0 border-b border-amber-300/80 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
      role="status"
    >
      <p className="font-semibold">
        {tf('editLock.heldBy', { name })}
      </p>
      <p className="mt-0.5 text-xs text-amber-900/85">
        {readonly
          ? t('editLock.readonlyHint')
          : canTakeOver
            ? t('editLock.choiceHint')
            : t('editLock.viewOnlyHint')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {!readonly && (
          <Button variant="secondary" size="sm" className="!text-xs" onClick={onReadonly}>
            {t('editLock.viewOnly')}
          </Button>
        )}
        {canTakeOver && (
          <>
            {readonly && onResetLock ? (
              <Button variant="secondary" size="sm" className="!text-xs" onClick={onResetLock}>
                {t('editLock.reset')}
              </Button>
            ) : null}
            <Button variant="primary" size="sm" className="!text-xs" onClick={onTakeOver}>
              {t('editLock.takeOver')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

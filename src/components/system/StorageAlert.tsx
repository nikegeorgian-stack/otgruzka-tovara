import { useI18n } from '@/context/I18nContext'
import { listDailyBackups } from '@/lib/backup'
import type { LoadStoreResult, SaveStoreResult } from '@/lib/storage'

type Props = {
  loadWarning?: LoadStoreResult['warning']
  saveError: SaveStoreResult | null
  onDismissLoadWarning: () => void
  onDismissSaveError?: () => void
  onExportJson?: () => void
  onRestoreFromBackup?: (date: string) => void
}

export function StorageAlert({
  loadWarning,
  saveError,
  onDismissLoadWarning,
  onDismissSaveError,
  onExportJson,
  onRestoreFromBackup,
}: Props) {
  const { t } = useI18n()
  const backups = listDailyBackups()

  if (!loadWarning && !saveError) return null

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex flex-col gap-1 px-3 pt-2">
      {loadWarning && (
        <div
          role="alert"
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 shadow-md"
        >
          <span className="flex-1">
            {loadWarning === 'corrupt_recovered'
              ? t('storage.corruptRecovered')
              : t('storage.freshStart')}
          </span>
          {backups[0] && onRestoreFromBackup && (
            <button
              type="button"
              className="rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-100"
              onClick={() => onRestoreFromBackup(backups[0]!.date)}
            >
              {t('storage.restoreLatest')} ({backups[0].date})
            </button>
          )}
          <button
            type="button"
            className="text-xs text-amber-700 underline"
            onClick={onDismissLoadWarning}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
      {saveError && !saveError.ok && (
        <div
          role="alert"
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-sm border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 shadow-md"
        >
          <span className="flex-1">
            {saveError.error === 'quota' ? t('storage.quotaError') : saveError.message}
          </span>
          {onExportJson && (
            <button
              type="button"
              className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs hover:bg-red-100"
              onClick={onExportJson}
            >
              {t('common.export')}
            </button>
          )}
          {onDismissSaveError && (
            <button
              type="button"
              className="text-xs text-red-700 underline"
              onClick={onDismissSaveError}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

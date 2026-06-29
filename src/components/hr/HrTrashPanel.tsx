import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { TRASH_RETENTION_DAYS } from '@/lib/types'
import type { AppStore } from '@/lib/types'

type Props = {
  admin: boolean
  trash: AppStore['trash']
  onRestoreEmployee: (deletedAt: string) => void
  onPurgeEmployee: (deletedAt: string) => void
  onRestoreCandidate: (deletedAt: string) => void
  onPurgeCandidate: (deletedAt: string) => void
}

export function HrTrashPanel({
  admin,
  trash,
  onRestoreEmployee,
  onPurgeEmployee,
  onRestoreCandidate,
  onPurgeCandidate,
}: Props) {
  const { t } = useI18n()
  const { confirm } = useConfirm()

  if (!admin) {
    return (
      <div className="rounded-sm border border-grid bg-white p-6 text-center text-sm text-stone-500">
        {t('hr.trash.adminOnly')}
      </div>
    )
  }

  const employees = trash.employees ?? []
  const candidates = trash.candidates ?? []

  async function purge(name: string, run: () => void) {
    const ok = await confirm({
      message: t('hr.purgeConfirm').replace('{name}', name || '—'),
      danger: true,
    })
    if (ok) run()
  }

  function fmt(at: string): string {
    try {
      return new Date(at).toLocaleString()
    } catch {
      return at
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-ink">{t('hr.trash.title')}</h3>
        <p className="mt-1 text-xs text-stone-500">
          {t('hr.trash.hint').replace('{days}', String(TRASH_RETENTION_DAYS))}
        </p>
      </div>

      <section className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <h4 className="border-b border-grid bg-stone-50 px-4 py-2 text-xs font-bold uppercase text-stone-500">
          {t('hr.trash.employees')} ({employees.length})
        </h4>
        {employees.length === 0 ? (
          <p className="p-4 text-sm text-stone-400">{t('hr.trash.empty')}</p>
        ) : (
          <ul className="divide-y divide-grid">
            {employees.map((item) => (
              <li
                key={item.deletedAt}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium text-ink">{item.employee.fullName || '—'}</span>
                  <span className="ml-2 font-mono text-xs text-stone-400">
                    № {item.employee.tabNumber}
                  </span>
                  <span className="ml-2 text-xs text-stone-400">
                    {t('hr.deletedAt')}: {fmt(item.deletedAt)}
                  </span>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-teal-700 hover:underline"
                    onClick={() => onRestoreEmployee(item.deletedAt)}
                  >
                    {t('hr.restore')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() =>
                      purge(item.employee.fullName, () => onPurgeEmployee(item.deletedAt))
                    }
                  >
                    {t('hr.purge')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <h4 className="border-b border-grid bg-stone-50 px-4 py-2 text-xs font-bold uppercase text-stone-500">
          {t('hr.trash.candidates')} ({candidates.length})
        </h4>
        {candidates.length === 0 ? (
          <p className="p-4 text-sm text-stone-400">{t('hr.trash.empty')}</p>
        ) : (
          <ul className="divide-y divide-grid">
            {candidates.map((item) => (
              <li
                key={item.deletedAt}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
              >
                <div>
                  <span className="font-medium text-ink">{item.candidate.fullName || '—'}</span>
                  {item.candidate.position && (
                    <span className="ml-2 text-xs text-stone-400">{item.candidate.position}</span>
                  )}
                  <span className="ml-2 text-xs text-stone-400">
                    {t('hr.deletedAt')}: {fmt(item.deletedAt)}
                  </span>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="text-xs font-semibold text-teal-700 hover:underline"
                    onClick={() => onRestoreCandidate(item.deletedAt)}
                  >
                    {t('hr.restore')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() =>
                      purge(item.candidate.fullName, () => onPurgeCandidate(item.deletedAt))
                    }
                  >
                    {t('hr.purge')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

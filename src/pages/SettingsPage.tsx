import { useState } from 'react'
import { AccessAdminPanel } from '@/components/auth/AccessAdminPanel'
import { CoachSettingsPanel } from '@/components/ai/CoachSettingsPanel'
import { FormNotice } from '@/components/ui/FormNotice'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { listDailyBackups, restoreDailyBackup, saveBackupToFolder } from '@/lib/backup'
import { formatMonthTitle, monthKey, shiftMonth } from '@/lib/dates'
import {
  isMonthArchived,
  isMonthClosed,
  listMonthKeys,
  monthClosureInfo,
} from '@/lib/monthManage'
import { exportToJson } from '@/lib/storage'
import { canManageAccess } from '@/lib/access/permissions'
import type { AccessRoleId } from '@/lib/access/types'
import type { AppUser } from '@/lib/access/types'
import type { AppStore, PrintSignatures, ViewId } from '@/lib/types'
import { MAX_AUDIT_ENTRIES } from '@/lib/types'
import type { UpsertAppUserInput } from '@/store/slices/accessSlice'

type Props = {
  store: AppStore
  currentUser: AppUser | null
  onUpsertAppUser: (input: UpsertAppUserInput) => Promise<{ allowlistSyncFailed?: boolean }>
  onRemoveAppUser: (id: string) => void
  onSetRoleViews: (roleId: AccessRoleId, views: ViewId[]) => void
  onSetRoleAllowNegativeStock: (roleId: AccessRoleId, allowed: boolean) => void
  onSetRoleAllowDocumentCancel: (roleId: AccessRoleId, allowed: boolean) => void
  onSetWarehouseMonthClosed: (month: string, closed: boolean) => void
  onAddMonth: (month: string) => void
  onRemoveMonth: (month: string) => void
  onArchiveMonth: (month: string, archived: boolean) => void
  onSetMonthClosed: (month: string, closed: boolean) => void
  onSyncMonthRosterFromHr?: (month: string) => void
  canReopenMonth?: boolean
  onUpdateSettings: (patch: Partial<AppStore['settings']>) => void
  onRestoreTrashEmployee: (deletedAt: string) => void
  onRestoreTrashMonth: (deletedAt: string) => void
  onPurgeTrashEmployee: (deletedAt: string) => void
  onPurgeTrashMonth: (deletedAt: string) => void
  onReplaceStore: (store: AppStore) => void
}

export function SettingsPage({
  store,
  currentUser,
  onUpsertAppUser,
  onRemoveAppUser,
  onSetRoleViews,
  onSetRoleAllowNegativeStock,
  onSetRoleAllowDocumentCancel,
  onSetWarehouseMonthClosed,
  onAddMonth,
  onRemoveMonth,
  onArchiveMonth,
  onSetMonthClosed,
  onSyncMonthRosterFromHr,
  canReopenMonth = false,
  onUpdateSettings,
  onRestoreTrashEmployee,
  onRestoreTrashMonth,
  onPurgeTrashEmployee,
  onPurgeTrashMonth,
  onReplaceStore,
}: Props) {
  const { t, tf, locale, setLocale } = useI18n()
  const { confirm } = useConfirm()
  const auditCount = store.auditLog.length
  const auditFillPct = Math.round((auditCount / MAX_AUDIT_ENTRIES) * 100)
  const auditNearCap = auditCount >= MAX_AUDIT_ENTRIES * 0.9
  const auditFull = auditCount >= MAX_AUDIT_ENTRIES
  const [newMonth, setNewMonth] = useState(() => {
    const keys = listMonthKeys(store)
    const last = keys[keys.length - 1]
    return last ? shiftMonth(last, 1) : monthKey(new Date().getFullYear(), new Date().getMonth() + 1)
  })
  const [newWhPeriod, setNewWhPeriod] = useState(() =>
    monthKey(new Date().getFullYear(), new Date().getMonth() + 1),
  )
  const [notice, setNotice] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  )

  function showNotice(type: 'error' | 'success' | 'info', message: string) {
    setNotice({ type, message })
  }

  const months = listMonthKeys(store)
  const closedWhMonths = store.warehouse.closedMonths ?? []
  const dailyBackups = listDailyBackups()
  const signatures = store.settings.signatures ?? {}

  function patchSignatures(patch: Partial<PrintSignatures>) {
    onUpdateSettings({
      signatures: { ...signatures, ...patch },
    })
  }

  function monthErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      switch (err.message) {
        case 'archived':
          return t('settings.err.monthArchived')
        case 'exists':
          return t('settings.err.monthExists')
        case 'missing':
          return t('settings.err.monthMissing')
        default:
          return err.message
      }
    }
    return t('settings.err.generic')
  }

  function handleAddMonth(e: React.FormEvent) {
    e.preventDefault()
    try {
      onAddMonth(newMonth)
      setNewMonth(shiftMonth(newMonth, 1))
      showNotice('success', t('settings.monthAdded'))
    } catch (err) {
      showNotice('error', monthErrorMessage(err))
    }
  }

  async function handleRemoveMonth(month: string) {
    if (isMonthArchived(store, month)) {
      showNotice('error', t('settings.err.archiveRemove'))
      return
    }
    if (
      !(await confirm({
        message: tf('settings.confirmDeleteMonth', {
          month: formatMonthTitle(month, locale),
        }),
        danger: true,
      }))
    ) {
      return
    }
    try {
      onRemoveMonth(month)
      showNotice('success', t('settings.monthRemoved'))
    } catch (err) {
      showNotice('error', monthErrorMessage(err))
    }
  }

  const archiveBootstrapMonth = monthKey(2026, 6)

  function handleSyncRoster(month: string) {
    if (!onSyncMonthRosterFromHr) return
    try {
      onSyncMonthRosterFromHr(month)
      showNotice('success', t('settings.rosterSynced'))
    } catch (err) {
      showNotice('error', monthErrorMessage(err))
    }
  }

  function handleBootstrapArchiveMonth() {
    try {
      if (!store.months[archiveBootstrapMonth]) {
        onAddMonth(archiveBootstrapMonth)
      }
      onSyncMonthRosterFromHr?.(archiveBootstrapMonth)
      showNotice('success', tf('settings.archiveBootstrapDone', {
        month: formatMonthTitle(archiveBootstrapMonth, locale),
      }))
    } catch (err) {
      showNotice('error', monthErrorMessage(err))
    }
  }

  return (
    <PageLayout className="gap-8">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      {notice && (
        <FormNotice
          type={notice.type}
          message={notice.message}
          onDismiss={() => setNotice(null)}
        />
      )}

      {currentUser && canManageAccess(currentUser) && (
        <AccessAdminPanel
          access={store.access}
          employees={store.employees}
          brigades={store.brigades}
          webMode={import.meta.env.VITE_FST_WEB === 'true'}
          currentUser={currentUser}
          onUpsertUser={onUpsertAppUser}
          onRemoveUser={onRemoveAppUser}
          onSetRoleViews={onSetRoleViews}
          onSetRoleAllowNegativeStock={onSetRoleAllowNegativeStock}
          onSetRoleAllowDocumentCancel={onSetRoleAllowDocumentCancel}
        />
      )}

      {currentUser && canManageAccess(currentUser) && (
        <CoachSettingsPanel store={store} onUpdateSettings={onUpdateSettings} />
      )}

      {currentUser && canManageAccess(currentUser) && (
        <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            {t('settings.warehousePeriods')}
          </h3>
          <p className="mt-1 text-sm text-stone-500">{t('settings.warehousePeriodsHint')}</p>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              onSetWarehouseMonthClosed(newWhPeriod, true)
              showNotice('success', t('settings.warehousePeriodClosed'))
            }}
          >
            <label className="text-xs font-medium text-stone-500">
              {t('settings.colWhPeriod')}
              <input
                type="month"
                className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
                value={newWhPeriod}
                onChange={(e) => setNewWhPeriod(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rounded-sm bg-stone-800 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-900"
            >
              {t('settings.warehousePeriodClose')}
            </button>
          </form>
          {closedWhMonths.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {closedWhMonths.map((month) => (
                <li key={month} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium capitalize">{formatMonthTitle(month, locale)}</span>
                  <span className="rounded-sm bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-800">
                    {t('settings.warehousePeriodClosedBadge')}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-accent hover:underline"
                    onClick={() => {
                      onSetWarehouseMonthClosed(month, false)
                      showNotice('success', t('settings.warehousePeriodOpened'))
                    }}
                  >
                    {t('settings.warehousePeriodOpen')}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-stone-400">{t('settings.warehousePeriodsEmpty')}</p>
          )}
        </section>
      )}

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('settings.language')}
        </h3>
        <div className="mt-3 flex gap-2">
          {(['ru', 'ka'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`rounded-sm border px-4 py-2 text-sm font-medium ${
                locale === l
                  ? 'border-accent bg-accent text-white'
                  : 'border-grid bg-white hover:bg-paper-dark'
              }`}
              onClick={() => setLocale(l)}
            >
              {t(l === 'ru' ? 'locale.ru' : 'locale.ka')}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('settings.brigades')}
        </h3>
        <p className="mt-2 text-sm text-stone-600">{t('settings.brigadesMoved')}</p>
      </section>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('settings.backup')}
        </h3>
        <p className="mt-1 text-sm text-stone-500">{t('settings.backupHint')}</p>
        <p className="mt-1 text-xs text-stone-400">{t('settings.exportSecretsNote')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid px-3 py-2 text-sm hover:bg-paper-dark"
            onClick={() => exportToJson(store)}
          >
            JSON
          </button>
          <button
            type="button"
            className="rounded-sm border border-grid px-3 py-2 text-sm hover:bg-paper-dark"
            onClick={async () => {
              const ok = await saveBackupToFolder(store)
              if (!ok) showNotice('error', t('settings.backupFolder'))
            }}
          >
            {t('settings.backupFolder')}
          </button>
        </div>
        {dailyBackups.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-stone-600">
            {dailyBackups.map((b) => (
              <li key={b.date} className="flex items-center gap-2">
                <span>{b.date}</span>
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={async () => {
                    const restored = restoreDailyBackup(b.date)
                    if (restored && (await confirm({ message: tf('settings.restoreConfirm', { date: b.date }) }))) {
                      onReplaceStore(restored)
                    }
                  }}
                >
                  ↺
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(store.trash.employees.length > 0 || store.trash.months.length > 0) && (
        <section className="rounded-sm border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
            {t('settings.trash')}
          </h3>
          {store.trash.employees.map((item) => (
            <div key={item.deletedAt} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{item.employee.fullName}</span>
              <span className="text-xs text-stone-400">{item.deletedAt.slice(0, 10)}</span>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                title={t('settings.trashRestore')}
                onClick={() => onRestoreTrashEmployee(item.deletedAt)}
              >
                {t('settings.trashRestore')}
              </button>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                title={t('settings.trashPurge')}
                onClick={async () => {
                  if (await confirm({ message: t('settings.confirmPurgeTrash'), danger: true })) {
                    onPurgeTrashEmployee(item.deletedAt)
                  }
                }}
              >
                {t('settings.trashPurge')}
              </button>
            </div>
          ))}
          {store.trash.months.map((item) => (
            <div key={item.deletedAt} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span>{formatMonthTitle(item.sheet.month, locale)}</span>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                title={t('settings.trashRestore')}
                onClick={() => onRestoreTrashMonth(item.deletedAt)}
              >
                {t('settings.trashRestore')}
              </button>
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                title={t('settings.trashPurge')}
                onClick={async () => {
                  if (await confirm({ message: t('settings.confirmPurgeTrash'), danger: true })) {
                    onPurgeTrashMonth(item.deletedAt)
                  }
                }}
              >
                {t('settings.trashPurge')}
              </button>
            </div>
          ))}
        </section>
      )}

      {(store.auditLog.length > 0 || auditNearCap) && (
        <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {t('settings.audit')}
            </h3>
            <span
              className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                auditFull
                  ? 'bg-red-100 text-red-800'
                  : auditNearCap
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-stone-100 text-stone-600'
              }`}
            >
              {tf('settings.auditFill', {
                count: String(auditCount),
                max: String(MAX_AUDIT_ENTRIES),
                pct: String(auditFillPct),
              })}
            </span>
          </div>
          {auditNearCap && (
            <p
              className={`mt-2 text-sm ${auditFull ? 'text-red-700' : 'text-amber-800'}`}
            >
              {auditFull ? t('settings.auditFull') : t('settings.auditNearCap')}
            </p>
          )}
          {store.auditLog.length > 0 && (
          <div className="mt-3 max-h-48 overflow-auto text-xs">
            <table className="min-w-full">
              <tbody>
                {[...store.auditLog].reverse().slice(0, 50).map((e) => (
                  <tr key={e.id} className="border-t border-grid">
                    <td className="py-1 pr-2 whitespace-nowrap text-stone-400">
                      {e.at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-1">{e.action}</td>
                    <td className="py-1 text-stone-600">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>
      )}

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('settings.signatures')}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['masterRu', 'print.signMaster', 'RU'],
              ['masterKa', 'print.signMaster', 'GE'],
              ['accountantRu', 'print.signAccountant', 'RU'],
              ['accountantKa', 'print.signAccountant', 'GE'],
              ['directorRu', 'print.signDirector', 'RU'],
              ['directorKa', 'print.signDirector', 'GE'],
            ] as const
          ).map(([key, labelKey, lang]) => (
            <label key={key} className="text-xs font-medium text-stone-500">
              {t(labelKey)} ({lang})
              <input
                className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
                value={signatures[key] ?? ''}
                onChange={(e) => patchSignatures({ [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-sm border border-sky-200 bg-sky-50/60 p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-sky-900">
          {t('settings.archiveBootstrapTitle')}
        </h3>
        <p className="mt-2 text-sm text-stone-600">{t('settings.archiveBootstrapHint')}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-600">
          <li>{t('settings.archiveBootstrapStep1')}</li>
          <li>{t('settings.archiveBootstrapStep2')}</li>
          <li>{t('settings.archiveBootstrapStep3')}</li>
          <li>{t('settings.archiveBootstrapStep4')}</li>
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
            onClick={handleBootstrapArchiveMonth}
          >
            {tf('settings.archiveBootstrapAction', {
              month: formatMonthTitle(archiveBootstrapMonth, locale),
            })}
          </button>
        </div>
      </section>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
          {t('settings.months')}
        </h3>
        <p className="mt-1 text-sm text-stone-500">{t('settings.monthsHint')}</p>

        <div className="mt-4 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('settings.colMonth')}</th>
                <th className="px-3 py-2">{t('settings.colClosed')}</th>
                <th className="px-3 py-2">{t('settings.colArchive')}</th>
                <th className="px-3 py-2 text-right">{t('settings.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((month) => {
                const archived = isMonthArchived(store, month)
                const closed = isMonthClosed(store, month)
                const closure = monthClosureInfo(store, month)
                const lockToggleDisabled = closed && !canReopenMonth
                return (
                  <tr key={month} className="border-t border-grid">
                    <td className="px-3 py-2 font-medium capitalize">
                      {formatMonthTitle(month, locale)}
                      {closed && (
                        <span className="ml-2 rounded-sm bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          🔒 {t('month.closed')}
                        </span>
                      )}
                      {archived && (
                        <span className="ml-2 rounded-sm bg-stone-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-stone-600">
                          {t('month.archive')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <label
                        className={`inline-flex items-center gap-2 text-xs ${
                          lockToggleDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                        }`}
                        title={lockToggleDisabled ? t('month.closedReopenAdmin') : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={closed}
                          disabled={lockToggleDisabled}
                          onChange={(e) => onSetMonthClosed(month, e.target.checked)}
                        />
                        {t('settings.closeMonth')}
                      </label>
                      {closed && closure?.byName && (
                        <div className="mt-0.5 text-[10px] text-stone-500">
                          {closure.byName} · {closure.at ? closure.at.slice(0, 10) : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={archived}
                          onChange={(e) => onArchiveMonth(month, e.target.checked)}
                        />
                        {t('settings.archiveProtect')}
                      </label>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {onSyncMonthRosterFromHr && (
                          <button
                            type="button"
                            className="rounded-sm border border-sky-200 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-50"
                            title={t('settings.syncRosterHint')}
                            onClick={() => handleSyncRoster(month)}
                          >
                            {t('settings.syncRoster')}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-sm border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={archived || closed}
                          title={
                            closed
                              ? t('month.closedEditBlocked')
                              : archived
                                ? t('settings.unarchiveToRemove')
                                : t('settings.removeMonthTitle')
                          }
                          onClick={() => handleRemoveMonth(month)}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddMonth} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-stone-500">
            {t('settings.newMonth')}
            <input
              type="month"
              className="mt-1 block rounded-sm border border-grid px-3 py-2 text-sm"
              value={newMonth}
              onChange={(e) => setNewMonth(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn-add-outline px-4 py-2 text-sm font-semibold"
          >
            {t('settings.addMonth')}
          </button>
        </form>
      </section>
    </PageLayout>
  )
}

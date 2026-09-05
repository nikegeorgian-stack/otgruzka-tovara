import { useMemo, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { ModalBackdrop } from '@/components/ui/ModalBackdrop'
import type { AccessStore, AccessUserGroup, AppUser } from '@/lib/access/types'
import { roleLabel } from '@/lib/access/roles'

type FormState = {
  id?: string
  name: string
  note: string
  userIds: string[]
}

type Props = {
  access: AccessStore
  onUpsertGroup: (input: {
    id?: string
    name: string
    note?: string
    userIds?: string[]
  }) => void
  onRemoveGroup: (groupId: string) => void
}

export function AccessUserGroupsPanel({ access, onUpsertGroup, onRemoveGroup }: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const groups = access.userGroups ?? []
  const users = useMemo(
    () =>
      access.users
        .filter((u) => u.active)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru')),
    [access.users],
  )
  const [form, setForm] = useState<FormState | null>(null)

  function openNew() {
    setForm({ name: '', note: '', userIds: [] })
  }

  function openEdit(g: AccessUserGroup) {
    setForm({
      id: g.id,
      name: g.name,
      note: g.note ?? '',
      userIds: [...g.userIds],
    })
  }

  function close() {
    setForm(null)
  }

  function toggleUser(uid: string) {
    if (!form) return
    const next = form.userIds.includes(uid)
      ? form.userIds.filter((id) => id !== uid)
      : [...form.userIds, uid]
    setForm({ ...form, userIds: next })
  }

  function save() {
    if (!form?.name.trim()) return
    onUpsertGroup({
      id: form.id,
      name: form.name,
      note: form.note || undefined,
      userIds: form.userIds,
    })
    close()
  }

  async function remove(g: AccessUserGroup) {
    const ok = await confirm({
      title: t('access.groups.deleteTitle'),
      message: t('access.groups.deleteConfirm').replace('{name}', g.name),
      confirmLabel: t('counterparty.delete'),
      danger: true,
    })
    if (!ok) return
    onRemoveGroup(g.id)
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs text-stone-500">{t('access.groups.hint')}</p>
        <button type="button" className="btn-add" onClick={openNew}>
          {t('access.groups.add')}
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-sm border border-dashed border-grid bg-white px-4 py-8 text-center text-sm text-stone-400">
          {t('access.groups.empty')}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <article
              key={g.id}
              className="rounded-sm border border-grid bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-ink">{g.name}</h4>
                  {g.note ? (
                    <p className="mt-0.5 text-[11px] text-stone-500">{g.note}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-stone-500">
                    {t('access.groups.memberCount').replace('{n}', String(g.userIds.length))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent"
                    onClick={() => openEdit(g)}
                  >
                    {t('access.editUser')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-red-600"
                    onClick={() => void remove(g)}
                  >
                    {t('counterparty.delete')}
                  </button>
                </div>
              </div>
              {g.userIds.length > 0 ? (
                <ul className="mt-3 max-h-28 space-y-1 overflow-y-auto text-xs text-stone-600">
                  {g.userIds.map((uid) => {
                    const u = users.find((x) => x.id === uid)
                    return (
                      <li
                        key={uid}
                        className="flex justify-between gap-2 border-t border-grid/50 pt-1"
                      >
                        <span>{u?.displayName ?? uid.slice(0, 8)}</span>
                        <span className="text-stone-400">
                          {u ? roleLabel(u.roleId, locale) : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {form ? (
        <ModalBackdrop
          open
          onClose={close}
          panelClassName="app-dialog-panel flex w-full max-w-lg flex-col overflow-hidden rounded-t-sm border border-grid bg-white shadow-sm sm:rounded-sm"
        >
          <h4 className="shrink-0 border-b border-grid bg-stone-50 px-5 py-4 text-lg font-bold text-ink">
            {form.id ? t('access.groups.edit') : t('access.groups.add')}
          </h4>
          <div className="app-dialog-body space-y-3 px-5 py-4">
            <label className="block text-xs font-medium text-stone-500">
              {t('access.groups.name')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block text-xs font-medium text-stone-500">
              {t('access.groups.note')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
            <div>
              <p className="text-xs font-medium text-stone-600">{t('access.groups.members')}</p>
              <p className="mt-0.5 text-[11px] text-stone-400">{t('access.groups.membersHint')}</p>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-sm border border-grid bg-stone-50/50 p-2">
                {users.map((u: AppUser) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={form.userIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{u.displayName}</span>
                    <span className="shrink-0 text-stone-400">{roleLabel(u.roleId, locale)}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="app-dialog-footer flex justify-end gap-2 border-t border-grid bg-stone-50 px-5 py-3">
            <button
              type="button"
              className="rounded-sm border border-grid bg-white px-4 py-2 text-sm"
              onClick={close}
            >
              {t('planner.cancel')}
            </button>
            <button
              type="button"
              data-modal-primary
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              disabled={!form.name.trim()}
              onClick={save}
            >
              {t('planner.save')}
            </button>
          </div>
        </ModalBackdrop>
      ) : null}
    </div>
  )
}

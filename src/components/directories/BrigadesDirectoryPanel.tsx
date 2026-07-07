import { useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { brigadeEmployeeCount } from '@/lib/brigadeManage'
import { activeStructuralUnits } from '@/lib/monthViewOptions'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  compact?: boolean
  onAddBrigade: (name: string) => void
  onRenameBrigade: (oldName: string, newName: string) => void
  onRemoveBrigade: (name: string) => void
  onSetBrigadeNameKa: (nameRu: string, nameKa: string) => void
  onSetBrigadeUnit?: (brigade: string, unitId: string | null) => void
}

export function BrigadesDirectoryPanel({
  store,
  compact = false,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeUnit,
}: Props) {
  const { t, tf } = useI18n()
  const units = activeStructuralUnits(store.hrStructuralUnits)
  const { confirm } = useConfirm()
  const [newBrigade, setNewBrigade] = useState('')
  const [editingBrigade, setEditingBrigade] = useState<string | null>(null)
  const [editBrigadeName, setEditBrigadeName] = useState('')
  const [editBrigadeKa, setEditBrigadeKa] = useState('')
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null,
  )

  function brigadeErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      switch (err.message) {
        case 'empty':
          return t('settings.err.brigadeEmpty')
        case 'duplicate':
          return t('settings.err.brigadeDuplicate')
        case 'last':
          return t('settings.err.brigadeLast')
        case 'employees':
          return t('settings.err.brigadeEmployees')
        case 'missing':
          return t('settings.err.brigadeMissing')
        default:
          return err.message
      }
    }
    return t('settings.err.generic')
  }

  function handleAddBrigade(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newBrigade.trim()
    if (!trimmed) {
      setNotice({ type: 'error', message: t('settings.err.brigadeEmpty') })
      return
    }
    try {
      onAddBrigade(trimmed)
      setNewBrigade('')
      setNotice({
        type: 'success',
        message: `${t('settings.brigadeAdded')} ${t('settings.brigadeAddedHint')}`,
      })
    } catch (err) {
      setNotice({ type: 'error', message: brigadeErrorMessage(err) })
    }
  }

  function saveBrigadeRename(oldName: string) {
    const trimmed = editBrigadeName.trim()
    if (!trimmed) {
      setNotice({ type: 'error', message: t('settings.err.brigadeEmpty') })
      return
    }
    try {
      onRenameBrigade(oldName, trimmed)
      if (editBrigadeKa.trim()) {
        onSetBrigadeNameKa(trimmed, editBrigadeKa.trim())
      }
      setEditingBrigade(null)
      setNotice({ type: 'success', message: t('settings.brigadeSaved') })
    } catch (err) {
      setNotice({ type: 'error', message: brigadeErrorMessage(err) })
    }
  }

  async function handleRemoveBrigade(name: string) {
    const count = brigadeEmployeeCount(store, name)
    const question =
      count > 0
        ? tf('settings.confirmDeleteBrigadeBusy', { name, count })
        : tf('settings.confirmDeleteBrigade', { name })
    if (!(await confirm({ message: question, danger: true }))) return
    try {
      onRemoveBrigade(name)
      setNotice({ type: 'success', message: t('settings.brigadeRemoved') })
    } catch (err) {
      setNotice({ type: 'error', message: brigadeErrorMessage(err) })
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <FormNotice
          type={notice.type}
          message={notice.message}
          onDismiss={() => setNotice(null)}
        />
      )}
      {!compact && <p className="text-sm text-stone-500">{t('settings.brigadesHint')}</p>}
      <div className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <ul className="space-y-2">
          {store.brigades.map((name) => (
            <li
              key={name}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-grid bg-paper/40 px-3 py-2"
            >
              {editingBrigade === name ? (
                <>
                  <input
                    className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1 text-sm"
                    value={editBrigadeName}
                    onChange={(e) => setEditBrigadeName(e.target.value)}
                    placeholder="RU"
                    autoFocus
                  />
                  <input
                    className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1 text-sm"
                    value={editBrigadeKa}
                    onChange={(e) => setEditBrigadeKa(e.target.value)}
                    placeholder="GE"
                  />
                  <button
                    type="button"
                    className="rounded-sm bg-accent px-3 py-1 text-xs font-semibold text-white"
                    onClick={() => saveBrigadeRename(name)}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-grid px-3 py-1 text-xs"
                    onClick={() => setEditingBrigade(null)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">
                    {name}
                    {store.brigadeNamesKa[name] && (
                      <span className="ml-2 text-xs text-stone-400">
                        / {store.brigadeNamesKa[name]}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-stone-400">
                    {brigadeEmployeeCount(store, name)} {t('settings.empCount')}
                  </span>
                  {onSetBrigadeUnit && (
                    <select
                      className="max-w-[14rem] rounded-sm border border-grid px-2 py-1 text-xs"
                      title={t('settings.brigadeUnitHint')}
                      value={store.brigadeUnits?.[name] ?? ''}
                      onChange={(e) => onSetBrigadeUnit(name, e.target.value || null)}
                    >
                      <option value="">{t('settings.brigadeNoUnit')}</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    className="rounded-sm border border-grid px-2 py-1 text-xs hover:bg-paper-dark"
                    onClick={() => {
                      setEditingBrigade(name)
                      setEditBrigadeName(name)
                      setEditBrigadeKa(store.brigadeNamesKa[name] ?? '')
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => handleRemoveBrigade(name)}
                    disabled={store.brigades.length <= 1}
                  >
                    {t('common.delete')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddBrigade} className="mt-4 flex flex-wrap gap-2">
          <input
            className="min-w-[14rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={t('settings.newBrigade')}
            value={newBrigade}
            onChange={(e) => setNewBrigade(e.target.value)}
            required
          />
          <button
            type="submit"
            className="btn-add"
          >
            {t('settings.addBrigade')}
          </button>
        </form>
      </div>
    </div>
  )
}

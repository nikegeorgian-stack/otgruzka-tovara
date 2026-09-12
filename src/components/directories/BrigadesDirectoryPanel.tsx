import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { brigadeEmployeeCount } from '@/lib/brigadeManage'
import { brigadeAllowsBrigadier } from '@/lib/brigadeHasBrigadier'
import {
  activeStructuralUnits,
  BRIGADE_UNIT_FILTER_ALL,
  filterAndSortBrigadeList,
  NO_STRUCTURAL_UNIT_ID,
} from '@/lib/monthViewOptions'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  compact?: boolean
  onAddBrigade: (name: string) => void
  onRenameBrigade: (oldName: string, newName: string) => void
  onRemoveBrigade: (name: string) => void
  onSetBrigadeNameKa: (nameRu: string, nameKa: string) => void
  onSetBrigadeNameEn?: (nameRu: string, nameEn: string) => void
  onSetBrigadeUnit?: (brigade: string, unitId: string | null) => void
  onSetBrigadeHasBrigadier?: (brigade: string, hasBrigadier: boolean) => void
}

export function BrigadesDirectoryPanel({
  store,
  compact = false,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeNameEn,
  onSetBrigadeUnit,
  onSetBrigadeHasBrigadier,
}: Props) {
  const { t, tf, locale } = useI18n()
  const units = activeStructuralUnits(store.hrStructuralUnits)
  const { confirm } = useConfirm()
  const [newBrigade, setNewBrigade] = useState('')
  const [editingBrigade, setEditingBrigade] = useState<string | null>(null)
  const [editBrigadeName, setEditBrigadeName] = useState('')
  const [editBrigadeKa, setEditBrigadeKa] = useState('')
  const [editBrigadeEn, setEditBrigadeEn] = useState('')
  const [brigadeSearch, setBrigadeSearch] = useState('')
  const [unitFilter, setUnitFilter] = useState(BRIGADE_UNIT_FILTER_ALL)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null,
  )

  const hasUnassigned = store.brigades.some((b) => !store.brigadeUnits?.[b]?.trim())

  const visibleBrigades = useMemo(
    () =>
      filterAndSortBrigadeList({
        brigades: store.brigades,
        namesKa: store.brigadeNamesKa,
        locale,
        search: brigadeSearch,
        brigadeUnits: store.brigadeUnits,
        unitFilter,
      }),
    [brigadeSearch, locale, store.brigadeNamesKa, store.brigadeUnits, store.brigades, unitFilter],
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
      if (onSetBrigadeNameEn && editBrigadeEn.trim()) {
        onSetBrigadeNameEn(trimmed, editBrigadeEn.trim())
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm sm:max-w-xs"
            placeholder={t('month.searchBrigade')}
            value={brigadeSearch}
            onChange={(e) => setBrigadeSearch(e.target.value)}
          />
          {units.length > 0 || hasUnassigned ? (
            <select
              className="min-w-[9rem] rounded-sm border border-grid bg-white px-2 py-1.5 text-sm text-stone-700"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              title={t('month.brigadeUnitFilterHint')}
              aria-label={t('month.brigadeUnitFilter')}
            >
              <option value={BRIGADE_UNIT_FILTER_ALL}>{t('month.brigadeUnitFilterAll')}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
              {hasUnassigned ? (
                <option value={NO_STRUCTURAL_UNIT_ID}>{t('month.brigadeUnitFilterNone')}</option>
              ) : null}
            </select>
          ) : null}
          <span className="text-xs text-stone-400">
            {visibleBrigades.length}/{Array.isArray(store.brigades) ? store.brigades.length : 0}
          </span>
        </div>
        <ul className="space-y-2">
          {visibleBrigades.length === 0 ? (
            <li className="px-1 py-2 text-sm text-stone-400">{t('month.noBrigadeMatch')}</li>
          ) : (
            visibleBrigades.map((name) => (
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
                    placeholder="KA"
                  />
                  <input
                    className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1 text-sm"
                    value={editBrigadeEn}
                    onChange={(e) => setEditBrigadeEn(e.target.value)}
                    placeholder="EN"
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
                    {store.brigadeNamesKa[name] ? (
                      <span className="ml-2 text-xs text-stone-400">
                        / {store.brigadeNamesKa[name]}
                      </span>
                    ) : null}
                    {store.brigadeNamesEn?.[name] ? (
                      <span className="ml-2 text-xs text-stone-400">
                        / {store.brigadeNamesEn[name]}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-stone-400">
                    {brigadeEmployeeCount(store, name)} {t('settings.empCount')}
                  </span>
                  {onSetBrigadeHasBrigadier ? (
                    <label
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-grid bg-white px-2 py-1 text-xs text-stone-700"
                      title={t('settings.brigadeHasBrigadierHint')}
                    >
                      <input
                        type="checkbox"
                        className="rounded-sm"
                        checked={brigadeAllowsBrigadier(store, name)}
                        onChange={(e) => onSetBrigadeHasBrigadier(name, e.target.checked)}
                      />
                      {t('settings.brigadeHasBrigadier')}
                    </label>
                  ) : null}
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
                      setEditBrigadeEn(store.brigadeNamesEn?.[name] ?? '')
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    className="rounded-sm border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    onClick={() => handleRemoveBrigade(name)}
                    disabled={(Array.isArray(store.brigades) ? store.brigades.length : 0) <= 1}
                  >
                    {t('common.delete')}
                  </button>
                </>
              )}
            </li>
            ))
          )}
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

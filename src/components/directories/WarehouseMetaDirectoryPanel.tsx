import { useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import { WAREHOUSE_LOCATION_KINDS } from '@/lib/warehouse/locationKinds'
import type { WarehouseCategory, WarehouseLocation, WarehouseLocationKind, WarehouseStore } from '@/lib/warehouse/types'

type Props = {
  warehouse: WarehouseStore
  onUpsertCategory: (cat: WarehouseCategory) => void
  onUpsertLocation: (loc: WarehouseLocation) => void
  onRemoveCategory?: (id: string) => boolean
  onRemoveLocation?: (id: string) => boolean
}

function newId(): string {
  return crypto.randomUUID()
}

export function WarehouseMetaDirectoryPanel({
  warehouse,
  onUpsertCategory,
  onUpsertLocation,
  onRemoveCategory,
  onRemoveLocation,
}: Props) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const [newCat, setNewCat] = useState('')
  const [newLoc, setNewLoc] = useState('')
  const [newLocKind, setNewLocKind] = useState<WarehouseLocationKind>('raw')
  const [notice, setNotice] = useState<string | null>(null)
  const [editCatId, setEditCatId] = useState<string | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editLocId, setEditLocId] = useState<string | null>(null)
  const [editLocName, setEditLocName] = useState('')

  const categories = [...warehouse.categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const locations = [...warehouse.locations].sort((a, b) => a.sortOrder - b.sortOrder)

  function saveCategoryName(cat: WarehouseCategory) {
    const name = editCatName.trim()
    if (!name) return
    if (categories.some((c) => c.id !== cat.id && c.name.toLowerCase() === name.toLowerCase())) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertCategory({ ...cat, name })
    setEditCatId(null)
    setNotice(null)
  }

  function saveLocationName(loc: WarehouseLocation) {
    const name = editLocName.trim()
    if (!name) return
    if (locations.some((l) => l.id !== loc.id && l.name.toLowerCase() === name.toLowerCase())) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertLocation({ ...loc, name })
    setEditLocId(null)
    setNotice(null)
  }

  async function removeCategory(cat: WarehouseCategory) {
    if (!onRemoveCategory) return
    const ok = await confirm({
      title: t('warehouse.meta.deleteCategory'),
      message: cat.name,
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    if (!onRemoveCategory(cat.id)) setNotice(t('warehouse.meta.inUse'))
  }

  async function removeLocation(loc: WarehouseLocation) {
    if (!onRemoveLocation) return
    const ok = await confirm({
      title: t('warehouse.meta.deleteLocation'),
      message: loc.name,
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    if (!onRemoveLocation(loc.id)) setNotice(t('warehouse.meta.inUse'))
  }

  function addCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCat.trim()
    if (!name) return
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertCategory({
      id: newId(),
      name,
      sortOrder: categories.length,
    })
    setNewCat('')
    setNotice(null)
  }

  function addLocation(e: React.FormEvent) {
    e.preventDefault()
    const name = newLoc.trim()
    if (!name) return
    if (locations.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertLocation({
      id: newId(),
      name,
      sortOrder: locations.length,
      kind: newLocKind,
    })
    setNewLoc('')
    setNewLocKind('raw')
    setNotice(null)
  }

  return (
    <div className="space-y-6">
      {notice && <FormNotice type="error" message={notice} onDismiss={() => setNotice(null)} />}
      <p className="text-sm text-stone-500">{t('directories.warehouseMetaHint')}</p>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">
          {t('warehouse.allCategories')}
        </h3>
        <ul className="mt-3 space-y-1 text-sm">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-sm border border-grid px-3 py-2"
            >
              {editCatId === c.id ? (
                <>
                  <input
                    autoFocus
                    className="flex-1 rounded-sm border border-grid px-2 py-1 text-sm"
                    value={editCatName}
                    onChange={(e) => setEditCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCategoryName(c)
                      if (e.key === 'Escape') setEditCatId(null)
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs font-semibold text-teal-700"
                    onClick={() => saveCategoryName(c)}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-stone-500"
                    onClick={() => setEditCatId(null)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">{c.name}</span>
                  <button
                    type="button"
                    className="text-xs text-stone-400 hover:text-teal-700"
                    onClick={() => {
                      setEditCatId(c.id)
                      setEditCatName(c.name)
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  {onRemoveCategory && (
                    <button
                      type="button"
                      className="text-xs text-stone-400 hover:text-red-700"
                      onClick={() => void removeCategory(c)}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addCategory} className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
            placeholder={t('warehouse.newCategory')}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
          />
          <button
            type="submit"
            className="btn-add-icon px-4 py-2 text-sm"
          >
            +
          </button>
        </form>
      </section>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">
          {t('warehouse.location')}
        </h3>
        <ul className="mt-3 space-y-1 text-sm">
          {locations.map((l) => (
            <li
              key={l.id}
              className="flex items-center gap-2 rounded-sm border border-grid px-3 py-2"
            >
              {editLocId === l.id ? (
                <>
                  <input
                    autoFocus
                    className="flex-1 rounded-sm border border-grid px-2 py-1 text-sm"
                    value={editLocName}
                    onChange={(e) => setEditLocName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveLocationName(l)
                      if (e.key === 'Escape') setEditLocId(null)
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs font-semibold text-teal-700"
                    onClick={() => saveLocationName(l)}
                  >
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-stone-500"
                    onClick={() => setEditLocId(null)}
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">{l.name}</span>
                  {l.kind ? (
                    <span className="text-[11px] text-stone-400">
                      {t(`warehouse.locationKind.${l.kind}`)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="text-xs text-stone-400 hover:text-teal-700"
                    onClick={() => {
                      setEditLocId(l.id)
                      setEditLocName(l.name)
                    }}
                  >
                    {t('common.edit')}
                  </button>
                  {onRemoveLocation && (
                    <button
                      type="button"
                      className="text-xs text-stone-400 hover:text-red-700"
                      onClick={() => void removeLocation(l)}
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={addLocation} className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('warehouse.newLocation')}
              value={newLoc}
              onChange={(e) => setNewLoc(e.target.value)}
            />
            <select
              className="rounded-sm border border-grid px-3 py-2 text-sm"
              value={newLocKind}
              onChange={(e) => setNewLocKind(e.target.value as WarehouseLocationKind)}
            >
              {WAREHOUSE_LOCATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`warehouse.locationKind.${kind}`)}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn-add-icon px-4 py-2 text-sm"
            >
              +
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

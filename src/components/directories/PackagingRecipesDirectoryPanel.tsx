import { useMemo, useState } from 'react'
import { useWorkspaceDraftRestore } from '@/hooks/useWorkspaceDraftRestore'
import { FormNotice } from '@/components/ui/FormNotice'
import { WarehouseItemSelect } from '@/components/ui/WarehouseItemSelect'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { formatStackDescription, recipeLayerCounts } from '@/lib/packaging/calc'
import { isBoxItem, isPalletItem } from '@/lib/packaging/filters'
import {
  emptyPackagingRecipe,
  nextPackagingRecipeCode,
  normalizePackagingRecipe,
} from '@/lib/packaging/init'
import type { PackagingRecipe, PackagingRecipeStore, PackagingStackLayer } from '@/lib/packaging/types'
import type { WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  store: PackagingRecipeStore
  warehouseItems: WarehouseItem[]
  categoryNames: Map<string, string>
  onSave: (r: PackagingRecipe) => void
  onRemove: (id: string) => void
  onOpenNomenclature: () => void
  onBranchNomenclature?: (from: {
    title: string
    draftKey: string
    draft: PackagingRecipe
  }) => void
  onClearWorkspaceDraft?: (draftKey: string) => void
  workspaceRestoreSeq?: number
  workspaceDrafts?: Record<string, unknown>
}

export function PackagingRecipesDirectoryPanel({
  store,
  warehouseItems,
  categoryNames,
  onSave,
  onRemove,
  onOpenNomenclature,
  onBranchNomenclature,
  onClearWorkspaceDraft,
  workspaceRestoreSeq = 0,
  workspaceDrafts = {},
}: Props) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const DRAFT_KEY = 'packagingRecipe-edit'
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PackagingRecipe | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useWorkspaceDraftRestore<PackagingRecipe>(
    DRAFT_KEY,
    (draft) => setEditing({ ...draft, stack: [...draft.stack] }),
    workspaceRestoreSeq,
    workspaceDrafts,
  )

  function goNomenclature() {
    if (editing && onBranchNomenclature) {
      onBranchNomenclature({
        title: editing.name || t('packaging.new'),
        draftKey: DRAFT_KEY,
        draft: editing,
      })
      return
    }
    onOpenNomenclature()
  }

  function closeEditing() {
    setEditing(null)
    onClearWorkspaceDraft?.(DRAFT_KEY)
  }

  const pallets = useMemo(
    () => warehouseItems.filter((i) => isPalletItem(i, categoryNames)),
    [warehouseItems, categoryNames],
  )
  const boxes = useMemo(
    () => warehouseItems.filter((i) => isBoxItem(i, categoryNames)),
    [warehouseItems, categoryNames],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return store.items.filter(
      (r) =>
        r.active &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          formatStackDescription(r, locale).toLowerCase().includes(q)),
    )
  }, [store.items, search, locale])

  function openNew() {
    const recipe = emptyPackagingRecipe()
    recipe.code = nextPackagingRecipeCode(store)
    setEditing(recipe)
  }

  function openEdit(r: PackagingRecipe) {
    setEditing({ ...r, stack: [...r.stack] })
  }

  function patch(p: Partial<PackagingRecipe>) {
    setEditing((e) => (e ? { ...e, ...p } : e))
  }

  function pushLayer(layer: PackagingStackLayer) {
    setEditing((e) => (e ? { ...e, stack: [...e.stack, layer] } : e))
  }

  function removeLayer(idx: number) {
    setEditing((e) =>
      e ? { ...e, stack: e.stack.filter((_, i) => i !== idx) } : e,
    )
  }

  function save() {
    if (!editing?.name.trim()) {
      setNotice(t('packaging.errName'))
      return
    }
    if (!editing.stack.length) {
      setNotice(t('packaging.errStack'))
      return
    }
    const normalized = normalizePackagingRecipe({
      ...editing,
      code: editing.code || nextPackagingRecipeCode(store),
      updatedAt: new Date().toISOString(),
    })
    onSave(normalized)
    closeEditing()
    setNotice(t('packaging.saved'))
  }

  const stats = editing ? recipeLayerCounts(editing) : null

  return (
    <div className="space-y-4">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className="min-w-[200px] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
          placeholder={t('packaging.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="btn-add" onClick={openNew}>
          {t('packaging.add')}
        </button>
      </div>

      <div className="overflow-hidden rounded-sm border border-grid bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('packaging.col.code')}</th>
              <th className="px-4 py-3">{t('packaging.col.name')}</th>
              <th className="px-4 py-3">{t('packaging.col.stack')}</th>
              <th className="px-4 py-3">{t('packaging.col.rolls')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-stone-500">
                  {t('packaging.empty')}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const s = recipeLayerCounts(r)
              return (
                <tr key={r.id} className="border-t border-grid/60">
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-stone-600">
                    {formatStackDescription(r, locale)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{s.rollsPerPallet}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-xs text-accent hover:underline"
                      onClick={() => openEdit(r)}
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold">{editing.id ? t('packaging.edit') : t('packaging.add')}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-500">
              {t('packaging.name')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={editing.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('packaging.rollsPerBox')}
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={editing.rollsPerBox}
                onChange={(e) => patch({ rollsPerBox: Number(e.target.value) || 1 })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('packaging.topRolls')}
              <input
                type="number"
                min={0}
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={editing.topRolls ?? ''}
                onChange={(e) =>
                  patch({
                    topRolls: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <WarehouseItemSelect
              label={t('packaging.palletItem')}
              hint={t('packaging.fromWarehouse')}
              value={editing.palletItemId ?? ''}
              options={pallets}
              placeholder={t('packaging.pickPallet')}
              onChange={(id) => patch({ palletItemId: id || undefined })}
              onAdd={goNomenclature}
            />
            <WarehouseItemSelect
              label={t('packaging.boxItem')}
              hint={t('packaging.fromWarehouse')}
              value={editing.boxItemId ?? ''}
              options={boxes}
              placeholder={t('packaging.pickBox')}
              onChange={(id) => patch({ boxItemId: id || undefined })}
              onAdd={goNomenclature}
            />
          </div>

          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-stone-500">
              {t('packaging.stack')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {editing.stack.map((layer, idx) => (
                <span
                  key={`${layer}-${idx}`}
                  className="inline-flex items-center gap-1 rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs"
                >
                  {layer === 'pallet' ? t('packaging.layerPallet') : t('packaging.layerBox')}
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => removeLayer(idx)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn-add-outline" onClick={() => pushLayer('pallet')}>
                + {t('packaging.layerPallet')}
              </button>
              <button type="button" className="btn-add-outline" onClick={() => pushLayer('box')}>
                + {t('packaging.layerBox')}
              </button>
            </div>
            {stats && (
              <p className="mt-2 text-xs text-stone-500">
                {formatStackDescription(editing, locale)} · {t('packaging.rollsPerPallet')}:{' '}
                {stats.rollsPerPallet}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white" onClick={save}>
              {t('common.save')}
            </button>
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm"
              onClick={closeEditing}
            >
              {t('common.cancel')}
            </button>
            {editing.id && store.items.some((i) => i.id === editing.id) && (
              <button
                type="button"
                className="rounded-sm border border-red-200 px-4 py-2 text-sm text-red-700"
                onClick={async () => {
                  if (await confirm({ message: t('packaging.deleteConfirm'), danger: true })) {
                    onRemove(editing.id)
                    closeEditing()
                  }
                }}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

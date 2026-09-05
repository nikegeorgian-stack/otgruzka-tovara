import { useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useConfirm } from '@/context/ConfirmContext'
import { useI18n } from '@/context/I18nContext'
import {
  categoryLabel,
  nextCategoryCode,
  routePointLabel,
} from '@/lib/procurement/catalog'
import type {
  ProcurementCategoryNode,
  ProcurementStore,
  RoutePoint,
  RoutePointKind,
  TransportMode,
} from '@/lib/procurement/types'

type Props = {
  procurement: ProcurementStore
  onUpsertCategory: (cat: ProcurementCategoryNode) => void
  onRemoveCategory: (id: string) => boolean
  onUpsertRoutePoint: (point: RoutePoint) => void
  onRemoveRoutePoint: (id: string) => boolean
}

const KINDS: RoutePointKind[] = ['port', 'station', 'terminal', 'customs', 'warehouse', 'other']
const MODES: TransportMode[] = ['sea', 'rail', 'truck', 'air', 'mixed']

export function ProcurementCatalogTab({
  procurement,
  onUpsertCategory,
  onRemoveCategory,
  onUpsertRoutePoint,
  onRemoveRoutePoint,
}: Props) {
  const { t } = useI18n()
  const { confirm } = useConfirm()
  const [notice, setNotice] = useState<string | null>(null)
  const [catName, setCatName] = useState('')
  const [catParentId, setCatParentId] = useState('')
  const [pointName, setPointName] = useState('')
  const [pointCode, setPointCode] = useState('')
  const [pointKind, setPointKind] = useState<RoutePointKind>('port')
  const [pointModes, setPointModes] = useState<TransportMode[]>(['sea'])
  const [filterKind, setFilterKind] = useState<RoutePointKind | ''>('')
  const [filterCode, setFilterCode] = useState('')

  const categories = useMemo(
    () => [...procurement.categories].sort((a, b) => a.code.localeCompare(b.code)),
    [procurement.categories],
  )
  const roots = categories.filter((c) => !c.parentId)
  const points = useMemo(() => {
    const q = filterCode.trim().toLowerCase()
    return [...procurement.routePoints]
      .filter((p) => (filterKind ? p.kind === filterKind : true))
      .filter(
        (p) =>
          !q ||
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
  }, [procurement.routePoints, filterKind, filterCode])

  function addCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = catName.trim()
    if (!name) return
    const parentId = catParentId || undefined
    const code = nextCategoryCode(categories, parentId)
    if (categories.some((c) => c.code === code)) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertCategory({
      id: crypto.randomUUID(),
      code,
      name,
      parentId,
      active: true,
      sortOrder: categories.length + 1,
      legacyKey: parentId
        ? categories.find((c) => c.id === parentId)?.legacyKey
        : 'other',
    })
    setCatName('')
    setNotice(null)
  }

  async function removeCat(cat: ProcurementCategoryNode) {
    const ok = await confirm({
      title: t('procurement.catalog.deleteCategory'),
      message: categoryLabel(cat),
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    if (!onRemoveCategory(cat.id)) setNotice(t('procurement.catalog.inUse'))
  }

  function addPoint(e: React.FormEvent) {
    e.preventDefault()
    const name = pointName.trim()
    const code = pointCode.trim().toUpperCase()
    if (!name || !code) return
    if (procurement.routePoints.some((p) => p.code.toUpperCase() === code)) {
      setNotice(t('directories.err.duplicate'))
      return
    }
    onUpsertRoutePoint({
      id: crypto.randomUUID(),
      code,
      name,
      kind: pointKind,
      transportModes: pointModes.length ? pointModes : ['mixed'],
      active: true,
      sortOrder: procurement.routePoints.length + 1,
    })
    setPointName('')
    setPointCode('')
    setNotice(null)
  }

  async function removePoint(p: RoutePoint) {
    const ok = await confirm({
      title: t('procurement.catalog.deletePoint'),
      message: routePointLabel(p),
      danger: true,
      confirmLabel: t('common.delete'),
    })
    if (!ok) return
    if (!onRemoveRoutePoint(p.id)) setNotice(t('procurement.catalog.inUse'))
  }

  function toggleMode(mode: TransportMode) {
    setPointModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode],
    )
  }

  return (
    <div className="space-y-6" data-coach="procurement.catalog">
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">
          {t('procurement.catalog.categories')}
        </h3>
        <p className="mt-1 text-xs text-stone-500">{t('procurement.catalog.categoriesHint')}</p>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={addCategory}>
          <label className="text-xs font-semibold text-stone-500">
            {t('procurement.catalog.parent')}
            <select
              className="mt-1 block min-w-[10rem] rounded-sm border border-grid px-2 py-2 text-sm"
              value={catParentId}
              onChange={(e) => setCatParentId(e.target.value)}
            >
              <option value="">{t('procurement.catalog.root')}</option>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {categoryLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-stone-500">
            {t('common.name')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder={t('procurement.catalog.categoryPlaceholder')}
            />
          </label>
          <button type="submit" className="btn-add">
            + {t('procurement.catalog.addCategory')}
          </button>
        </form>
        <ul className="mt-4 max-h-72 space-y-1 overflow-y-auto text-sm">
          {categories.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-sm border border-grid px-3 py-2"
            >
              <span className="font-mono text-[11px] text-teal-800">{c.code}</span>
              <span className={c.parentId ? 'pl-3 text-stone-700' : 'font-semibold text-stone-800'}>
                {c.name}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-red-600"
                onClick={() => void removeCat(c)}
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-stone-500">
          {t('procurement.catalog.routePoints')}
        </h3>
        <p className="mt-1 text-xs text-stone-500">{t('procurement.catalog.routePointsHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <select
            className="rounded-sm border border-grid px-2 py-2 text-sm"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value as RoutePointKind | '')}
          >
            <option value="">{t('procurement.catalog.allKinds')}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`procurement.routeKind.${k}`)}
              </option>
            ))}
          </select>
          <input
            className="min-w-[10rem] flex-1 rounded-sm border border-grid px-3 py-2 text-sm"
            value={filterCode}
            onChange={(e) => setFilterCode(e.target.value)}
            placeholder={t('procurement.catalog.filterPoints')}
          />
        </div>
        <form className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={addPoint}>
          <label className="text-xs font-semibold text-stone-500">
            {t('procurement.catalog.pointCode')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 font-mono text-sm uppercase"
              value={pointCode}
              onChange={(e) => setPointCode(e.target.value)}
              placeholder="GEPTI"
            />
          </label>
          <label className="text-xs font-semibold text-stone-500 sm:col-span-1">
            {t('common.name')}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={pointName}
              onChange={(e) => setPointName(e.target.value)}
              placeholder="Poti"
            />
          </label>
          <label className="text-xs font-semibold text-stone-500">
            {t('procurement.catalog.pointKind')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-2 py-2 text-sm"
              value={pointKind}
              onChange={(e) => setPointKind(e.target.value as RoutePointKind)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`procurement.routeKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button type="submit" className="btn-add w-full">
              + {t('procurement.catalog.addPoint')}
            </button>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-2">
            {MODES.map((m) => (
              <label key={m} className="inline-flex items-center gap-1 text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={pointModes.includes(m)}
                  onChange={() => toggleMode(m)}
                />
                {t(`procurement.transport.${m}`)}
              </label>
            ))}
          </div>
        </form>
        <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto text-sm">
          {points.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-sm border border-grid px-3 py-2"
            >
              <span className="font-mono text-[11px] text-sky-800">{p.code}</span>
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] uppercase text-stone-600">
                {t(`procurement.routeKind.${p.kind}`)}
              </span>
              <span className="text-stone-800">{p.name}</span>
              <span className="text-[10px] text-stone-400">
                {p.transportModes.map((m) => t(`procurement.transport.${m}`)).join(', ')}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-red-600"
                onClick={() => void removePoint(p)}
              >
                {t('common.delete')}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

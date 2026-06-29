import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { WastewaterTransition, WastewaterTransitionPatch } from '@/lib/wastewater/transitions'
import type { WastewaterCube, WastewaterCubeStatus, WastewaterStore } from '@/lib/wastewater/types'
import {
  isWastewaterCubeArchived,
  WASTEWATER_CUBE_STATUSES,
} from '@/lib/wastewater/types'
import { formatQty } from '@/lib/warehouse/stock'
import {
  isWastewaterCubeNumberTaken,
  nextWastewaterCubeNumber,
  parseWastewaterCubeNumber,
} from '@/lib/wastewater/init'
import { WastewaterCubeModal } from './WastewaterCubeModal'
import { WastewaterCubeLabelModal } from './WastewaterCubeLabelModal'
import { WastewaterStatusBadge } from './WastewaterStatusBadge'

type ListFilter = 'active' | 'archive' | 'all'

type Props = {
  store: WastewaterStore
  site?: string
  operatorName?: string
  onCreate: (input: {
    wasteType: string
    color: string
    locationNote?: string
    fillStartDate?: string
    note?: string
    createdByName?: string
    cubeNumber?: number
  }) => void
  onSave: (cube: WastewaterCube) => void
  onTransition: (
    id: string,
    action: WastewaterTransition,
    patch: WastewaterTransitionPatch,
  ) => { ok: boolean; error?: string }
  onRemove: (id: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export function WastewaterCubesPanel({
  store,
  site,
  operatorName,
  onCreate,
  onSave,
  onTransition,
  onRemove,
}: Props) {
  const { t, tf } = useI18n()
  const [listFilter, setListFilter] = useState<ListFilter>('active')
  const [statusFilter, setStatusFilter] = useState<WastewaterCubeStatus | ''>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<WastewaterCube | null>(null)
  const [labelCube, setLabelCube] = useState<WastewaterCube | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newType, setNewType] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  const suggestedNumber = useMemo(() => nextWastewaterCubeNumber(store), [store])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...store.cubes]
      .filter((c) => {
        if (listFilter === 'active') return !isWastewaterCubeArchived(c)
        if (listFilter === 'archive') return isWastewaterCubeArchived(c)
        return true
      })
      .filter((c) => !statusFilter || c.status === statusFilter)
      .filter((c) => {
        if (!q) return true
        const hay = [
          String(c.cubeNumber),
          c.internalCode,
          c.wasteType,
          c.color,
          c.locationNote,
          c.note,
          c.usageNote,
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => b.cubeNumber - a.cubeNumber)
  }, [store.cubes, listFilter, statusFilter, search])

  const activeCount = store.cubes.filter((c) => !isWastewaterCubeArchived(c)).length

  function submitCreate() {
    if (!newType.trim() || !newColor.trim()) return
    const parsed = newNumber.trim() ? parseWastewaterCubeNumber(newNumber) : null
    if (newNumber.trim() && parsed == null) {
      setCreateError(t('wastewater.err.number_required'))
      return
    }
    if (parsed != null && isWastewaterCubeNumberTaken(store, parsed)) {
      setCreateError(t('wastewater.err.duplicate_number'))
      return
    }
    onCreate({
      wasteType: newType,
      color: newColor,
      locationNote: newLocation || undefined,
      fillStartDate: todayIso(),
      createdByName: operatorName,
      cubeNumber: parsed ?? undefined,
    })
    setNewType('')
    setNewColor('')
    setNewLocation('')
    setNewNumber('')
    setCreateError(null)
    setCreateOpen(false)
  }

  return (
    <div className="space-y-4">
      <Card title={t('wastewater.title')} description={t('wastewater.hint')}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <FormField label={t('journals.search')} className="min-w-[180px] flex-1">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('wastewater.searchPh')}
            />
          </FormField>
          <FormField label={t('wastewater.filterList')}>
            <select
              className="fc-input"
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value as ListFilter)}
            >
              <option value="active">{t('wastewater.filterActive')}</option>
              <option value="archive">{t('wastewater.filterArchive')}</option>
              <option value="all">{t('wastewater.filterAll')}</option>
            </select>
          </FormField>
          <FormField label={t('wastewater.col.status')}>
            <select
              className="fc-input"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter((e.target.value || '') as WastewaterCubeStatus | '')
              }
            >
              <option value="">{t('wastewater.filterAnyStatus')}</option>
              {WASTEWATER_CUBE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`wastewater.status.${s}`)}
                </option>
              ))}
            </select>
          </FormField>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + {t('wastewater.addCube')}
          </Button>
        </div>

        {createOpen && (
          <div className="mb-4 rounded-sm border border-sky-200 bg-sky-50/40 p-4">
            <p className="mb-3 text-sm font-semibold text-ink">{t('wastewater.createTitle')}</p>
            {createError && (
              <p className="mb-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {createError}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <FormField label={t('wastewater.col.number')}>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={newNumber}
                  onChange={(e) => {
                    setNewNumber(e.target.value)
                    setCreateError(null)
                  }}
                  placeholder={String(suggestedNumber)}
                />
                <span className="mt-1 block text-[10px] text-stone-500">
                  {t('wastewater.numberAutoHint')}
                </span>
              </FormField>
              <FormField label={t('wastewater.col.wasteType')}>
                <Input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder={t('wastewater.ph.wasteType')}
                  autoFocus
                />
              </FormField>
              <FormField label={t('wastewater.col.color')}>
                <Input
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  placeholder={t('wastewater.ph.color')}
                />
              </FormField>
              <FormField label={t('wastewater.col.location')}>
                <Input
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  placeholder={t('wastewater.ph.location')}
                />
              </FormField>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={!newType.trim() || !newColor.trim()}
                onClick={submitCreate}
              >
                {t('wastewater.addCube')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-500">{t('wastewater.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th className="w-12">{t('wastewater.col.number')}</th>
                  <th className="w-24">{t('warehouse.col.internalCode')}</th>
                  <th>{t('wastewater.col.wasteType')}</th>
                  <th>{t('wastewater.col.color')}</th>
                  <th className="text-right">{t('wastewater.col.mass')}</th>
                  <th>{t('wastewater.col.fillStart')}</th>
                  <th>{t('wastewater.col.fillEnd')}</th>
                  <th>{t('wastewater.col.status')}</th>
                  <th>{t('wastewater.col.location')}</th>
                  <th>{t('wastewater.col.dryResidue')}</th>
                  <th>{t('wastewater.col.usageNote')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={
                      isWastewaterCubeArchived(c) ? 'text-stone-500' : 'cursor-pointer hover:bg-stone-50'
                    }
                    onClick={() => setSelected(c)}
                  >
                    <td className="font-mono font-semibold">{c.cubeNumber}</td>
                    <td className="font-mono text-xs">{c.internalCode || '—'}</td>
                    <td>{c.wasteType || '—'}</td>
                    <td>{c.color || '—'}</td>
                    <td className="text-right tabular-nums">
                      {c.massKg != null ? `${formatQty(c.massKg)}` : '—'}
                    </td>
                    <td className="whitespace-nowrap">{formatDate(c.fillStartDate)}</td>
                    <td className="whitespace-nowrap">{formatDate(c.fillEndDate)}</td>
                    <td>
                      <WastewaterStatusBadge status={c.status} />
                    </td>
                    <td className="max-w-[140px] truncate">{c.locationNote ?? '—'}</td>
                    <td className="text-right tabular-nums">
                      {c.dryResiduePct != null ? `${c.dryResiduePct}%` : '—'}
                    </td>
                    <td className="max-w-[160px] truncate">{c.usageNote ?? '—'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setLabelCube(c)
                          }}
                        >
                          {t('wastewater.labelShort')}
                        </Button>
                        <Button variant="secondary" size="xs" type="button">
                          {t('common.edit')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-stone-500">
          {tf('wastewater.footerActive', { n: String(activeCount) })}
        </p>
      </Card>

      {selected && (
        <WastewaterCubeModal
          cube={selected}
          allCubes={store.cubes}
          site={site}
          operatorName={operatorName}
          onClose={() => setSelected(null)}
          onSave={onSave}
          onTransition={onTransition}
          onRemove={(id) => {
            onRemove(id)
            setSelected(null)
          }}
        />
      )}

      {labelCube && (
        <WastewaterCubeLabelModal
          cube={labelCube}
          site={site}
          onClose={() => setLabelCube(null)}
        />
      )}
    </div>
  )
}

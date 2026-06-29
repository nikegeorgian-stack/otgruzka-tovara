import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import {
  availableWastewaterTransitions,
  type WastewaterTransition,
  type WastewaterTransitionPatch,
} from '@/lib/wastewater/transitions'
import { isWastewaterCubeNumberTaken, parseWastewaterCubeNumber } from '@/lib/wastewater/init'
import type { WastewaterCube } from '@/lib/wastewater/types'
import { isWastewaterCubeArchived, isWastewaterCubeNumberEditable } from '@/lib/wastewater/types'
import { formatQty } from '@/lib/warehouse/stock'
import { WastewaterCubeLabelModal } from './WastewaterCubeLabelModal'
import { WastewaterStatusBadge } from './WastewaterStatusBadge'

type Props = {
  cube: WastewaterCube | null
  allCubes: WastewaterCube[]
  site?: string
  operatorName?: string
  onClose: () => void
  onSave: (cube: WastewaterCube) => void
  onTransition: (
    id: string,
    action: WastewaterTransition,
    patch: WastewaterTransitionPatch,
  ) => { ok: boolean; error?: string }
  onRemove?: (id: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function WastewaterCubeModal({
  cube,
  allCubes,
  site,
  operatorName,
  onClose,
  onSave,
  onTransition,
  onRemove,
}: Props) {
  const { t, tf } = useI18n()
  const [draft, setDraft] = useState<WastewaterCube | null>(cube)
  const [cubeNumberInput, setCubeNumberInput] = useState('')
  const [labelOpen, setLabelOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(cube)
    setCubeNumberInput(cube ? String(cube.cubeNumber) : '')
    setError(null)
  }, [cube])

  const transitions = useMemo(
    () => (draft ? availableWastewaterTransitions(draft.status) : []),
    [draft],
  )

  if (!draft) return null

  const archived = isWastewaterCubeArchived(draft)
  const numberEditable = isWastewaterCubeNumberEditable(draft)

  function patch(p: Partial<WastewaterCube>) {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }

  function saveMeta() {
    if (!draft) return
    let cubeNumber = draft.cubeNumber
    if (numberEditable) {
      const parsed = parseWastewaterCubeNumber(cubeNumberInput)
      if (parsed == null) {
        setError(t('wastewater.err.number_required'))
        return
      }
      const storeLike = { cubes: allCubes, nextCubeNumber: 1 }
      if (isWastewaterCubeNumberTaken(storeLike, parsed, draft.id)) {
        setError(t('wastewater.err.duplicate_number'))
        return
      }
      cubeNumber = parsed
    }
    onSave({ ...draft, cubeNumber, updatedAt: new Date().toISOString() })
    onClose()
  }

  function runTransition(action: WastewaterTransition) {
    if (!draft) return
    const patchBody: WastewaterTransitionPatch = {
      massKg: draft.massKg,
      fillEndDate: draft.fillEndDate,
      locationNote: draft.locationNote,
      dryResiduePct: draft.dryResiduePct,
      usageNote: draft.usageNote,
      usedFromDate: draft.usedFromDate,
      usedToDate: draft.usedToDate,
      usedMassKg: draft.usedMassKg,
      note: draft.note,
    }
    if (action === 'finish_filling' && !draft.fillEndDate) {
      patchBody.fillEndDate = todayIso()
    }
    const result = onTransition(draft.id, action, patchBody)
    if (!result.ok) {
      setError(t(`wastewater.err.${result.error ?? 'unknown'}`))
      return
    }
    setError(null)
    onClose()
  }

  const transitionLabels: Record<WastewaterTransition, string> = {
    finish_filling: t('wastewater.action.finishFilling'),
    to_drain_zone: t('wastewater.action.toDrainZone'),
    start_use: t('wastewater.action.startUse'),
    mark_used: t('wastewater.action.markUsed'),
    mark_unsuitable: t('wastewater.action.markUnsuitable'),
    restore_active: t('wastewater.action.restoreActive'),
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={tf('wastewater.modalTitle', {
        n: cubeNumberInput.trim() || String(draft.cubeNumber),
      })}
      subtitle={draft.wasteType || t('wastewater.newCube')}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {onRemove && !archived ? (
            <Button variant="ghost" onClick={() => onRemove(draft.id)}>
              {t('common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setLabelOpen(true)}>
              {t('wastewater.labelPrint')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={saveMeta}>
              {archived && !numberEditable ? t('common.close') : t('common.save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <WastewaterStatusBadge status={draft.status} />
          {operatorName && (
            <span className="text-xs text-stone-500">
              {draft.createdByName ?? operatorName}
            </span>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t('wastewater.col.number')}>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={cubeNumberInput}
              disabled={!numberEditable}
              onChange={(e) => setCubeNumberInput(e.target.value)}
            />
            {!numberEditable ? (
              <span className="mt-1 block text-[10px] text-stone-500">
                {t('wastewater.numberLockedHint')}
              </span>
            ) : null}
          </FormField>
          <FormField label={t('warehouse.col.internalCode')}>
            <Input value={draft.internalCode} readOnly className="font-mono" />
          </FormField>
          <FormField label={t('wastewater.col.wasteType')}>
            <Input
              value={draft.wasteType}
              disabled={archived}
              onChange={(e) => patch({ wasteType: e.target.value })}
              placeholder={t('wastewater.ph.wasteType')}
            />
          </FormField>
          <FormField label={t('wastewater.col.color')}>
            <Input
              value={draft.color}
              disabled={archived}
              onChange={(e) => patch({ color: e.target.value })}
              placeholder={t('wastewater.ph.color')}
            />
          </FormField>
          <FormField label={t('wastewater.col.location')}>
            <Input
              value={draft.locationNote ?? ''}
              disabled={archived}
              onChange={(e) => patch({ locationNote: e.target.value || undefined })}
              placeholder={t('wastewater.ph.location')}
            />
          </FormField>
          <FormField label={t('wastewater.col.mass')}>
            <Input
              type="number"
              min={0}
              step={1}
              disabled={archived}
              value={draft.massKg ?? ''}
              onChange={(e) =>
                patch({ massKg: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </FormField>
          <FormField label={t('wastewater.col.fillStart')}>
            <Input
              type="date"
              disabled={archived}
              value={draft.fillStartDate ?? ''}
              onChange={(e) => patch({ fillStartDate: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('wastewater.col.fillEnd')}>
            <Input
              type="date"
              disabled={archived}
              value={draft.fillEndDate ?? ''}
              onChange={(e) => patch({ fillEndDate: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('wastewater.col.dryResidue')}>
            <Input
              type="number"
              min={0}
              step={0.01}
              disabled={archived}
              value={draft.dryResiduePct ?? ''}
              onChange={(e) =>
                patch({
                  dryResiduePct: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </FormField>
          <FormField label={t('wastewater.col.usedMass')}>
            <Input
              type="number"
              min={0}
              step={1}
              disabled={archived}
              value={draft.usedMassKg ?? ''}
              onChange={(e) =>
                patch({ usedMassKg: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </FormField>
          <FormField label={t('wastewater.col.usedFrom')}>
            <Input
              type="date"
              disabled={archived}
              value={draft.usedFromDate ?? ''}
              onChange={(e) => patch({ usedFromDate: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('wastewater.col.usedTo')}>
            <Input
              type="date"
              disabled={archived}
              value={draft.usedToDate ?? ''}
              onChange={(e) => patch({ usedToDate: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t('wastewater.col.usageNote')} className="sm:col-span-2">
            <Input
              value={draft.usageNote ?? ''}
              disabled={archived}
              onChange={(e) => patch({ usageNote: e.target.value || undefined })}
              placeholder={t('wastewater.ph.usageNote')}
            />
          </FormField>
          <FormField label={t('wastewater.col.note')} className="sm:col-span-2">
            <Input
              value={draft.note ?? ''}
              disabled={archived}
              onChange={(e) => patch({ note: e.target.value || undefined })}
            />
          </FormField>
        </div>

        {draft.massKg != null && (
          <p className="text-sm text-stone-600">
            {t('wastewater.summaryMass')}:{' '}
            <span className="font-semibold tabular-nums">{formatQty(draft.massKg)} кг</span>
          </p>
        )}

        {transitions.length > 0 && (
          <div className="rounded-sm border border-grid bg-stone-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
              {t('wastewater.actionsTitle')}
            </p>
            <div className="flex flex-wrap gap-2">
              {transitions.map((action) => (
                <Button
                  key={action}
                  variant={
                    action === 'mark_unsuitable'
                      ? 'ghost'
                      : action === 'restore_active'
                        ? 'primary'
                        : 'secondary'
                  }
                  size="sm"
                  onClick={() => runTransition(action)}
                >
                  {transitionLabels[action]}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {labelOpen && (
        <WastewaterCubeLabelModal
          cube={draft}
          site={site}
          onClose={() => setLabelOpen(false)}
        />
      )}
    </AppDialog>
  )
}

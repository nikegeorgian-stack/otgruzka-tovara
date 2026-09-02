import { useEffect, useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import {
  attachmentValueFromContract,
  contractFieldsFromAttachment,
  HrAttachmentField,
} from '@/components/hr/HrAttachmentField'
import { HrPositionSelect } from '@/components/hr/HrPositionSelect'
import { useI18n } from '@/context/I18nContext'
import { newId } from '@/lib/hr/files'
import { employmentAgreementLabel, hrContractLabel } from '@/lib/hr/labels'
import type {
  EmploymentAgreementKind,
  HrContractType,
  HrEmploymentContract,
  HrEmploymentContractStatus,
  HrPosition,
  HrStructuralUnit,
} from '@/lib/hr/types'

type Props = {
  open: boolean
  initial?: HrEmploymentContract | null
  defaultPosition?: string
  defaultPositionKa?: string
  defaultPositionId?: string
  defaultSalary?: number
  hrPositions: HrPosition[]
  hrStructuralUnits: HrStructuralUnit[]
  onUpsertPosition?: (p: HrPosition) => void
  onClose: () => void
  onSave: (contract: HrEmploymentContract) => void
}

const fieldClass =
  'mt-0.5 w-full rounded-md border border-stone-200 bg-white px-2.5 py-2 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600/25'

const CURRENCIES: HrPosition['currency'][] = ['GEL', 'USD', 'RUB']
const CONTRACT_TYPES: HrContractType[] = ['full_time', 'part_time', 'temporary', 'internship']

function blank(defaults: {
  position?: string
  positionKa?: string
  positionId?: string
  salary?: number
}): HrEmploymentContract {
  return {
    id: newId(),
    isPrimary: true,
    status: 'active',
    position: defaults.position ?? '',
    positionKa: defaults.positionKa,
    positionId: defaults.positionId,
    contractNumber: '',
    effectiveDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    term: '',
    agreementKind: 'permanent',
    contractType: 'full_time',
    salary: defaults.salary,
    laborRegistry: '',
    documentUrl: '',
    documentFileName: undefined,
    documentUrls: [],
    bonusThirteenth: undefined,
    hasBonusThirteenth: false,
    hasInsurance: false,
    note: '',
  }
}

function bonusChecked(c: HrEmploymentContract): boolean {
  if (c.hasBonusThirteenth === true) return true
  if (c.hasBonusThirteenth === false) return false
  return Boolean(c.bonusThirteenth?.trim())
}

/** Окно создания / правки трудового договора. */
export function HrContractEditDialog({
  open,
  initial,
  defaultPosition,
  defaultPositionKa,
  defaultPositionId,
  defaultSalary,
  hrPositions,
  hrStructuralUnits,
  onUpsertPosition,
  onClose,
  onSave,
}: Props) {
  const { t, locale } = useI18n()
  const [form, setForm] = useState<HrEmploymentContract>(() =>
    blank({
      position: defaultPosition,
      positionKa: defaultPositionKa,
      positionId: defaultPositionId,
      salary: defaultSalary,
    }),
  )
  const [error, setError] = useState<string | null>(null)
  const [addPosOpen, setAddPosOpen] = useState(false)
  const [posForm, setPosForm] = useState({
    title: '',
    structuralUnitId: '',
    rank: '',
    qualificationClass: '',
    salary: 0,
    currency: 'GEL' as HrPosition['currency'],
    contractType: 'full_time' as HrContractType,
    schedule: '',
  })
  const [posError, setPosError] = useState<string | null>(null)

  const activeUnits = useMemo(
    () =>
      [...hrStructuralUnits]
        .filter((u) => !u.archived)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
    [hrStructuralUnits],
  )

  useEffect(() => {
    if (!open) return
    setError(null)
    setAddPosOpen(false)
    setForm(
      initial
        ? {
            ...initial,
            hasBonusThirteenth: bonusChecked(initial),
            hasInsurance: Boolean(initial.hasInsurance),
          }
        : blank({
            position: defaultPosition,
            positionKa: defaultPositionKa,
            positionId: defaultPositionId,
            salary: defaultSalary,
          }),
    )
  }, [
    open,
    initial?.id,
    defaultPosition,
    defaultPositionKa,
    defaultPositionId,
    defaultSalary,
  ])

  function patch(partial: Partial<HrEmploymentContract>) {
    setForm((f) => ({ ...f, ...partial }))
  }

  function applyPositionId(positionId: string) {
    if (!positionId) {
      patch({ positionId: undefined })
      return
    }
    const p = hrPositions.find((x) => x.id === positionId)
    if (!p) return
    patch({
      positionId: p.id,
      position: p.title,
      salary: p.salary > 0 ? p.salary : form.salary,
      contractType: p.contractType || form.contractType,
    })
  }

  function openAddPosition() {
    setPosError(null)
    setPosForm({
      title: form.position || '',
      structuralUnitId: activeUnits[0]?.id ?? '',
      rank: '',
      qualificationClass: '',
      salary: form.salary ?? 0,
      currency: 'GEL',
      contractType: form.contractType ?? 'full_time',
      schedule: '',
    })
    setAddPosOpen(true)
  }

  function saveNewPosition() {
    if (!onUpsertPosition) return
    const title = posForm.title.trim()
    const unit = activeUnits.find((u) => u.id === posForm.structuralUnitId)
    if (!title) {
      setPosError(t('orgStructure.err.positionTitle'))
      return
    }
    if (!unit) {
      setPosError(t('orgStructure.err.unitRequired'))
      return
    }
    const created: HrPosition = {
      id: newId(),
      title,
      structuralUnitId: unit.id,
      department: unit.name,
      rank: posForm.rank.trim() || undefined,
      qualificationClass: posForm.qualificationClass.trim() || undefined,
      grade: posForm.rank.trim() || undefined,
      salary: posForm.salary,
      currency: posForm.currency,
      contractType: posForm.contractType,
      schedule: posForm.schedule.trim() || undefined,
    }
    onUpsertPosition(created)
    patch({
      positionId: created.id,
      position: created.title,
      salary: created.salary > 0 ? created.salary : form.salary,
      contractType: created.contractType,
    })
    setAddPosOpen(false)
  }

  function submit() {
    if (!form.position.trim()) {
      setError(t('hr.contract.err.position'))
      return
    }
    const attach = contractFieldsFromAttachment(attachmentValueFromContract(form))
    const has13 = Boolean(form.hasBonusThirteenth)
    onSave({
      ...form,
      position: form.position.trim(),
      positionKa: form.positionKa?.trim() || undefined,
      positionId: form.positionId || undefined,
      contractNumber: form.contractNumber?.trim() || undefined,
      effectiveDate: form.effectiveDate || undefined,
      endDate: form.endDate || undefined,
      term: form.term?.trim() || undefined,
      laborRegistry: form.laborRegistry?.trim() || undefined,
      ...attach,
      hasBonusThirteenth: has13,
      bonusThirteenth: has13
        ? form.bonusThirteenth?.trim() || 'да'
        : undefined,
      hasInsurance: Boolean(form.hasInsurance),
      note: form.note?.trim() || undefined,
      salary:
        form.salary != null && Number.isFinite(form.salary) && form.salary > 0
          ? form.salary
          : undefined,
    })
  }

  const attachValue = attachmentValueFromContract(form)

  return (
    <>
      <AppDialog
        open={open}
        onClose={onClose}
        title={initial ? t('hr.contract.editTitle') : t('hr.contract.addTitle')}
        subtitle={t('hr.contract.formHint')}
        size="lg"
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={onClose}>
              {t('planner.cancel')}
            </Button>
            <Button size="sm" type="button" onClick={submit}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 px-1 py-1">
          {error && <p className="text-sm font-medium text-red-700">{error}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label className="min-w-0 flex-1 text-[11px] font-medium text-stone-500">
                  {t('hr.contract.col.position')} *
                  {hrPositions.some((p) => !p.archived) ? (
                    <HrPositionSelect
                      units={hrStructuralUnits}
                      positions={hrPositions}
                      value={form.positionId ?? ''}
                      className={fieldClass}
                      onChange={applyPositionId}
                    />
                  ) : (
                    <input
                      className={fieldClass}
                      value={form.position}
                      onChange={(e) =>
                        patch({ position: e.target.value, positionId: undefined })
                      }
                    />
                  )}
                </label>
                {onUpsertPosition && (
                  <button
                    type="button"
                    className="mb-0.5 shrink-0 rounded-md border border-stone-200 px-3 py-2 text-xs font-semibold hover:bg-stone-50"
                    onClick={openAddPosition}
                  >
                    {t('hr.contract.addPosition')}
                  </button>
                )}
              </div>
              {form.positionId && (
                <p className="mt-1 text-[11px] text-stone-400">
                  {form.position}
                  {form.salary != null ? ` · ${form.salary} ₾` : ''}
                </p>
              )}
              {!form.positionId && hrPositions.some((p) => !p.archived) && (
                <label className="mt-2 block text-[11px] font-medium text-stone-500">
                  {t('hr.contract.positionManual')}
                  <input
                    className={fieldClass}
                    value={form.position}
                    onChange={(e) => patch({ position: e.target.value })}
                  />
                </label>
              )}
            </div>

            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.positionKa')}
              <input
                className={fieldClass}
                value={form.positionKa ?? ''}
                onChange={(e) => patch({ positionKa: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.col.number')}
              <input
                className={fieldClass}
                value={form.contractNumber ?? ''}
                onChange={(e) => patch({ contractNumber: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.col.effective')}
              <input
                type="date"
                className={fieldClass}
                value={form.effectiveDate ?? ''}
                onChange={(e) => patch({ effectiveDate: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.col.expires')}
              <input
                type="date"
                className={fieldClass}
                value={form.endDate ?? ''}
                onChange={(e) => patch({ endDate: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.col.term')}
              <input
                className={fieldClass}
                value={form.term ?? ''}
                placeholder={t('hr.contract.termPh')}
                onChange={(e) => patch({ term: e.target.value })}
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.agreementKind')}
              <select
                className={fieldClass}
                value={form.agreementKind ?? ''}
                onChange={(e) =>
                  patch({
                    agreementKind:
                      e.target.value === ''
                        ? undefined
                        : (e.target.value as EmploymentAgreementKind),
                  })
                }
              >
                <option value="">—</option>
                <option value="permanent">{employmentAgreementLabel('permanent', locale)}</option>
                <option value="fixed_term">{employmentAgreementLabel('fixed_term', locale)}</option>
              </select>
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.type')}
              <select
                className={fieldClass}
                value={form.contractType ?? 'full_time'}
                onChange={(e) => patch({ contractType: e.target.value as HrContractType })}
              >
                {CONTRACT_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {hrContractLabel(k, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.status')}
              <select
                className={fieldClass}
                value={form.status ?? 'active'}
                onChange={(e) =>
                  patch({ status: e.target.value as HrEmploymentContractStatus })
                }
              >
                <option value="active">{t('hr.contract.status.active')}</option>
                <option value="pending">{t('hr.contract.status.pending')}</option>
                <option value="superseded">{t('hr.contract.status.superseded')}</option>
              </select>
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.salary')}
              <input
                type="number"
                min={0}
                className={fieldClass}
                value={form.salary ?? ''}
                onChange={(e) =>
                  patch({
                    salary: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="block text-[11px] font-medium text-stone-500">
              {t('hr.contract.laborRegistry')}
              <input
                className={fieldClass}
                value={form.laborRegistry ?? ''}
                onChange={(e) => patch({ laborRegistry: e.target.value })}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={Boolean(form.isPrimary)}
                onChange={(e) => patch({ isPrimary: e.target.checked })}
              />
              {t('hr.contract.setPrimary')}
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={Boolean(form.hasBonusThirteenth)}
                onChange={(e) => patch({ hasBonusThirteenth: e.target.checked })}
              />
              {t('hr.contract.bonus13')}
            </label>
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={Boolean(form.hasInsurance)}
                onChange={(e) => patch({ hasInsurance: e.target.checked })}
              />
              {t('hr.contract.insurance')}
            </label>
          </div>

          <HrAttachmentField
            value={attachValue}
            onChange={(next) => patch(contractFieldsFromAttachment(next))}
            hintKey="hr.contract.attachHint"
            allowMultiple
          />

          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.contract.note')}
            <textarea
              className={fieldClass}
              rows={2}
              value={form.note ?? ''}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </label>
        </div>
      </AppDialog>

      <AppDialog
        open={addPosOpen}
        onClose={() => setAddPosOpen(false)}
        title={t('orgStructure.addPosition')}
        size="md"
        footer={
          <div className="flex w-full justify-end gap-2">
            <Button variant="secondary" size="sm" type="button" onClick={() => setAddPosOpen(false)}>
              {t('planner.cancel')}
            </Button>
            <Button size="sm" type="button" onClick={saveNewPosition}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {posError && <p className="text-sm font-medium text-red-700 sm:col-span-2">{posError}</p>}
          <label className="block text-[11px] font-medium text-stone-500 sm:col-span-2">
            {t('orgStructure.col.title')} *
            <input
              className={fieldClass}
              value={posForm.title}
              onChange={(e) => setPosForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="block text-[11px] font-medium text-stone-500 sm:col-span-2">
            {t('orgStructure.unitName')} *
            <select
              className={fieldClass}
              value={posForm.structuralUnitId}
              onChange={(e) => setPosForm((f) => ({ ...f, structuralUnitId: e.target.value }))}
            >
              <option value="">{t('orgStructure.chooseUnit')}</option>
              {activeUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('orgStructure.col.rank')}
            <input
              className={fieldClass}
              value={posForm.rank}
              onChange={(e) => setPosForm((f) => ({ ...f, rank: e.target.value }))}
            />
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('orgStructure.col.class')}
            <input
              className={fieldClass}
              value={posForm.qualificationClass}
              onChange={(e) =>
                setPosForm((f) => ({ ...f, qualificationClass: e.target.value }))
              }
            />
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.settings.salary')}
            <input
              type="number"
              className={fieldClass}
              value={posForm.salary || ''}
              onChange={(e) =>
                setPosForm((f) => ({ ...f, salary: parseFloat(e.target.value) || 0 }))
              }
            />
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.settings.currency')}
            <select
              className={fieldClass}
              value={posForm.currency}
              onChange={(e) =>
                setPosForm((f) => ({
                  ...f,
                  currency: e.target.value as HrPosition['currency'],
                }))
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.settings.contractType')}
            <select
              className={fieldClass}
              value={posForm.contractType}
              onChange={(e) =>
                setPosForm((f) => ({
                  ...f,
                  contractType: e.target.value as HrContractType,
                }))
              }
            >
              {CONTRACT_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`hr.contract.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium text-stone-500">
            {t('hr.settings.schedule')}
            <input
              className={fieldClass}
              value={posForm.schedule}
              onChange={(e) => setPosForm((f) => ({ ...f, schedule: e.target.value }))}
            />
          </label>
        </div>
      </AppDialog>
    </>
  )
}

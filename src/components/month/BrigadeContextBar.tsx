import { useMemo, useRef, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import { brigadeAllowsBrigadier } from '@/lib/brigadeHasBrigadier'
import { brigadeLabel } from '@/lib/brigadeText'
import { employeeActiveInMonth } from '@/lib/hr/employeeActive'
import type { AppStore, MonthSheet, ShiftTemplate } from '@/lib/types'
import type { CopyPlanToFactScope } from '@/lib/bulkOps'

type Props = {
  store: AppStore
  sheet: MonthSheet
  brigade: string
  mismatchCount: number
  readOnly: boolean
  readOnlyHint?: string
  shiftTemplates: ShiftTemplate[]
  onSetBrigadier: (brigade: string, employeeId: string | null) => void
  onFillBrigade: (brigade: string) => void
  onAddRow: (brigade: string) => void
  onRemoveEmptyRow: (brigade: string) => void
  onBulkHolidayV: () => void
  onBulkCopyPlanToFact: (scope: CopyPlanToFactScope, brigade?: string) => void
  onBulkCopyPlanToFactEmpty?: (scope: CopyPlanToFactScope, brigade?: string) => void
  onApplyShiftTemplate: (templateId: string, brigade: string) => void
  onManageBrigades: () => void
  onOpenPlanEditor: () => void
  onFillDay: () => void
  hideManageBrigades?: boolean
  /** Компактный режим: без дублей Перекличка/План (они в общей панели). */
  compact?: boolean
  /** Можно ставить сверку табеля бригады. */
  canSignoff?: boolean
  onSetBrigadeSignoff?: (brigade: string, verified: boolean) => void
}

export function BrigadeContextBar({
  store,
  sheet,
  brigade,
  mismatchCount,
  readOnly,
  readOnlyHint,
  shiftTemplates,
  onSetBrigadier,
  onFillBrigade,
  onAddRow,
  onRemoveEmptyRow,
  onBulkHolidayV,
  onBulkCopyPlanToFact,
  onBulkCopyPlanToFactEmpty,
  onApplyShiftTemplate,
  onManageBrigades,
  onOpenPlanEditor,
  onFillDay,
  hideManageBrigades = false,
  compact = false,
  canSignoff = false,
  onSetBrigadeSignoff,
}: Props) {
  const { t, locale, tf } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () => sheet.rows.filter((r) => r.brigade === brigade),
    [sheet.rows, brigade],
  )
  const brigadeRowCount = rows.length
  const emptyRowCount = rows.filter((r) => !r.employeeId).length
  const canRemoveEmpty = brigadeRowCount > 1 && emptyRowCount > 0
  const assignedCount = rows.filter((r) => r.employeeId).length
  const signoff = sheet.brigadeSignoffs?.[brigade]
  const verified = signoff?.verified === true

  const brigadierId = store.brigadiers?.[brigade] ?? ''
  const allowsBrigadier = brigadeAllowsBrigadier(store, brigade)
  const candidates = useMemo(() => {
    const candidateIds = new Set<string>()
    for (const r of rows) {
      if (r.employeeId) candidateIds.add(r.employeeId)
    }
    for (const e of store.employees) {
      if (employeeActiveInMonth(e, sheet.month) && e.brigade === brigade) {
        candidateIds.add(e.id)
      }
    }
    if (brigadierId) candidateIds.add(brigadierId)
    return store.employees
      .filter((e) => candidateIds.has(e.id))
      .sort((a, b) => employeeName(a, locale).localeCompare(employeeName(b, locale), 'ru'))
  }, [brigadierId, brigade, locale, rows, sheet.month, store.employees])

  const disabledTitle = readOnly ? (readOnlyHint ?? t('month.archivedReadOnly')) : undefined
  const [templateId, setTemplateId] = useState(shiftTemplates[0]?.id ?? '')

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <div className={`bw-context print:hidden ${compact ? 'bw-context--compact' : ''}`.trim()}>
      <div className="bw-context__title">
        {brigadeLabel(brigade, store.brigadeNamesKa, locale)}
        {mismatchCount > 0 ? (
          <span className="bw-context__warn" title={t('table.mismatch')}>
            {tf('month.workspace.mismatchBadge', { count: mismatchCount })}
          </span>
        ) : (
          <span className="bw-context__ok" title={t('stats.ok')}>
            ✓
          </span>
        )}
        <span className="bw-context__meta">{assignedCount}</span>
      </div>

      {canSignoff && onSetBrigadeSignoff ? (
        <label
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-xs font-medium ${
            verified
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-950'
          }`}
          title={
            verified && signoff?.byName
              ? tf('month.signoff.by', {
                  who: signoff.byName,
                  date: signoff.at.slice(0, 10),
                })
              : t('month.signoff.hint')
          }
        >
          <input
            type="checkbox"
            className="rounded-sm"
            checked={verified}
            onChange={(e) => onSetBrigadeSignoff(brigade, e.target.checked)}
          />
          {t('month.signoff.label')}
        </label>
      ) : verified ? (
        <span
          className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-800"
          title={
            signoff?.byName
              ? tf('month.signoff.by', {
                  who: signoff.byName,
                  date: signoff.at.slice(0, 10),
                })
              : undefined
          }
        >
          ✓ {t('month.signoff.done')}
        </span>
      ) : null}

      {!readOnly && allowsBrigadier ? (
        <label className="bw-context__field">
          <span className="bw-context__field-label">{t('table.brigadier')}</span>
          <select
            value={brigadierId}
            className="bw-context__select"
            onChange={(e) => onSetBrigadier(brigade, e.target.value || null)}
          >
            <option value="">{t('table.brigadierNone')}</option>
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {employeeName(e, locale)}
              </option>
            ))}
          </select>
        </label>
      ) : allowsBrigadier && brigadierId ? (
        <span className="bw-context__readonly">
          {t('table.brigadier')}:{' '}
          {(() => {
            const emp = store.employees.find((e) => e.id === brigadierId)
            return emp ? employeeName(emp, locale) : '—'
          })()}
        </span>
      ) : null}

      {!readOnly ? (
        <>
          <button
            type="button"
            className="bw-context__btn bw-context__btn--accent"
            onClick={() => onFillBrigade(brigade)}
            disabled={readOnly}
            title={disabledTitle ?? t('table.fillBrigadeHint')}
          >
            {t('table.fillBrigade')}
          </button>
          <button
            type="button"
            className="bw-context__btn"
            onClick={() => onAddRow(brigade)}
            title={t('table.addSlotHint')}
          >
            +
          </button>
          {canRemoveEmpty ? (
            <button
              type="button"
              className="bw-context__btn bw-context__btn--muted"
              onClick={() => onRemoveEmptyRow(brigade)}
              title={t('table.removeEmptySlotHint')}
            >
              −
            </button>
          ) : null}
        </>
      ) : null}

      {!compact ? (
        <button
          type="button"
          className="bw-context__btn bw-context__btn--primary"
          onClick={onFillDay}
          title={t('month.workspace.fillDayHint')}
        >
          {t('month.workspace.fillDay')}
        </button>
      ) : null}

      <div className="bw-context__spacer" />

      <div className="bw-context__menu-wrap" ref={menuRef}>
        <button
          type="button"
          className="bw-context__btn bw-context__btn--icon"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((o) => !o)}
          title={t('month.workspace.brigadeMenu')}
        >
          ⋯
        </button>
        {menuOpen ? (
          <>
            <button
              type="button"
              className="bw-context__menu-backdrop"
              aria-label={t('common.close')}
              onClick={closeMenu}
            />
            <div className="bw-context__menu" role="menu">
              {!compact ? (
                <button
                  type="button"
                  role="menuitem"
                  className="bw-context__menu-item"
                  onClick={() => {
                    closeMenu()
                    onOpenPlanEditor()
                  }}
                >
                  {t('month.planEditor')}
                </button>
              ) : null}
              {!readOnly ? (
                <div className="bw-context__menu-group">
                  <span className="bw-context__menu-label">{t('month.dangerOps')}</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="bw-context__menu-item"
                    title={t('month.copyPlanEmptyHint')}
                    onClick={() => {
                      closeMenu()
                      onBulkCopyPlanToFactEmpty?.('brigade', brigade)
                    }}
                    disabled={!onBulkCopyPlanToFactEmpty}
                  >
                    {t('month.copyPlanEmpty')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="bw-context__menu-item"
                    title={t('month.dangerOpsHint')}
                    onClick={() => {
                      closeMenu()
                      onBulkCopyPlanToFact('brigade', brigade)
                    }}
                  >
                    {t('month.bulkCopy')} → {t('month.fact')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="bw-context__menu-item"
                    title={t('month.bulkHolidayHint')}
                    onClick={() => {
                      closeMenu()
                      onBulkHolidayV()
                    }}
                  >
                    {t('month.bulkHoliday')}
                  </button>
                  {shiftTemplates.length > 0 ? (
                    <>
                      <select
                        className="bw-context__menu-select"
                        value={templateId}
                        onChange={(e) => setTemplateId(e.target.value)}
                      >
                        {shiftTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="bw-context__menu-item"
                        disabled={!templateId}
                        onClick={() => {
                          closeMenu()
                          if (templateId) onApplyShiftTemplate(templateId, brigade)
                        }}
                      >
                        {t('month.shiftTemplateApply')}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {!hideManageBrigades ? (
                <button
                  type="button"
                  role="menuitem"
                  className="bw-context__menu-item"
                  onClick={() => {
                    closeMenu()
                    onManageBrigades()
                  }}
                >
                  {t('month.brigadesManage')}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

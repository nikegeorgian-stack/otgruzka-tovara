import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { CopyPlanToFactScope } from '@/lib/bulkOps'
import { SCHEDULE_OPTIONS } from '@/lib/schedules'
import type { ShiftTemplate } from '@/lib/types'

type Props = {
  brigades: string[]
  shiftTemplates: ShiftTemplate[]
  search: string
  filterBrigade: string
  filterSchedule: string
  readOnly?: boolean
  readOnlyHint?: string
  onSearch: (v: string) => void
  onFilterSchedule: (v: string) => void
  onBulkHolidayV: () => void
  onBulkCopyPlanToFact: (scope: CopyPlanToFactScope, brigade?: string) => void
  onApplyShiftTemplate: (templateId: string, brigade: string) => void
  onExportExcel: () => void
  onShowHotkeys: () => void
  /** Поиск вынесен в панель виджетов */
  hideSearch?: boolean
}

export function MonthToolsBar({
  brigades,
  shiftTemplates,
  search,
  filterBrigade,
  filterSchedule,
  readOnly = false,
  readOnlyHint,
  onSearch,
  onFilterSchedule,
  onBulkHolidayV,
  onBulkCopyPlanToFact,
  onApplyShiftTemplate,
  onExportExcel,
  onShowHotkeys,
  hideSearch = false,
}: Props) {
  const { t } = useI18n()
  const [copyScope, setCopyScope] = useState<CopyPlanToFactScope>('all')
  const [templateId, setTemplateId] = useState(shiftTemplates[0]?.id ?? '')
  const [templateBrigade, setTemplateBrigade] = useState(filterBrigade || (brigades[0] ?? ''))
  const [dangerOpen, setDangerOpen] = useState(false)

  const disabledTitle = readOnly ? (readOnlyHint ?? t('month.archivedReadOnly')) : undefined

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-grid bg-white/90 px-3 py-2 text-sm shadow-sm">
      {!hideSearch ? (
        <input
          className="min-w-[10rem] flex-1 rounded-sm border border-grid px-2 py-1.5 text-sm"
          placeholder={t('month.searchEmployee')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      ) : null}
      <select
        className="rounded-sm border border-grid px-2 py-1.5 text-xs"
        value={filterSchedule}
        onChange={(e) => onFilterSchedule(e.target.value)}
      >
        <option value="">{t('month.allSchedules')}</option>
        {SCHEDULE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="rounded-sm border border-grid px-2 py-1.5 text-xs font-medium hover:bg-paper-dark"
        onClick={onExportExcel}
        title={t('month.exportExcelHint')}
      >
        {t('month.exportExcel')}
      </button>

      <button
        type="button"
        className="rounded-sm border border-grid px-2 py-1 text-xs text-stone-500 hover:bg-paper-dark"
        onClick={onShowHotkeys}
        title={t('hotkeys.title')}
      >
        ?
      </button>

      <div className="w-full basis-full">
        <button
          type="button"
          className="rounded-sm border border-amber-200 bg-amber-50/80 px-2 py-1 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setDangerOpen((v) => !v)}
          disabled={readOnly}
          title={disabledTitle ?? t('month.dangerOpsHint')}
          aria-expanded={dangerOpen}
        >
          {dangerOpen ? '▾' : '▸'} {t('month.dangerOps')}
        </button>

        {dangerOpen && !readOnly ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-amber-200 bg-amber-50/40 p-2">
            <p className="w-full text-[11px] text-amber-900/80">{t('month.dangerOpsHint')}</p>

            <div className="flex items-center gap-1 rounded-sm border border-violet-200 bg-violet-50 p-0.5">
              <select
                className="max-w-[9rem] rounded border-0 bg-transparent px-1.5 py-1 text-xs outline-none"
                value={copyScope}
                onChange={(e) => setCopyScope(e.target.value as CopyPlanToFactScope)}
              >
                <option value="all">{t('month.copyScopeAll')}</option>
                <option value="52">{t('month.copyScope52')}</option>
                <option value="22">{t('month.copyScope22')}</option>
                <option value="11">{t('month.copyScope11')}</option>
                {filterBrigade && (
                  <option value="brigade">{t('month.copyScopeBrigade')}</option>
                )}
              </select>
              <button
                type="button"
                className="rounded-sm border border-violet-200 bg-white px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() =>
                  onBulkCopyPlanToFact(
                    copyScope,
                    copyScope === 'brigade' ? filterBrigade : undefined,
                  )
                }
                disabled={copyScope === 'brigade' && !filterBrigade}
                title={t('month.bulkCopyHint')}
              >
                {t('month.bulkCopy')}
              </button>
            </div>

            <button
              type="button"
              className="rounded-sm border border-grid bg-white px-2 py-1.5 text-xs hover:bg-paper-dark"
              onClick={onBulkHolidayV}
              title={t('month.bulkHolidayHint')}
            >
              {t('month.bulkHoliday')}
            </button>

            {shiftTemplates.length > 0 && (
              <div className="flex items-center gap-1 rounded-sm border border-emerald-200 bg-emerald-50/60 p-0.5">
                <select
                  className="max-w-[8rem] rounded border-0 bg-transparent px-1.5 py-1 text-xs outline-none"
                  value={templateBrigade}
                  onChange={(e) => setTemplateBrigade(e.target.value)}
                >
                  {brigades.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <select
                  className="max-w-[10rem] rounded border-0 bg-transparent px-1.5 py-1 text-xs outline-none"
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  title={t('month.shiftTemplateHint')}
                >
                  {shiftTemplates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-sm border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() =>
                    templateId && templateBrigade && onApplyShiftTemplate(templateId, templateBrigade)
                  }
                  disabled={!templateId || !templateBrigade}
                  title={t('month.shiftTemplateHint')}
                >
                  {t('month.shiftTemplateApply')}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

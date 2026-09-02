import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import { brigadeLabel } from '@/lib/brigadeText'
import { brigadeAssignedCount, brigadeMismatchCount } from '@/lib/brigadeStats'
import type { AppStore, MonthSheet } from '@/lib/types'

type Props = {
  open: boolean
  onToggle: () => void
  onOpenFullEditor: () => void
  onCopyPlanToFact?: () => void
  store: AppStore
  sheet: MonthSheet
  /** Текущая вкладка бригады; null = «Все». */
  focusBrigade: string | null
  readOnly?: boolean
}

export function MonthPlanSidePanel({
  open,
  onToggle,
  onOpenFullEditor,
  onCopyPlanToFact,
  store,
  sheet,
  focusBrigade,
  readOnly = false,
}: Props) {
  const { t, tf, locale } = useI18n()

  const roster = useMemo(() => {
    const rows = focusBrigade
      ? sheet.rows.filter((r) => r.brigade === focusBrigade && r.employeeId)
      : sheet.rows.filter((r) => r.employeeId).slice(0, 12)
    return rows.map((row) => {
      const emp = store.employees.find((e) => e.id === row.employeeId)
      return {
        id: row.id,
        name: emp?.fullName ?? '—',
        schedule: emp?.schedule ?? '—',
      }
    })
  }, [focusBrigade, sheet.rows, store.employees])

  const assigned = focusBrigade
    ? brigadeAssignedCount(sheet, focusBrigade)
    : sheet.rows.filter((r) => r.employeeId).length

  const mismatches = focusBrigade
    ? brigadeMismatchCount(store, sheet, focusBrigade)
    : 0

  const brigadeTitle = focusBrigade
    ? brigadeLabel(focusBrigade, store.brigadeNamesKa, locale)
    : t('month.brigadesSelectAll')

  if (!open) {
    return (
      <button
        type="button"
        className="bw-plan-rail print:hidden"
        onClick={onToggle}
        title={t('month.workspace.planPanelOpen')}
      >
        <span className="bw-plan-rail__text">{t('month.plan')}</span>
      </button>
    )
  }

  return (
    <aside className="bw-plan-panel print:hidden" aria-label={t('month.planTitle')}>
      <header className="bw-plan-panel__head">
        <div>
          <h2 className="bw-plan-panel__title">{t('month.workspace.planHubTitle')}</h2>
          <p className="bw-plan-panel__subtitle">{t('month.workspace.planHubSubtitle')}</p>
        </div>
        <button
          type="button"
          className="bw-plan-panel__btn bw-plan-panel__btn--ghost"
          onClick={onToggle}
          title={t('month.workspace.planPanelClose')}
        >
          ×
        </button>
      </header>

      <div className="bw-plan-panel__body">
        <ol className="bw-plan-panel__steps">
          <li>
            <strong>{t('month.fact')}</strong>
            <span>{t('month.workspace.planHubFactStep')}</span>
          </li>
          <li>
            <strong>{t('month.plan')}</strong>
            <span>{t('month.workspace.planHubPlanStep')}</span>
          </li>
        </ol>

        <button
          type="button"
          className="bw-plan-panel__cta"
          onClick={() => {
            onOpenFullEditor()
            onToggle()
          }}
        >
          {t('month.workspace.planHubOpenEditor')}
        </button>
        <p className="bw-plan-panel__cta-hint">{t('month.planEditorHint')}</p>

        {onCopyPlanToFact && !readOnly ? (
          <button
            type="button"
            className="bw-plan-panel__secondary bw-plan-panel__secondary--danger"
            onClick={onCopyPlanToFact}
            title={t('month.deck.copyPlanDangerHint')}
          >
            {t('month.workspace.planHubCopyFact')}
          </button>
        ) : null}

        <section className="bw-plan-panel__roster">
          <div className="bw-plan-panel__roster-head">
            <h3>{brigadeTitle}</h3>
            <span>
              {tf('month.workspace.planHubAssigned', { count: assigned })}
            </span>
          </div>
          {focusBrigade && mismatches > 0 ? (
            <p className="bw-plan-panel__warn">
              {tf('month.workspace.mismatchBadge', { count: mismatches })}
              {' — '}
              {t('month.workspace.planHubMismatchHint')}
            </p>
          ) : null}
          {!focusBrigade ? (
            <p className="bw-plan-panel__empty">{t('month.workspace.planHubPickBrigade')}</p>
          ) : roster.length === 0 ? (
            <p className="bw-plan-panel__empty">{t('month.workspace.planHubEmptyRoster')}</p>
          ) : (
            <ul className="bw-plan-panel__list">
              {roster.map((r) => (
                <li key={r.id}>
                  <span className="bw-plan-panel__name">{r.name}</span>
                  <span className="bw-plan-panel__sched">{r.schedule}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  )
}

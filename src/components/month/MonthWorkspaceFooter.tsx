import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { CodeLegendBar } from './CodeLegendBar'
import { MonthKpiBar } from './MonthKpiBar'
import { MonthProblemsBar } from './MonthProblemsBar'
import type { AppStore, MonthSheet } from '@/lib/types'
import type { MonthStats } from '@/lib/stats'

type SectionId = 'kpi' | 'problems' | 'legend'

type Props = {
  store: AppStore
  sheet: MonthSheet
  stats: MonthStats
  problemCount: number
}

export function MonthWorkspaceFooter({ store, sheet, stats, problemCount }: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState<SectionId | null>(null)

  const summary = tf('workspace.chip.stats', {
    plan: stats.planHours,
    fact: stats.factHours,
    delta: stats.deviation,
  })

  function toggle(id: SectionId) {
    setOpen((prev) => (prev === id ? null : id))
  }

  return (
    <div className="bw-footer print:hidden">
      <div className="bw-footer__strip">
        <button
          type="button"
          className={`bw-footer__chip ${open === 'kpi' ? 'bw-footer__chip--on' : ''}`}
          onClick={() => toggle('kpi')}
        >
          KPI · {summary}
        </button>
        <button
          type="button"
          className={`bw-footer__chip ${problemCount > 0 ? 'bw-footer__chip--warn' : ''} ${open === 'problems' ? 'bw-footer__chip--on' : ''}`}
          onClick={() => toggle('problems')}
        >
          {problemCount > 0
            ? tf('workspace.chip.problems', { count: problemCount })
            : t('month.workspace.noProblems')}
        </button>
        <button
          type="button"
          className={`bw-footer__chip ${open === 'legend' ? 'bw-footer__chip--on' : ''}`}
          onClick={() => toggle('legend')}
        >
          {t('month.workspace.legend')}
        </button>
      </div>
      {open === 'kpi' ? (
        <div className="bw-footer__panel">
          <MonthKpiBar stats={stats} />
        </div>
      ) : null}
      {open === 'problems' ? (
        <div className="bw-footer__panel">
          <MonthProblemsBar store={store} sheet={sheet} />
        </div>
      ) : null}
      {open === 'legend' ? (
        <div className="bw-footer__panel">
          <CodeLegendBar />
        </div>
      ) : null}
    </div>
  )
}

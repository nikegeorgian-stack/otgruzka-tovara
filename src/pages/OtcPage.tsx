import { useEffect, useState } from 'react'
import { OtcAlkaliPanel } from '@/components/otc/OtcAlkaliPanel'
import { OtcDashboardPanel } from '@/components/otc/OtcDashboardPanel'
import { OtcDefectsPanel } from '@/components/otc/OtcDefectsPanel'
import { OtcLabTestsPanel } from '@/components/otc/OtcLabTestsPanel'
import { OtcNormsPanel } from '@/components/otc/OtcNormsPanel'
import { OtcSortingPanel } from '@/components/otc/OtcSortingPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import type {
  OtcDefectCase,
  OtcLabTest,
  OtcNorm,
  OtcSortingRecord,
  OtcStore,
} from '@/lib/otc/types'

type Tab = 'dash' | 'lab' | 'alkali' | 'sorting' | 'defects' | 'norms'

type Props = {
  store: OtcStore
  operatorName?: string
  onUpsertNorm: (entry: OtcNorm) => void
  onRemoveNorm: (id: string) => void
  onUpsertLabTest: (entry: Omit<OtcLabTest, 'computed' | 'id' | 'createdAt'>) => void
  onRemoveLabTest: (id: string) => void
  onUpsertAlkali: Parameters<typeof OtcAlkaliPanel>[0]['onSave']
  onRemoveAlkali: (id: string) => void
  onUpsertSorting: (entry: Omit<OtcSortingRecord, 'id' | 'createdAt'>) => void
  onRemoveSorting: (id: string) => void
  onUpsertDefect: (entry: Omit<OtcDefectCase, 'id' | 'createdAt'> & { id?: string }) => void
  onRemoveDefect: (id: string) => void
  focusTab?: Tab | null
  onFocusTabConsumed?: () => void
}

export function OtcPage({
  store,
  operatorName,
  onUpsertNorm,
  onRemoveNorm,
  onUpsertLabTest,
  onRemoveLabTest,
  onUpsertAlkali,
  onRemoveAlkali,
  onUpsertSorting,
  onRemoveSorting,
  onUpsertDefect,
  onRemoveDefect,
  focusTab,
  onFocusTabConsumed,
}: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('dash')

  useEffect(() => {
    if (!focusTab) return
    setTab(focusTab)
    onFocusTabConsumed?.()
  }, [focusTab, onFocusTabConsumed])

  const tabs = [
    { id: 'dash' as const, label: t('otc.tab.dash') },
    { id: 'lab' as const, label: t('otc.tab.lab') },
    { id: 'alkali' as const, label: t('otc.tab.alkali') },
    { id: 'sorting' as const, label: t('otc.tab.sorting') },
    { id: 'defects' as const, label: t('otc.tab.defects') },
    { id: 'norms' as const, label: t('otc.tab.norms') },
  ]

  return (
    <PageLayout>
      <PageHeader title={t('otc.title')} subtitle={t('otc.subtitle')} />
      <TabBar coachPrefix="otc" tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'dash' && <OtcDashboardPanel store={store} />}
      {tab === 'lab' && (
        <OtcLabTestsPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertLabTest}
          onRemove={onRemoveLabTest}
        />
      )}
      {tab === 'alkali' && (
        <OtcAlkaliPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertAlkali}
          onRemove={onRemoveAlkali}
        />
      )}
      {tab === 'sorting' && (
        <OtcSortingPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertSorting}
          onRemove={onRemoveSorting}
        />
      )}
      {tab === 'defects' && (
        <OtcDefectsPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertDefect}
          onRemove={onRemoveDefect}
        />
      )}
      {tab === 'norms' && (
        <OtcNormsPanel store={store} onSave={onUpsertNorm} onRemove={onRemoveNorm} />
      )}
    </PageLayout>
  )
}

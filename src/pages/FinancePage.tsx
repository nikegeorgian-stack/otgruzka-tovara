import { useState } from 'react'
import { PayrollPanel } from '@/components/hr/PayrollPanel'
import { FinanceRatesPanel } from '@/components/finance/FinanceRatesPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { SummaryPage } from '@/pages/SummaryPage'
import { useI18n } from '@/context/I18nContext'
import type { AppStore, Employee } from '@/lib/types'

export type FinanceSection = 'payroll' | 'rates' | 'summary'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  onSaveEmployee: (e: Employee) => void
  webFinanceMode?: boolean
  webUserName?: string
}

const TABS: { id: FinanceSection; labelKey: string }[] = [
  { id: 'payroll', labelKey: 'finance.tab.payroll' },
  { id: 'rates', labelKey: 'finance.tab.rates' },
  { id: 'summary', labelKey: 'finance.tab.summary' },
]

export function FinancePage({
  store,
  month,
  onMonthChange,
  onSaveEmployee,
  webFinanceMode,
  webUserName,
}: Props) {
  const { t, tf } = useI18n()
  const [section, setSection] = useState<FinanceSection>('payroll')

  return (
    <PageLayout>
      <PageHeader
        badge={webFinanceMode ? t('web.finance.badge') : t('finance.badge')}
        title={
          webFinanceMode && webUserName
            ? tf('web.finance.welcome', { name: webUserName })
            : t('finance.title')
        }
        subtitle={webFinanceMode ? t('web.finance.subtitle') : t('finance.subtitle')}
      />

      <TabBar
        tabs={TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
        value={section}
        onChange={setSection}
      />

      {section === 'payroll' && (
        <PayrollPanel store={store} month={month} onMonthChange={onMonthChange} />
      )}

      {section === 'rates' && (
        <FinanceRatesPanel employees={store.employees} onSaveEmployee={onSaveEmployee} />
      )}

      {section === 'summary' && <SummaryPage store={store} />}
    </PageLayout>
  )
}

import { useEffect, useState } from 'react'
import { PayrollStatementPanel } from '@/components/finance/PayrollStatementPanel'
import { SickConfirmPanel } from '@/components/finance/SickConfirmPanel'
import { EmployeeLedgerPanel } from '@/components/finance/EmployeeLedgerPanel'
import { FinanceRatesPanel } from '@/components/finance/FinanceRatesPanel'
import { FinanceDashboardPanel } from '@/components/finance/FinanceDashboardPanel'
import { FinancePaymentsJournalPanel } from '@/components/finance/FinancePaymentsJournalPanel'
import { OrgStructureDirectoryPanel } from '@/components/directories/OrgStructureDirectoryPanel'
import type { FinanceActions } from '@/components/finance/financeTypes'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { SummaryPage } from '@/pages/SummaryPage'
import { useI18n } from '@/context/I18nContext'
import type { AppStore, Employee, HrPosition, HrStructuralUnit } from '@/lib/types'
import { FinanceViewDefaultsDialog } from '@/components/finance/FinanceViewDefaultsDialog'
import { PageActionOverflow } from '@/components/ui/PageActionOverflow'
import type { FinanceViewDefaults, UserViewDefaults } from '@/lib/viewDefaults/types'

export type FinanceSection =
  | 'dashboard'
  | 'statement'
  | 'payments'
  | 'sick'
  | 'ledger'
  | 'rates'
  | 'employees'
  | 'org'
  | 'summary'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  onSaveEmployee: (e: Employee) => void
  onRemoveEmployee: (id: string) => void
  brigades: string[]
  hrStructuralUnits: HrStructuralUnit[]
  hrPositions: HrPosition[]
  onUpsertPosition: (p: HrPosition) => void
  onRemovePosition: (id: string) => void
  onUpsertStructuralUnit: (u: HrStructuralUnit) => void
  onRemoveStructuralUnit: (id: string) => void
  onImportOrgStructureFromSeed: () => void
  actions: FinanceActions
  webFinanceMode?: boolean
  webUserName?: string
  userFinanceDefaults?: FinanceViewDefaults
  currentUserId?: string
  onSaveViewDefaults?: <K extends keyof UserViewDefaults>(
    viewId: K,
    patch: NonNullable<UserViewDefaults[K]>,
  ) => void
}

const CORE_TABS: { id: FinanceSection; labelKey: string }[] = [
  { id: 'dashboard', labelKey: 'finance.tab.dashboard' },
  { id: 'statement', labelKey: 'finance.tab.statement' },
  { id: 'payments', labelKey: 'finance.tab.payments' },
  { id: 'sick', labelKey: 'finance.tab.sick' },
  { id: 'ledger', labelKey: 'finance.tab.ledger' },
  { id: 'rates', labelKey: 'finance.tab.rates' },
  { id: 'employees', labelKey: 'finance.tab.employees' },
  { id: 'org', labelKey: 'finance.tab.org' },
  { id: 'summary', labelKey: 'finance.tab.summary' },
]

export function FinancePage({
  store,
  month,
  onMonthChange,
  onSaveEmployee,
  onRemoveEmployee,
  brigades,
  hrStructuralUnits,
  hrPositions,
  onUpsertPosition,
  onRemovePosition,
  onUpsertStructuralUnit,
  onRemoveStructuralUnit,
  onImportOrgStructureFromSeed,
  actions,
  webFinanceMode,
  webUserName,
  userFinanceDefaults,
  currentUserId,
  onSaveViewDefaults,
}: Props) {
  const { t, tf } = useI18n()
  const [section, setSection] = useState<FinanceSection>(userFinanceDefaults?.section ?? 'dashboard')
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const asOf = useAsOfSnapshot()
  const {
    enabled: asOfEnabled,
    setEnabled: setAsOfEnabled,
    date: asOfDate,
    setDate: setAsOfDate,
    time: asOfTime,
    setTime: setAsOfTime,
  } = asOf
  const asOfDateFilter = asOfEnabled ? asOfDate : undefined

  const tabs = webFinanceMode
    ? CORE_TABS.filter((tab) => tab.id !== 'summary')
    : CORE_TABS

  useEffect(() => {
    if (userFinanceDefaults?.section) setSection(userFinanceDefaults.section)
  }, [userFinanceDefaults?.section])

  return (
    <PageLayout>
      <PageHeader
        density="compact"
        showBrand={false}
        title={
          webFinanceMode && webUserName
            ? tf('web.finance.welcome', { name: webUserName })
            : t('finance.title')
        }
        subtitle={webFinanceMode ? t('web.finance.subtitle') : t('finance.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TabBar
              tabs={tabs.map((tab) => ({ id: tab.id, label: t(tab.labelKey) }))}
              value={section}
              onChange={setSection}
            />
            <PageActionOverflow
              items={[
                {
                  id: 'defaults',
                  label: t('viewDefaults.open'),
                  onClick: () => setDefaultsOpen(true),
                  hidden: !(currentUserId && onSaveViewDefaults),
                },
              ]}
            />
          </div>
        }
      />

      {(section === 'statement' ||
        section === 'ledger' ||
        section === 'dashboard' ||
        section === 'payments' ||
        section === 'sick' ||
        section === 'rates') && (
        <AsOfSnapshotBar
          className="mb-4"
          enabled={asOfEnabled}
          onEnabledChange={setAsOfEnabled}
          date={asOfDate}
          onDateChange={setAsOfDate}
          time={asOfTime}
          onTimeChange={setAsOfTime}
          hintKey="asOf.hintFinance"
        />
      )}

      {section === 'dashboard' && (
        <FinanceDashboardPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          onOpenStatement={() => setSection('statement')}
          onOpenSick={() => setSection('sick')}
          onOpenRates={() => setSection('rates')}
          onOpenPayments={() => setSection('payments')}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'payments' && (
        <FinancePaymentsJournalPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'statement' && (
        <PayrollStatementPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          actions={actions}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'sick' && (
        <SickConfirmPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          actions={actions}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'ledger' && (
        <EmployeeLedgerPanel store={store} actions={actions} asOfDate={asOfDateFilter} />
      )}

      {section === 'rates' && (
        <FinanceRatesPanel
          employees={store.employees}
          hrPositions={hrPositions}
          onSaveEmployee={onSaveEmployee}
          month={month}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'employees' && (
        <EmployeesPage
          embedded
          showIndividualSalary
          employees={store.employees}
          brigades={brigades}
          hrStructuralUnits={hrStructuralUnits}
          hrPositions={hrPositions}
          onSave={onSaveEmployee}
          onRemove={onRemoveEmployee}
        />
      )}

      {section === 'org' && (
        <OrgStructureDirectoryPanel
          units={hrStructuralUnits}
          positions={hrPositions}
          employees={store.employees}
          onUpsertUnit={onUpsertStructuralUnit}
          onRemoveUnit={onRemoveStructuralUnit}
          onUpsertPosition={onUpsertPosition}
          onRemovePosition={onRemovePosition}
          onImportSeed={onImportOrgStructureFromSeed}
          onSaveEmployee={onSaveEmployee}
        />
      )}

      {section === 'summary' && <SummaryPage store={store} />}

      {defaultsOpen && currentUserId && onSaveViewDefaults && (
        <FinanceViewDefaultsDialog
          tabs={tabs}
          initial={{ section }}
          onSave={(defaults) => {
            onSaveViewDefaults('finance', defaults)
            if (defaults.section) setSection(defaults.section)
          }}
          onClose={() => setDefaultsOpen(false)}
        />
      )}
    </PageLayout>
  )
}

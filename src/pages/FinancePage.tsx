import { useEffect, useState } from 'react'
import { PayrollPreviewPanel } from '@/components/finance/PayrollPreviewPanel'
import { PayrollStatementPanel } from '@/components/finance/PayrollStatementPanel'
import { SickConfirmPanel, VacationConfirmPanel } from '@/components/finance/SickConfirmPanel'
import { EmployeeLedgerPanel } from '@/components/finance/EmployeeLedgerPanel'
import { FinanceRatesPanel } from '@/components/finance/FinanceRatesPanel'
import { FinanceDashboardPanel } from '@/components/finance/FinanceDashboardPanel'
import { FinanceDocumentsPanel } from '@/components/finance/FinanceDocumentsPanel'
import { FinancePaymentsJournalPanel } from '@/components/finance/FinancePaymentsJournalPanel'
import { OrgStructureDirectoryPanel } from '@/components/directories/OrgStructureDirectoryPanel'
import type { FinanceActions, FinanceDocumentActions } from '@/components/finance/financeTypes'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { EmployeesPage } from '@/pages/EmployeesPage'
import { SharedDataNotice } from '@/components/ui/SharedDataNotice'
import { useI18n } from '@/context/I18nContext'
import type { AppStore, Employee, HrPosition, HrStructuralUnit } from '@/lib/types'
import { FinanceViewDefaultsDialog } from '@/components/finance/FinanceViewDefaultsDialog'
import { PageActionOverflow } from '@/components/ui/PageActionOverflow'
import type { FinanceViewDefaults, UserViewDefaults } from '@/lib/viewDefaults/types'

export type FinanceSection =
  | 'dashboard'
  | 'preview'
  | 'statement'
  | 'documents'
  | 'payments'
  | 'sick'
  | 'vacation'
  | 'ledger'
  | 'rates'
  | 'employees'
  | 'org'

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
  documentActions: FinanceDocumentActions
  focusAdvanceDocumentId?: string | null
  focusPayoutDocumentId?: string | null
  focusAccrualDocumentId?: string | null
  onJournalFocusConsumed?: () => void
  webFinanceMode?: boolean
  webUserName?: string
  userFinanceDefaults?: FinanceViewDefaults
  currentUserId?: string
  onSaveViewDefaults?: <K extends keyof UserViewDefaults>(
    viewId: K,
    patch: NonNullable<UserViewDefaults[K]>,
  ) => void
  onSetDefaultAdvancePercent?: (percent: number) => void
  /** Переход в Персонал (если роль имеет доступ) — только подсказка, не ломает finance-only. */
  onOpenHr?: () => void
}

const CORE_TABS: { id: FinanceSection; labelKey: string }[] = [
  { id: 'dashboard', labelKey: 'finance.tab.dashboard' },
  { id: 'preview', labelKey: 'finance.tab.payroll' },
  { id: 'statement', labelKey: 'finance.tab.statement' },
  { id: 'documents', labelKey: 'finance.tab.documents' },
  { id: 'payments', labelKey: 'finance.tab.payments' },
  { id: 'sick', labelKey: 'finance.tab.sick' },
  { id: 'vacation', labelKey: 'finance.tab.vacation' },
  { id: 'ledger', labelKey: 'finance.tab.ledger' },
  { id: 'rates', labelKey: 'finance.tab.rates' },
  { id: 'employees', labelKey: 'finance.tab.employees' },
  { id: 'org', labelKey: 'finance.tab.org' },
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
  documentActions,
  focusAdvanceDocumentId,
  focusPayoutDocumentId,
  focusAccrualDocumentId,
  onJournalFocusConsumed,
  webFinanceMode,
  webUserName,
  userFinanceDefaults,
  currentUserId,
  onSaveViewDefaults,
  onSetDefaultAdvancePercent,
  onOpenHr,
}: Props) {
  const { t, tf } = useI18n()
  const [section, setSection] = useState<FinanceSection>(() => {
    const raw = userFinanceDefaults?.section as string | undefined
    if (!raw || raw === 'summary') return 'dashboard'
    return raw as FinanceSection
  })
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

  const tabs = CORE_TABS

  useEffect(() => {
    if (!userFinanceDefaults?.section) return
    const next =
      (userFinanceDefaults.section as string) === 'summary'
        ? 'dashboard'
        : userFinanceDefaults.section
    setSection(next)
  }, [userFinanceDefaults?.section])

  useEffect(() => {
    if (focusAdvanceDocumentId || focusPayoutDocumentId || focusAccrualDocumentId) {
      setSection('documents')
    }
  }, [focusAdvanceDocumentId, focusPayoutDocumentId, focusAccrualDocumentId])

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
              coachPrefix="finance"
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
        section === 'preview' ||
        section === 'ledger' ||
        section === 'dashboard' ||
        section === 'documents' ||
        section === 'payments' ||
        section === 'sick' ||
        section === 'vacation' ||
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
          onOpenDocuments={() => setSection('documents')}
          asOfDate={asOfDateFilter}
        />
      )}

      {section === 'documents' && (
        <FinanceDocumentsPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          documentActions={documentActions}
          asOfDate={asOfDateFilter}
          openDocumentId={
            focusAdvanceDocumentId ?? focusPayoutDocumentId ?? focusAccrualDocumentId
          }
          openDocumentKind={
            focusPayoutDocumentId
              ? 'salary'
              : focusAdvanceDocumentId
                ? 'advances'
                : focusAccrualDocumentId
                  ? 'accrual'
                  : null
          }
          onOpenDocumentConsumed={onJournalFocusConsumed}
          onSetDefaultAdvancePercent={onSetDefaultAdvancePercent ?? (() => undefined)}
          onOpenStatement={() => setSection('statement')}
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

      {section === 'preview' && (
        <PayrollPreviewPanel
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
        <div className="space-y-3">
          <SharedDataNotice>{t('sharedRoot.sickFinance')}</SharedDataNotice>
          <SickConfirmPanel
            store={store}
            month={month}
            onMonthChange={onMonthChange}
            actions={actions}
            asOfDate={asOfDateFilter}
          />
        </div>
      )}

      {section === 'vacation' && (
        <div className="space-y-3">
          <SharedDataNotice>{t('sharedRoot.sickFinance')}</SharedDataNotice>
          <VacationConfirmPanel
            store={store}
            month={month}
            onMonthChange={onMonthChange}
            actions={actions}
            asOfDate={asOfDateFilter}
          />
        </div>
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
        <div className="space-y-3">
          <SharedDataNotice
            action={
              onOpenHr ? (
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={onOpenHr}
                >
                  {t('sharedRoot.openHr')}
                </button>
              ) : undefined
            }
          >
            {t('sharedRoot.employeesFinance')}
          </SharedDataNotice>
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
        </div>
      )}

      {section === 'org' && (
        <div className="space-y-3">
          <SharedDataNotice>{t('sharedRoot.orgFinance')}</SharedDataNotice>
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
        </div>
      )}

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

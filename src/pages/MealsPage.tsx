import { useState } from 'react'
import { CookMealsPanelV2 } from '@/components/meals/CookMealsPanelV2'
import { EmployeeMealsPanelV2 } from '@/components/meals/EmployeeMealsPanelV2'
import { MealsSettingsPanel } from '@/components/meals/MealsSettingsPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import type { AppUser } from '@/lib/access/types'
import {
  canCookMeals,
  canManageMealSettings,
  canOrderMeals,
  canSeeMealPrices,
} from '@/lib/meals/access'
import type {
  MealCatalogItem,
  MealOrderLine,
  MealSettings,
} from '@/lib/meals/types'
import type { AppStore } from '@/lib/types'

type TabId = 'order' | 'kitchen' | 'settings'

type Props = {
  store: AppStore
  currentUser: AppUser | null
  onUpsertMealOrder: (input: {
    employeeId: string
    employeeName: string
    date: string
    lines: MealOrderLine[]
  }) => void
  onAcceptMealDay: (date: string) => void
  onUnacceptMealDay: (date: string) => void
  onUpdateMealSettings: (patch: Partial<MealSettings>) => void
  onUpsertMealCatalogItem: (item: MealCatalogItem) => void
  onSetMealWeekBase: (weekStart: string, date: string, baseItemId: string | null) => void
  onSetMealDayExtras: (weekStart: string, date: string, extraIds: string[]) => void
  onCopyPreviousMealWeek: (weekStart: string) => boolean
  onPublishMealWeek: (weekStart: string) => boolean
  onAddMealAdvanceReceipt: (input: {
    amountGel: number
    receivedAt: string
    note?: string
  }) => string | null
}

export function MealsPage({
  store,
  currentUser,
  onUpsertMealOrder,
  onAcceptMealDay,
  onUnacceptMealDay,
  onUpdateMealSettings,
  onUpsertMealCatalogItem,
  onSetMealWeekBase,
  onSetMealDayExtras,
  onCopyPreviousMealWeek,
  onPublishMealWeek,
  onAddMealAdvanceReceipt,
}: Props) {
  const { t } = useI18n()
  const kitchen = canCookMeals(currentUser)
  const admin = canManageMealSettings(currentUser)
  const showPrices = canSeeMealPrices(currentUser)
  const canOrder = canOrderMeals(currentUser)
  const employeeId = currentUser?.employeeId?.trim() ?? ''
  const employeeName =
    store.employees.find((e) => e.id === employeeId)?.fullName ||
    currentUser?.displayName ||
    ''
  const tabs: { id: TabId; label: string }[] = []
  if (canOrder) tabs.push({ id: 'order', label: t('meals.tab.order') })
  if (kitchen) tabs.push({ id: 'kitchen', label: t('meals.tab.kitchen') })
  if (admin) tabs.push({ id: 'settings', label: t('meals.tab.settings') })
  const [tab, setTab] = useState<TabId>(() =>
    kitchen ? 'kitchen' : tabs[0]?.id ?? 'order',
  )
  const active = tabs.some((x) => x.id === tab) ? tab : tabs[0]?.id ?? 'order'

  return (
    <PageLayout>
      <PageHeader
        badge={t('meals.badge')}
        title={t('meals.title')}
        subtitle={t('meals.subtitle')}
        density="compact"
      />
      {tabs.length > 1 ? (
        <TabBar tabs={tabs} value={active} onChange={setTab} coachPrefix="meals" />
      ) : null}
      {active === 'order' ? (
        employeeId ? (
          <EmployeeMealsPanelV2
            store={store}
            employeeId={employeeId}
            employeeName={employeeName}
            showPrices={showPrices}
            onSave={onUpsertMealOrder}
          />
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            {t('meals.noLink')}
          </p>
        )
      ) : null}
      {active === 'kitchen' && kitchen ? (
        <CookMealsPanelV2
          store={store}
          onAccept={onAcceptMealDay}
          onUnaccept={onUnacceptMealDay}
          onUpsertCatalogItem={onUpsertMealCatalogItem}
          onSetWeekBase={onSetMealWeekBase}
          onSetDayExtras={onSetMealDayExtras}
          onCopyPreviousWeek={onCopyPreviousMealWeek}
          onPublishWeek={onPublishMealWeek}
          onAddAdvance={onAddMealAdvanceReceipt}
        />
      ) : null}
      {active === 'settings' && admin ? (
        <MealsSettingsPanel
          store={store}
          onUpdateSettings={onUpdateMealSettings}
        />
      ) : null}
    </PageLayout>
  )
}

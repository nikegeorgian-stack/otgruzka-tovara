import { lazy } from 'react'
import type { ViewId } from '@/lib/types'

export const MonthPage = lazy(() =>
  import('@/pages/MonthPage').then((m) => ({ default: m.MonthPage })),
)
export const SummaryPage = lazy(() =>
  import('@/pages/SummaryPage').then((m) => ({ default: m.SummaryPage })),
)
export const HrPage = lazy(() => import('@/pages/HrPage').then((m) => ({ default: m.HrPage })))
export const HrInspectorPage = lazy(() =>
  import('@/pages/HrInspectorPage').then((m) => ({ default: m.HrInspectorPage })),
)
export const FinancePage = lazy(() =>
  import('@/pages/FinancePage').then((m) => ({ default: m.FinancePage })),
)
export const ProductionPage = lazy(() =>
  import('@/pages/ProductionPage').then((m) => ({ default: m.ProductionPage })),
)
export const PlannerPage = lazy(() =>
  import('@/pages/PlannerPage').then((m) => ({ default: m.PlannerPage })),
)
export const DirectoriesPage = lazy(() =>
  import('@/pages/DirectoriesPage').then((m) => ({ default: m.DirectoriesPage })),
)
export const WarehousePage = lazy(() =>
  import('@/pages/WarehousePage').then((m) => ({ default: m.WarehousePage })),
)
export const ProcurementPage = lazy(() =>
  import('@/pages/ProcurementPage').then((m) => ({ default: m.ProcurementPage })),
)
export const TechnologistPage = lazy(() =>
  import('@/pages/TechnologistPage').then((m) => ({ default: m.TechnologistPage })),
)
export const MixerPage = lazy(() =>
  import('@/pages/MixerPage').then((m) => ({ default: m.MixerPage })),
)
export const DirectorPage = lazy(() =>
  import('@/pages/DirectorPage').then((m) => ({ default: m.DirectorPage })),
)
export const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
export const JournalsPage = lazy(() =>
  import('@/pages/JournalsPage').then((m) => ({ default: m.JournalsPage })),
)
export const ItOfficePage = lazy(() =>
  import('@/pages/ItOfficePage').then((m) => ({ default: m.ItOfficePage })),
)

/** Dev-only: прототипы компактного табеля */
export const MonthLayoutLabPage = lazy(() =>
  import('@/experiments/month-layouts/MonthLayoutLabPage').then((m) => ({
    default: m.MonthLayoutLabPage,
  })),
)

export const FstCloudSync = lazy(() =>
  import('@/components/web/FstCloudSync').then((m) => ({ default: m.FstCloudSync })),
)
export const LocalDbSync = lazy(() =>
  import('@/components/system/LocalDbSync').then((m) => ({ default: m.LocalDbSync })),
)

/** Предзагрузка чанка страницы при наведении на пункт меню. */
const VIEW_IMPORTS: Partial<Record<ViewId, () => Promise<unknown>>> = {
  month: () => import('@/pages/MonthPage'),
  summary: () => import('@/pages/SummaryPage'),
  hr: () => import('@/pages/HrPage'),
  hr_inspector: () => import('@/pages/HrInspectorPage'),
  finance: () => import('@/pages/FinancePage'),
  production: () => import('@/pages/ProductionPage'),
  planner: () => import('@/pages/PlannerPage'),
  directories: () => import('@/pages/DirectoriesPage'),
  warehouse: () => import('@/pages/WarehousePage'),
  procurement: () => import('@/pages/ProcurementPage'),
  technologist: () => import('@/pages/TechnologistPage'),
  mixer: () => import('@/pages/MixerPage'),
  director: () => import('@/pages/DirectorPage'),
  settings: () => import('@/pages/SettingsPage'),
  journals: () => import('@/pages/JournalsPage'),
  it: () => import('@/pages/ItOfficePage'),
}

export function prefetchView(view: ViewId): void {
  void VIEW_IMPORTS[view]?.()
}

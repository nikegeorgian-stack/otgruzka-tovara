import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WarehousePageProps } from '../src/components/warehouse/warehouseTypes'
import type { FormulationBatchRun } from '../src/lib/formulations/types'
import type { WarehouseStore } from '../src/lib/warehouse/types'

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tf: (key: string) => key,
    locale: 'ru',
  }),
}))

vi.mock('@/context/ConfirmContext', () => ({
  useConfirm: () => ({
    confirm: vi.fn(async () => true),
    alert: vi.fn(async () => undefined),
    confirmUnsaved: vi.fn(async () => 'cancel'),
  }),
}))

const warehouse: WarehouseStore = {
  locations: [{ id: 'warehouse-1', name: 'Основной', sortOrder: 0 }],
  categories: [{ id: 'chemistry', name: 'Химия', sortOrder: 0 }],
  items: [
    {
      id: 'component-1',
      internalCode: 'FC-000001',
      name: 'Компонент 1',
      categoryId: 'chemistry',
      warehouseId: 'warehouse-1',
      unit: 'кг',
      active: true,
      sortOrder: 0,
    },
    {
      id: 'impregnation-1',
      internalCode: 'FC-000002',
      name: 'Пропитка РП-0003',
      categoryId: 'chemistry',
      warehouseId: 'warehouse-1',
      unit: 'кг',
      active: true,
      sortOrder: 1,
    },
  ],
  movements: [],
  documents: [],
  invoiceRegistry: [],
  auditLog: [],
}

const pendingRun: FormulationBatchRun = {
  id: 'batch-run-c',
  documentNumber: 'ЗМ-2026-C-001',
  status: 'pending',
  recipeId: 'recipe-rp-0003',
  recipeCode: 'РП-0003',
  recipeName: 'Пропитка Celloplex 160',
  targetVolumeL: 10,
  scaleFactor: 1,
  lines: [
    {
      componentId: 'component-1',
      name: 'Компонент 1',
      warehouseItemId: 'component-1',
      consumeKg: 1,
    },
  ],
  outputWarehouseItemId: 'impregnation-1',
  outputKg: 10,
  warehouseId: 'warehouse-1',
  mixedAt: '2026-09-10T08:00:00.000Z',
  mixedBy: 'mixer-1',
  mixedByName: 'Миксер',
  createdAt: '2026-09-10T08:00:00.000Z',
}

function pageProps(): WarehousePageProps {
  const noop = vi.fn()
  return {
    warehouse,
    workwear: { catalog: [], issuances: [] },
    employees: [],
    brigades: [],
    webWarehouseMode: true,
    pendingBatchRuns: [pendingRun],
    onConfirmFormulationBatch: vi.fn(),
    onRejectFormulationBatch: vi.fn(),
    // A legacy request queue is deliberately supplied: web mode must still hide it.
    productionRequests: [{} as NonNullable<WarehousePageProps['productionRequests']>[number]],
    brigadeNamesKa: {},
    onSaveProductionRequest: noop,
    onPostProductionRequest: vi.fn(),
    onUpsertItem: noop,
    onArchiveItem: noop,
    onRemoveItem: vi.fn(() => false),
    onUpsertCategory: noop,
    onUpsertLocation: noop,
    onAddMovement: noop,
    onDeleteMovement: vi.fn(() => false),
    onPostDocument: vi.fn(),
    onRunInventory: noop,
    onPostInventoryRevision: vi.fn(),
    onPostOpeningBalances: vi.fn(),
    onImportExcel: vi.fn(),
    onExportExcel: noop,
    onMergeInvoiceRegistry: noop,
  } as WarehousePageProps
}

describe('R3.1C warehouse keeper batch confirmation visibility', () => {
  it('renders a clickable pending batch action in web warehouse mode and hides the legacy queue', async () => {
    const { WarehousePage } = await import('../src/pages/WarehousePage')
    const html = renderToStaticMarkup(createElement(WarehousePage, pageProps()))

    expect(html).toContain('warehouse.batchConfirm.title')
    expect(html).toContain(pendingRun.documentNumber)
    expect(html).toMatch(
      /<button[^>]*type="button"[^>]*>\s*warehouse\.batchConfirm\.confirm\s*<\/button>/,
    )
    expect(html).not.toContain('warehouse.production.title')
  })

  it('keeps the existing callback prerequisites fail-closed', async () => {
    const { WarehousePage } = await import('../src/pages/WarehousePage')
    const props = pageProps()
    props.onConfirmFormulationBatch = undefined

    const html = renderToStaticMarkup(createElement(WarehousePage, props))
    expect(html).not.toContain('warehouse.batchConfirm.title')
  })
})

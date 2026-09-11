import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppUser } from '../src/lib/access/types'
import type { WarehouseLocation, WarehouseStore } from '../src/lib/warehouse/types'
import {
  LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE,
  LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND,
} from '../src/lib/warehouse/g3LineBindingConfigCore.mjs'

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tf: (key: string, vars: Record<string, string | number>) =>
      `${key}:${String(vars.revision ?? '')}`,
    locale: 'ru',
  }),
}))

const sysadmin: AppUser = {
  id: 'admin-1',
  login: 'admin',
  displayName: 'Admin',
  roleId: 'sysadmin',
  passwordHash: '',
  passwordSalt: '',
  active: true,
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T00:00:00.000Z',
}

function fixture(): Pick<
  WarehouseStore,
  'locations' | 'accountingByWarehouse' | 'productionLineBindings'
> {
  const locations: Array<WarehouseLocation & { active?: boolean }> = [
    { id: 'wh-active', name: 'Production warehouse', sortOrder: 1 },
    { id: 'loc-active', name: 'Physical line one', sortOrder: 2 },
    { id: 'wh-inactive', name: 'Accounting not active', sortOrder: 3 },
    { id: 'loc-inactive', name: 'Inactive location', sortOrder: 4, active: false },
    { id: 'duplicate-id', name: 'Duplicate A', sortOrder: 5 },
    { id: 'duplicate-id', name: 'Duplicate B', sortOrder: 6 },
    // A matching display name must never make this row stand in for wh-active.
    { id: 'name-only-id', name: 'wh-active', sortOrder: 7 },
  ]
  return {
    locations,
    accountingByWarehouse: [
      { id: 'wh-active', warehouseId: 'wh-active', status: 'active' },
      { id: 'wh-inactive', warehouseId: 'wh-inactive', status: 'reconciling' },
    ],
    productionLineBindings: [],
  }
}

describe('R3.1C staging line-binding settings UI', () => {
  it('is visible only for an active sysadmin with the exact staging gate', async () => {
    const { ProductionLineBindingSettingsPanel } = await import(
      '../src/components/settings/ProductionLineBindingSettingsPanel'
    )
    const { canConfigureProductionLineBindings } = await import(
      '../src/lib/warehouse/productionLineBindingSettings'
    )

    expect(canConfigureProductionLineBindings(true, sysadmin)).toBe(true)
    expect(canConfigureProductionLineBindings(false, sysadmin)).toBe(false)
    expect(
      canConfigureProductionLineBindings(true, {
        ...sysadmin,
        id: 'director-1',
        roleId: 'operations_director',
      }),
    ).toBe(false)
    expect(canConfigureProductionLineBindings(true, { ...sysadmin, active: false })).toBe(false)

    const enabled = renderToStaticMarkup(
      createElement(ProductionLineBindingSettingsPanel, {
        warehouse: fixture(),
        currentUser: sysadmin,
        allowStagingConfiguration: true,
        onUpsert: vi.fn(),
      }),
    )
    expect(enabled).toContain('data-testid="staging-production-line-binding-settings"')
    expect(enabled).toContain('value="wh-active"')
    expect(enabled).toContain('value="loc-active"')

    const wrongEnvironment = renderToStaticMarkup(
      createElement(ProductionLineBindingSettingsPanel, {
        warehouse: fixture(),
        currentUser: sysadmin,
        allowStagingConfiguration: false,
        onUpsert: vi.fn(),
      }),
    )
    expect(wrongEnvironment).toBe('')
  })

  it('offers only unique active IDs and only warehouses with one active accounting row', async () => {
    const { productionLineBindingOptions } = await import(
      '../src/lib/warehouse/productionLineBindingSettings'
    )
    const options = productionLineBindingOptions(fixture())

    expect(options.productionWarehouses.map((row) => row.id)).toEqual(['wh-active'])
    expect(options.productionLocations.map((row) => row.id)).toEqual([
      'wh-active',
      'loc-active',
      'wh-inactive',
      'name-only-id',
    ])
    expect(options.productionLocations.some((row) => row.id === 'duplicate-id')).toBe(false)
    expect(options.productionLocations.some((row) => row.id === 'loc-inactive')).toBe(false)
  })

  it('builds a command only from exact selected IDs and preserves core errors', async () => {
    const { prepareProductionLineBindingCommand } = await import(
      '../src/lib/warehouse/productionLineBindingSettings'
    )
    const warehouse = fixture()

    expect(
      prepareProductionLineBindingCommand(warehouse, {
        lineId: '1',
        productionWarehouseId: 'Production warehouse',
        productionLocationId: 'loc-active',
      }),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_WAREHOUSE_NOT_FOUND })

    expect(
      prepareProductionLineBindingCommand(warehouse, {
        lineId: '1',
        productionWarehouseId: 'wh-inactive',
        productionLocationId: 'loc-active',
      }),
    ).toEqual({ ok: false, error: LINE_BINDING_CONFIG_ACCOUNTING_INACTIVE })

    expect(
      prepareProductionLineBindingCommand(warehouse, {
        lineId: '1',
        productionWarehouseId: 'wh-active',
        productionLocationId: 'loc-active',
        note: ' owner approved ',
      }),
    ).toEqual({
      ok: true,
      command: {
        lineId: '1',
        productionWarehouseId: 'wh-active',
        productionLocationId: 'loc-active',
        note: 'owner approved',
      },
    })
  })

  it('wires the settings route to the existing action only for the exact staging project', async () => {
    const appSource = await fs.readFile(path.resolve('src/App.tsx'), 'utf8')
    const settingsSource = await fs.readFile(path.resolve('src/pages/SettingsPage.tsx'), 'utf8')

    expect(appSource).toMatch(
      /allowStagingLineBindingConfiguration=\{[\s\S]*?isFstWeb\s*&&[\s\S]*?VITE_FIREBASE_PROJECT_ID === 'otgruzka-tovara-stg'/,
    )
    expect(appSource).toMatch(
      /onUpsertProductionLineLocationBinding=\{[\s\S]*?app\.upsertProductionLineLocationBinding/,
    )
    expect(settingsSource).toContain('<ProductionLineBindingSettingsPanel')
    expect(settingsSource).toContain('allowStagingConfiguration={allowStagingLineBindingConfiguration}')
  })
})

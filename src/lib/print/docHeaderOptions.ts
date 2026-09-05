import type { AppStore, Locale } from '@/lib/types'

/** Пресет бланка — какие поля шапки показывать. */
export type DocHeaderPresetId =
  | 'timesheet_ge'
  | 'finance_payroll'
  | 'warehouse_receipt'
  | 'warehouse_issue'
  | 'warehouse_inventory'
  | 'warehouse_loading'
  | 'production_batch'

/** Галки полей шапки (опции). */
export type DocHeaderFieldFlags = {
  showLogo: boolean
  showOrg: boolean
  showIdCode: boolean
  showUnit: boolean
  showAddress: boolean
  showBank: boolean
  showPeriod: boolean
  showOrderRef: boolean
  showMol: boolean
  showWarehouse: boolean
  showCounterparty: boolean
  showPurpose: boolean
  showRsKey: boolean
  showProductionLink: boolean
}

export type DocHeaderOrgProfile = {
  orgRu?: string
  orgKa?: string
  idCode?: string
  unitRu?: string
  unitKa?: string
  addressRu?: string
  addressKa?: string
  bankName?: string
  bankIban?: string
}

/** Настройки шапок в settings (аддитивно). */
export type DocHeaderSettings = {
  org?: DocHeaderOrgProfile
  /** Переопределения галок по пресетам (частичные). */
  presets?: Partial<Record<DocHeaderPresetId, Partial<DocHeaderFieldFlags>>>
}

export const DOC_HEADER_PRESET_IDS: DocHeaderPresetId[] = [
  'timesheet_ge',
  'finance_payroll',
  'warehouse_receipt',
  'warehouse_issue',
  'warehouse_inventory',
  'warehouse_loading',
  'production_batch',
]

const PRESET_DEFAULTS: Record<DocHeaderPresetId, DocHeaderFieldFlags> = {
  timesheet_ge: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: true,
    showAddress: false,
    showBank: false,
    showPeriod: true,
    showOrderRef: true,
    showMol: false,
    showWarehouse: false,
    showCounterparty: false,
    showPurpose: false,
    showRsKey: false,
    showProductionLink: false,
  },
  finance_payroll: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: true,
    showAddress: false,
    showBank: true,
    showPeriod: true,
    showOrderRef: false,
    showMol: true,
    showWarehouse: false,
    showCounterparty: false,
    showPurpose: false,
    showRsKey: false,
    showProductionLink: false,
  },
  warehouse_receipt: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: false,
    showAddress: false,
    showBank: false,
    showPeriod: false,
    showOrderRef: false,
    showMol: true,
    showWarehouse: true,
    showCounterparty: true,
    showPurpose: true,
    showRsKey: true,
    showProductionLink: true,
  },
  warehouse_issue: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: false,
    showAddress: false,
    showBank: false,
    showPeriod: false,
    showOrderRef: false,
    showMol: true,
    showWarehouse: true,
    showCounterparty: true,
    showPurpose: true,
    showRsKey: false,
    showProductionLink: true,
  },
  warehouse_inventory: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: false,
    showAddress: false,
    showBank: false,
    showPeriod: true,
    showOrderRef: false,
    showMol: true,
    showWarehouse: true,
    showCounterparty: false,
    showPurpose: false,
    showRsKey: false,
    showProductionLink: false,
  },
  warehouse_loading: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: false,
    showAddress: false,
    showBank: false,
    showPeriod: false,
    showOrderRef: false,
    showMol: true,
    showWarehouse: true,
    showCounterparty: true,
    showPurpose: false,
    showRsKey: false,
    showProductionLink: false,
  },
  production_batch: {
    showLogo: true,
    showOrg: true,
    showIdCode: true,
    showUnit: false,
    showAddress: false,
    showBank: false,
    showPeriod: false,
    showOrderRef: false,
    showMol: true,
    showWarehouse: true,
    showCounterparty: false,
    showPurpose: true,
    showRsKey: false,
    showProductionLink: true,
  },
}

export const DOC_HEADER_FIELD_KEYS: (keyof DocHeaderFieldFlags)[] = [
  'showLogo',
  'showOrg',
  'showIdCode',
  'showUnit',
  'showAddress',
  'showBank',
  'showPeriod',
  'showOrderRef',
  'showMol',
  'showWarehouse',
  'showCounterparty',
  'showPurpose',
  'showRsKey',
  'showProductionLink',
]

export function defaultDocHeaderFlags(preset: DocHeaderPresetId): DocHeaderFieldFlags {
  return { ...PRESET_DEFAULTS[preset] }
}

export function resolveDocHeaderFlags(
  settings: DocHeaderSettings | undefined,
  preset: DocHeaderPresetId,
): DocHeaderFieldFlags {
  const base = defaultDocHeaderFlags(preset)
  const patch = settings?.presets?.[preset]
  if (!patch) return base
  return { ...base, ...patch }
}

export function resolveDocHeaderOrg(
  store: AppStore,
  locale: Locale,
): {
  organization: string
  structuralUnit: string
  idCode: string
  address: string
  bankLine: string
} {
  const emp = store.settings.employer
  const org = store.settings.docHeader?.org
  const organization =
    locale === 'ka'
      ? org?.orgKa?.trim() ||
        emp?.orgKa?.trim() ||
        org?.orgRu?.trim() ||
        emp?.orgRu?.trim() ||
        store.settings.site
      : org?.orgRu?.trim() ||
        emp?.orgRu?.trim() ||
        org?.orgKa?.trim() ||
        emp?.orgKa?.trim() ||
        store.settings.site

  const structuralUnit =
    locale === 'ka'
      ? org?.unitKa?.trim() ||
        emp?.unitKa?.trim() ||
        org?.unitRu?.trim() ||
        emp?.unitRu?.trim() ||
        store.settings.site
      : org?.unitRu?.trim() ||
        emp?.unitRu?.trim() ||
        org?.unitKa?.trim() ||
        emp?.unitKa?.trim() ||
        store.settings.site

  const address =
    locale === 'ka'
      ? org?.addressKa?.trim() || org?.addressRu?.trim() || ''
      : org?.addressRu?.trim() || org?.addressKa?.trim() || ''

  const idCode = org?.idCode?.trim() || emp?.idCode?.trim() || ''
  const bankName = org?.bankName?.trim() || ''
  const bankIban = org?.bankIban?.trim() || ''
  const bankLine = [bankName, bankIban].filter(Boolean).join(' · ')

  return { organization, structuralUnit, idCode, address, bankLine }
}

export type ResolvedDocHeaderContext = {
  flags: DocHeaderFieldFlags
  organization: string
  structuralUnit: string
  idCode: string
  address: string
  bankLine: string
  periodLabel?: string
  mol?: string
  warehouseName?: string
  counterparty?: string
  purposeLabel?: string
  rsKey?: string
  productionLabel?: string
}

export function buildResolvedDocHeader(
  store: AppStore,
  locale: Locale,
  preset: DocHeaderPresetId,
  extras?: Partial<
    Pick<
      ResolvedDocHeaderContext,
      | 'periodLabel'
      | 'mol'
      | 'warehouseName'
      | 'counterparty'
      | 'purposeLabel'
      | 'rsKey'
      | 'productionLabel'
    >
  >,
): ResolvedDocHeaderContext {
  const flags = resolveDocHeaderFlags(store.settings.docHeader, preset)
  const org = resolveDocHeaderOrg(store, locale)
  return {
    flags,
    ...org,
    ...extras,
  }
}

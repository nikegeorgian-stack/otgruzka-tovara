import seedEmployees from '@/data/seed-employees.json'
import { DEFAULT_BRIGADES } from './brigades.constants'
import { normalizeBrigadeHasBrigadier } from './brigadeHasBrigadier'
import { defaultArchivedMonths } from './monthManage'
import { defaultMonths, ensureMonth } from './monthSheet'
import {
  AI_PROVIDER_PRESETS,
  normalizeAiProvider,
} from './ai/providers'
import { normalizeExternalEffectsStore } from './cloud/externalEffects/init'
import { normalizePayrollAccrualRules } from './finance/payrollAccrualRules'
import { normalizeStaffRate } from './payrollRates'
import { DEFAULT_SHIFT_TEMPLATES } from './shiftTemplates'
import {
  createDefaultCounterparties,
  normalizeCounterpartyStore,
} from './counterparties/init'
import {
  createDefaultFinishedProducts,
  normalizeFinishedProductStore,
} from './finishedProducts/init'
import {
  createDefaultFormulations,
  normalizeFormulationStore,
} from './formulations/init'
import {
  createDefaultPackagingRecipes,
  normalizePackagingRecipeStore,
} from './packaging/init'
import {
  createDefaultTechnologistQc,
  normalizeTechnologistQc,
} from './technologist/init'
import { createDefaultOtcStore, normalizeOtcStore } from './otc/init'
import {
  createDefaultWastewaterStore,
  normalizeWastewaterStore,
} from './wastewater/init'
import {
  createDefaultEngineerLog,
  normalizeEngineerLogStore,
} from './engineerLog/init'
import { createDefaultTasksStore, normalizeTasksStore } from './tasks/init'
import {
  createDefaultNightShiftStore,
  normalizeNightShiftStore,
} from './nightShift/init'
import {
  createDefaultTimesheetEntryStore,
  normalizeTimesheetEntryStore,
} from './timesheetEntries/init'
import {
  createDefaultAttendanceStore,
  normalizeAttendanceStore,
} from './attendance/init'
import {
  createDefaultMealsStore,
  normalizeMealsStore,
} from './meals/init'
import {
  createDefaultProtocolsStore,
  normalizeProtocolsStore,
} from './protocols/init'
import {
  createDefaultOrgChartStore,
  ensureOrgChartSeed,
  normalizeOrgChartStore,
} from './orgChart/init'
import { createDefaultProduction, normalizeProduction } from './production/init'
import { createDefaultProcurement, normalizeProcurementStore } from './procurement/init'
import { createDefaultSales, normalizeSalesStore } from './sales/init'
import { createDefaultAiChat, normalizeAiChatStore } from './aiChat/init'
import { ensureEmployeeNumbers } from './hr/employeeNumber'
import { createDefaultAccessStore, normalizeAccessStore } from './access/init'
import { createDefaultWarehouse, normalizeWarehouse } from './warehouse/init'
import { ensureLoadingSeeds } from './warehouse/loadingSeeds'
import { createDefaultItOfficeStore, normalizeItOfficeStore } from './itOffice/init'
import { createDefaultWorkwear, normalizeWorkwear } from './workwear/init'
import { createDefaultFinanceStore, normalizeFinanceStore } from './finance/init'
import { normalizeMonthSheet, purgeExpiredTrash } from './trash'
import { applyHrEmbeddedTrashTombstones } from './hr/documentTrash'
import { normalizeCandidate } from './hr/candidates'
import type { AppStore, Candidate, Employee, HrPosition, HrStructuralUnit, MonthSheet } from './types'
import { ensureOrgStructureSeed } from './hr/orgStructure'
import { STORAGE_KEY } from './types'
import { assertBrigadesNotWiped } from './cloud/refuseStoreWipe'

function normalizeCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((c) => normalizeCandidate(c))
    .filter((c): c is Candidate => c !== null)
}

function normalizeTrash(raw: unknown): AppStore['trash'] {
  const t = (raw ?? {}) as Partial<AppStore['trash']>
  return {
    employees: Array.isArray(t.employees) ? t.employees : [],
    months: Array.isArray(t.months) ? t.months : [],
    candidates: Array.isArray(t.candidates)
      ? t.candidates.filter((x) => x && normalizeCandidate(x.candidate))
      : [],
  }
}

const LEGACY_KEYS = [
  'fibercell-tabel-v6',
  'fibercell-tabel-v5',
  'fibercell-tabel-v4',
  'fibercell-tabel-v3',
  'fibercell-tabel-v2',
  'tabel-local-v1',
]

const CORRUPT_BACKUP_KEY = 'fibercell-corrupt-backup'

export type SaveStoreResult =
  | { ok: true }
  | { ok: false; error: 'quota' | 'unknown'; message: string }

export type LoadStoreResult = {
  store: AppStore
  warning?: 'corrupt_recovered' | 'fresh_start'
}

function normalizeEmployee(emp: Employee): Employee {
  const hrStatus =
    emp.hrStatus ??
    (emp.employmentStatus === 'vacation'
      ? 'vacation'
      : emp.employmentStatus === 'terminated'
        ? 'fired'
        : emp.employmentStatus === 'maternity' || emp.employmentStatus === 'sick'
          ? 'sick'
          : 'active')
  const employmentStatus =
    emp.employmentStatus === 'maternity' && (hrStatus === 'sick' || !emp.hrStatus)
      ? 'sick'
      : (emp.employmentStatus ?? 'active')
  return applyHrEmbeddedTrashTombstones({
    ...emp,
    shiftMode: emp.shiftMode ?? 'day',
    employmentStatus,
    hourlyRate: emp.hourlyRate ?? undefined,
    monthlySalary: emp.monthlySalary ?? undefined,
    staffRate: (() => {
      if (emp.staffRate == null) return undefined
      const n = normalizeStaffRate(emp.staffRate)
      return n === 1 ? undefined : n
    })(),
    department: emp.department ?? emp.brigade,
    line: emp.line ?? emp.brigade,
    hrStatus,
    hrDocuments: emp.hrDocuments ?? [],
    hrDocumentsTrash: emp.hrDocumentsTrash ?? [],
    hrContracts: emp.hrContracts ?? [],
    hrContractsTrash: emp.hrContractsTrash ?? [],
    hrAbsences: emp.hrAbsences ?? [],
    hrTrainings: emp.hrTrainings ?? [],
    education: emp.education ?? [],
    workExperience: emp.workExperience ?? [],
    bankAccounts: emp.bankAccounts ?? [],
    relatives: emp.relatives ?? [],
    monthPremiums: (() => {
      const raw = emp.monthPremiums
      if (!raw || typeof raw !== 'object') return undefined
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (!/^\d{4}-\d{2}$/.test(k)) continue
        const n = typeof v === 'number' ? v : Number(v)
        if (Number.isFinite(n) && n > 0) out[k] = Math.round(n)
      }
      return Object.keys(out).length ? out : undefined
    })(),
  })
}

function normalizeOrgStructure(
  units: HrStructuralUnit[] | undefined,
  positions: HrPosition[] | undefined,
): { hrStructuralUnits: HrStructuralUnit[]; hrPositions: HrPosition[] } {
  const seeded = ensureOrgStructureSeed(units, positions)
  return { hrStructuralUnits: seeded.units, hrPositions: seeded.positions }
}

function normalizeSettings(
  settings: Partial<AppStore['settings']> | undefined,
): AppStore['settings'] {
  const locale =
    settings?.locale === 'ka' ? 'ka' : settings?.locale === 'en' ? 'en' : 'ru'
  const defaultAdvancePercent =
    typeof settings?.defaultAdvancePercent === 'number' &&
    Number.isFinite(settings.defaultAdvancePercent)
      ? Math.min(100, Math.max(0, settings.defaultAdvancePercent))
      : 30

  return {
    responsible: settings?.responsible ?? '',
    site: settings?.site ?? 'Пропитка',
    locale,
    tourCompleted: settings?.tourCompleted ?? false,
    lastBackupDate: settings?.lastBackupDate,
    signatures: settings?.signatures ?? {},
    employer: settings?.employer ?? {},
    docHeader: settings?.docHeader,
    brigadierBonus: settings?.brigadierBonus,
    defaultAdvancePercent,
    payrollAccrual: settings?.payrollAccrual
      ? normalizePayrollAccrualRules(settings.payrollAccrual)
      : undefined,
    warehouseBalancesZeroedAt: settings?.warehouseBalancesZeroedAt,
    ai: (() => {
      const provider = settings?.ai?.provider ?? 'off'
      const normalized = settings?.ai?.provider ? provider : normalizeAiProvider({ ...settings?.ai, provider })
      const preset =
        normalized === 'openai' || normalized === 'kimi' || normalized === 'local'
          ? AI_PROVIDER_PRESETS[normalized]
          : null
      return {
        provider: normalized,
        enabled: normalized !== 'off',
        apiKey: settings?.ai?.apiKey ?? '',
        baseUrl: settings?.ai?.baseUrl ?? preset?.baseUrl ?? 'local',
        model: settings?.ai?.model ?? preset?.model ?? 'local',
      }
    })(),
  }
}

function normalizeMonths(months: Record<string, MonthSheet>): Record<string, MonthSheet> {
  return Object.fromEntries(
    Object.entries(months).map(([k, s]) => [k, normalizeMonthSheet(s)]),
  )
}

function mergeEmployeesFromSeed(oldEmployees: Employee[]): Employee[] {
  const seed = (seedEmployees as unknown as Employee[]).map(normalizeEmployee)
  const oldByName = new Map(oldEmployees.map((e) => [e.fullName, e]))
  return seed.map((emp) => {
    const prev = oldByName.get(emp.fullName)
    if (!prev) return emp
    return normalizeEmployee({
      ...emp,
      id: prev.id,
      tabNumber: prev.tabNumber || emp.tabNumber,
      employeeNumber: prev.employeeNumber || emp.employeeNumber,
      brigade: prev.brigade || emp.brigade,
      schedule: prev.schedule || emp.schedule,
      group2x2: prev.group2x2 ?? emp.group2x2,
      cycleStart: prev.cycleStart || emp.cycleStart,
      hourlyRate: prev.hourlyRate,
      monthlySalary: prev.monthlySalary,
      shiftMode: prev.shiftMode ?? emp.shiftMode,
      active: prev.active ?? emp.active,
      nameKa: emp.nameKa ?? prev.nameKa,
      positionKa: emp.positionKa ?? prev.positionKa,
      employmentStatus: prev.employmentStatus ?? emp.employmentStatus,
      statusUntil: prev.statusUntil ?? emp.statusUntil,
      photoDataUrl: prev.photoDataUrl ?? emp.photoDataUrl,
    })
  })
}

function withLoadingSeeds(store: AppStore): AppStore {
  const warehouse = ensureLoadingSeeds(store.warehouse)
  if (warehouse === store.warehouse) return store
  return { ...store, warehouse }
}

/**
 * Снимает демо-погрузки A2LINE. Не трогает кадры/табель и живые остатки.
 * Флаг warehouseBalancesZeroedAt только помечаем, если его ещё нет.
 */
export function applyAppStoreSeeds(store: AppStore): AppStore {
  let next = withLoadingSeeds(store)

  if (!next.settings.warehouseBalancesZeroedAt) {
    next = {
      ...next,
      settings: {
        ...next.settings,
        warehouseBalancesZeroedAt: new Date().toISOString(),
      },
    }
  }

  return next
}

export function createDefaultStore(): AppStore {
  let store: AppStore = {
    version: 6,
    brigades: [...DEFAULT_BRIGADES],
    brigadeNamesKa: {},
    brigadeNamesEn: {},
    brigadiers: {},
    brigadeHasBrigadier: {},
    brigadeUnits: {},
    archivedMonths: defaultArchivedMonths(),
    closedMonths: [],
    monthClosures: {},
    employees: ensureEmployeeNumbers(
      (seedEmployees as unknown as Employee[]).map(normalizeEmployee),
    ),
    candidates: [],
    months: {},
    auditLog: [],
    trash: { employees: [], months: [], candidates: [] },
    shiftTemplates: [...DEFAULT_SHIFT_TEMPLATES],
    hrStructuralUnits: [],
    hrPositions: [],
    production: createDefaultProduction(),
    sales: createDefaultSales(),
    aiChat: createDefaultAiChat(),
    counterparties: createDefaultCounterparties(),
    finishedProducts: createDefaultFinishedProducts(),
    packagingRecipes: createDefaultPackagingRecipes(),
    formulations: createDefaultFormulations(),
    technologistQc: createDefaultTechnologistQc(),
    otc: createDefaultOtcStore(),
    wastewater: createDefaultWastewaterStore(),
    engineerLog: createDefaultEngineerLog(),
    tasks: createDefaultTasksStore(),
    nightShifts: createDefaultNightShiftStore(),
    timesheetEntries: createDefaultTimesheetEntryStore(),
    attendance: createDefaultAttendanceStore(),
    meals: createDefaultMealsStore(),
    protocols: createDefaultProtocolsStore(),
    orgChart: createDefaultOrgChartStore(),
    warehouse: createDefaultWarehouse(),
    workwear: createDefaultWorkwear(),
    itOffice: createDefaultItOfficeStore(),
    procurement: createDefaultProcurement(),
    access: createDefaultAccessStore(),
    finance: createDefaultFinanceStore(),
    settings: normalizeSettings(undefined),
  }
  for (const m of defaultMonths()) {
    store = ensureMonth(store, m)
  }
  const org = normalizeOrgStructure(store.hrStructuralUnits, store.hrPositions)
  store = {
    ...store,
    hrStructuralUnits: org.hrStructuralUnits,
    hrPositions: org.hrPositions,
  }
  return withLoadingSeeds(store)
}

/** Убирает секреты из экспорта / локальных бэкапов / облака */
export function sanitizeStoreForExport(
  store: AppStore,
  options?: { includeSecrets?: boolean },
): AppStore {
  if (options?.includeSecrets) return store
  const access = store.access
    ? {
        ...store.access,
        users: store.access.users.map((u) => ({
          ...u,
          passwordHash: '',
          passwordSalt: '',
        })),
      }
    : store.access
  return {
    ...store,
    access,
    settings: {
      ...store.settings,
      ai: store.settings.ai
        ? { ...store.settings.ai, apiKey: '' }
        : store.settings.ai,
    },
  }
}

/** После загрузки из облака — вернуть локальные секреты (хеши паролей, AI key). */
export function restoreLocalSecrets(local: AppStore, fromCloud: AppStore): AppStore {
  const localUsers = new Map((local.access?.users ?? []).map((u) => [u.id, u]))
  const access = fromCloud.access
    ? {
        ...fromCloud.access,
        users: fromCloud.access.users.map((u) => {
          const lv = localUsers.get(u.id)
          if (!lv?.passwordHash && !lv?.passwordSalt) return u
          return {
            ...u,
            passwordHash: lv.passwordHash || u.passwordHash,
            passwordSalt: lv.passwordSalt || u.passwordSalt,
          }
        }),
      }
    : fromCloud.access
  const localApiKey = local.settings.ai?.apiKey?.trim()
  return {
    ...fromCloud,
    access,
    settings: {
      ...fromCloud.settings,
      ai: fromCloud.settings.ai
        ? {
            ...fromCloud.settings.ai,
            apiKey: localApiKey || fromCloud.settings.ai.apiKey || '',
          }
        : fromCloud.settings.ai,
    },
  }
}

function normalizeV6Store(raw: Record<string, unknown>): AppStore {
  const oldEmployees = ensureEmployeeNumbers(
    ((raw.employees as Employee[]) ?? []).map(normalizeEmployee),
  )
  const months = normalizeMonths((raw.months as AppStore['months']) ?? {})
  const org = normalizeOrgStructure(
    raw.hrStructuralUnits as HrStructuralUnit[] | undefined,
    raw.hrPositions as HrPosition[] | undefined,
  )

  let store: AppStore = {
    version: 6,
    brigades: Array.isArray(raw.brigades)
      ? (raw.brigades as string[])
      : [...DEFAULT_BRIGADES],
    brigadeNamesKa:
      (raw.brigadeNamesKa as Record<string, string>) ??
      (raw as AppStore).brigadeNamesKa ??
      {},
    brigadeNamesEn:
      (raw.brigadeNamesEn as Record<string, string>) ??
      (raw as AppStore).brigadeNamesEn ??
      {},
    brigadiers: (raw.brigadiers as Record<string, string>) ?? {},
    brigadeHasBrigadier: normalizeBrigadeHasBrigadier(raw.brigadeHasBrigadier),
    brigadeUnits: (raw.brigadeUnits as Record<string, string>) ?? {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
    closedMonths: Array.isArray(raw.closedMonths) ? (raw.closedMonths as string[]) : [],
    monthClosures:
      (raw.monthClosures as AppStore['monthClosures']) ?? {},
    employees: oldEmployees,
    candidates: normalizeCandidates(raw.candidates),
    months,
    auditLog: Array.isArray(raw.auditLog) ? (raw.auditLog as AppStore['auditLog']) : [],
    trash: normalizeTrash(raw.trash),
    shiftTemplates: Array.isArray(raw.shiftTemplates)
      ? (raw.shiftTemplates as AppStore['shiftTemplates'])
      : [...DEFAULT_SHIFT_TEMPLATES],
    hrStructuralUnits: org.hrStructuralUnits,
    hrPositions: org.hrPositions,
    production: normalizeProduction(raw.production as AppStore['production']),
    sales: normalizeSalesStore(raw.sales as AppStore['sales']),
    aiChat: normalizeAiChatStore(raw.aiChat as AppStore['aiChat']),
    counterparties: normalizeCounterpartyStore(
      raw.counterparties as AppStore['counterparties'],
    ),
    finishedProducts: normalizeFinishedProductStore(
      raw.finishedProducts as AppStore['finishedProducts'],
    ),
    packagingRecipes: normalizePackagingRecipeStore(
      raw.packagingRecipes as AppStore['packagingRecipes'],
    ),
    formulations: normalizeFormulationStore(
      raw.formulations as AppStore['formulations'],
    ),
    technologistQc: normalizeTechnologistQc(
      raw.technologistQc as AppStore['technologistQc'],
    ),
    otc: normalizeOtcStore(raw.otc as AppStore['otc']),
    wastewater: normalizeWastewaterStore(
      raw.wastewater as AppStore['wastewater'],
    ),
    engineerLog: normalizeEngineerLogStore(raw.engineerLog),
    tasks: normalizeTasksStore(raw.tasks as AppStore['tasks']),
    nightShifts: normalizeNightShiftStore(raw.nightShifts),
    timesheetEntries: normalizeTimesheetEntryStore(
      raw.timesheetEntries as AppStore['timesheetEntries'],
    ),
    attendance: normalizeAttendanceStore(raw.attendance),
    meals: normalizeMealsStore(raw.meals),
    protocols: normalizeProtocolsStore(raw.protocols),
    orgChart: ensureOrgChartSeed(normalizeOrgChartStore(raw.orgChart as AppStore['orgChart'])),
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
    workwear: normalizeWorkwear(raw.workwear as AppStore['workwear']),
    itOffice: normalizeItOfficeStore(raw.itOffice as AppStore['itOffice']),
    procurement: normalizeProcurementStore(
      raw.procurement as AppStore['procurement'],
    ),
    access: normalizeAccessStore(raw.access as AppStore['access']),
    finance: normalizeFinanceStore(raw.finance),
    externalEffects: normalizeExternalEffectsStore(raw.externalEffects),
    settings: normalizeSettings(raw.settings as AppStore['settings']),
  }

  const brigadeSet = new Set(store.brigades)
  for (const sheet of Object.values(store.months)) {
    for (const row of sheet.rows) {
      if (row.brigade && !brigadeSet.has(row.brigade)) {
        store.brigades.push(row.brigade)
        brigadeSet.add(row.brigade)
      }
    }
  }

  return withLoadingSeeds(store)
}

function migrateToV6(raw: Record<string, unknown>): AppStore {
  const oldEmployees = ensureEmployeeNumbers(
    ((raw.employees as Employee[]) ?? []).map(normalizeEmployee),
  )
  const months = normalizeMonths((raw.months as AppStore['months']) ?? {})
  const org = normalizeOrgStructure(
    raw.hrStructuralUnits as HrStructuralUnit[] | undefined,
    raw.hrPositions as HrPosition[] | undefined,
  )

  let store: AppStore = {
    version: 6,
    brigades: Array.isArray(raw.brigades)
      ? (raw.brigades as string[])
      : [...DEFAULT_BRIGADES],
    brigadeNamesKa:
      (raw.brigadeNamesKa as Record<string, string>) ??
      (raw as AppStore).brigadeNamesKa ??
      {},
    brigadeNamesEn:
      (raw.brigadeNamesEn as Record<string, string>) ??
      (raw as AppStore).brigadeNamesEn ??
      {},
    brigadiers: (raw.brigadiers as Record<string, string>) ?? {},
    brigadeHasBrigadier: normalizeBrigadeHasBrigadier(raw.brigadeHasBrigadier),
    brigadeUnits: (raw.brigadeUnits as Record<string, string>) ?? {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
    closedMonths: Array.isArray(raw.closedMonths) ? (raw.closedMonths as string[]) : [],
    monthClosures:
      (raw.monthClosures as AppStore['monthClosures']) ?? {},
    employees: mergeEmployeesFromSeed(oldEmployees),
    candidates: normalizeCandidates(raw.candidates),
    months,
    auditLog: Array.isArray(raw.auditLog) ? (raw.auditLog as AppStore['auditLog']) : [],
    trash: normalizeTrash(raw.trash),
    shiftTemplates: Array.isArray(raw.shiftTemplates)
      ? (raw.shiftTemplates as AppStore['shiftTemplates'])
      : [...DEFAULT_SHIFT_TEMPLATES],
    hrStructuralUnits: org.hrStructuralUnits,
    hrPositions: org.hrPositions,
    production: normalizeProduction(raw.production as AppStore['production']),
    sales: normalizeSalesStore(raw.sales as AppStore['sales']),
    aiChat: normalizeAiChatStore(raw.aiChat as AppStore['aiChat']),
    counterparties: normalizeCounterpartyStore(
      raw.counterparties as AppStore['counterparties'],
    ),
    finishedProducts: normalizeFinishedProductStore(
      raw.finishedProducts as AppStore['finishedProducts'],
    ),
    packagingRecipes: normalizePackagingRecipeStore(
      raw.packagingRecipes as AppStore['packagingRecipes'],
    ),
    formulations: normalizeFormulationStore(
      raw.formulations as AppStore['formulations'],
    ),
    technologistQc: normalizeTechnologistQc(
      raw.technologistQc as AppStore['technologistQc'],
    ),
    otc: normalizeOtcStore(raw.otc as AppStore['otc']),
    wastewater: normalizeWastewaterStore(
      raw.wastewater as AppStore['wastewater'],
    ),
    engineerLog: normalizeEngineerLogStore(raw.engineerLog),
    tasks: normalizeTasksStore(raw.tasks as AppStore['tasks']),
    nightShifts: normalizeNightShiftStore(raw.nightShifts),
    timesheetEntries: normalizeTimesheetEntryStore(
      raw.timesheetEntries as AppStore['timesheetEntries'],
    ),
    attendance: normalizeAttendanceStore(raw.attendance),
    meals: normalizeMealsStore(raw.meals),
    protocols: normalizeProtocolsStore(raw.protocols),
    orgChart: ensureOrgChartSeed(normalizeOrgChartStore(raw.orgChart as AppStore['orgChart'])),
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
    workwear: normalizeWorkwear(raw.workwear as AppStore['workwear']),
    itOffice: normalizeItOfficeStore(raw.itOffice as AppStore['itOffice']),
    procurement: normalizeProcurementStore(
      raw.procurement as AppStore['procurement'],
    ),
    access: normalizeAccessStore(raw.access as AppStore['access']),
    finance: normalizeFinanceStore(raw.finance),
    externalEffects: normalizeExternalEffectsStore(raw.externalEffects),
    settings: normalizeSettings(raw.settings as AppStore['settings']),
  }

  const brigadeSet = new Set(store.brigades)
  for (const sheet of Object.values(store.months)) {
    for (const row of sheet.rows) {
      if (row.brigade && !brigadeSet.has(row.brigade)) {
        store.brigades.push(row.brigade)
        brigadeSet.add(row.brigade)
      }
    }
  }

  return withLoadingSeeds(purgeExpiredTrash(store))
}

function migrateFromRaw(parsed: unknown): AppStore | null {
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>

  if (o.version === 6) {
    if (Array.isArray(o.employees)) return normalizeV6Store(o)
  }
  if (o.version === 5 || o.version === 4 || o.version === 3 || o.version === 2) {
    if (Array.isArray(o.employees)) return migrateToV6(o)
  }

  if (!Array.isArray(o.employees)) return null
  return createDefaultStore()
}

function tryRestoreCorruptBackup(): AppStore | null {
  try {
    const raw = localStorage.getItem(CORRUPT_BACKUP_KEY)
    if (!raw) return null
    const migrated = migrateFromRaw(JSON.parse(raw))
    return migrated ? purgeExpiredTrash(migrated) : null
  } catch {
    return null
  }
}

export function loadStore(): LoadStoreResult {
  if (import.meta.env.VITE_FST_WEB === 'true') {
    return { store: createDefaultStore() }
  }
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    let fromLegacy = false
    if (!raw) {
      for (const key of LEGACY_KEYS) {
        raw = localStorage.getItem(key)
        if (raw) {
          fromLegacy = true
          break
        }
      }
    }
    if (!raw) return { store: createDefaultStore() }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      try {
        localStorage.setItem(CORRUPT_BACKUP_KEY, raw)
      } catch {
        /* ignore */
      }
      const recovered = tryRestoreCorruptBackup()
      if (recovered) {
        return { store: recovered, warning: 'corrupt_recovered' }
      }
      return { store: createDefaultStore(), warning: 'fresh_start' }
    }

    const migrated = migrateFromRaw(parsed)
    if (migrated) {
      const base = purgeExpiredTrash(migrated)
      const store = applyAppStoreSeeds(base)
      if (fromLegacy || store.warehouse !== base.warehouse) {
        saveStore(store)
      }
      return { store }
    }
  } catch {
    /* fall through */
  }

  const recovered = tryRestoreCorruptBackup()
  if (recovered) {
    return { store: recovered, warning: 'corrupt_recovered' }
  }
  return { store: createDefaultStore(), warning: 'fresh_start' }
}

/** Разбор JSON/store payload (импорт, облако). */
export function parseStorePayload(parsed: unknown): AppStore | null {
  const migrated = migrateFromRaw(parsed)
  return migrated ? applyAppStoreSeeds(purgeExpiredTrash(migrated)) : null
}

/** @deprecated use loadStore() */
export function loadStoreLegacy(): AppStore {
  return loadStore().store
}

export function saveStore(store: AppStore): SaveStoreResult {
  if (import.meta.env.VITE_FST_WEB === 'true') {
    return { ok: true }
  }
  try {
    // Guard incomplete brigades load on the localStorage path (not covered by saveToLocalDb).
    try {
      const prevRaw = localStorage.getItem(STORAGE_KEY)
      if (prevRaw) {
        const prev = JSON.parse(prevRaw) as AppStore
        assertBrigadesNotWiped(prev, store)
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('cloud_refuse_brigades_wipe')) throw e
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    return { ok: true }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('cloud_refuse_brigades_wipe')) {
      return {
        ok: false,
        error: 'unknown',
        message:
          'Сохранение отклонено: список бригад не загружен (защита от затирания). Обновите страницу.',
      }
    }
    const isQuota =
      e instanceof DOMException &&
      (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)
    return {
      ok: false,
      error: isQuota ? 'quota' : 'unknown',
      message: isQuota
        ? 'Недостаточно места в браузере. Сделайте JSON-бэкап и удалите фото сотрудников или позиций склада.'
        : e instanceof Error
          ? e.message
          : 'Ошибка сохранения',
    }
  }
}

export function exportToJson(store: AppStore, options?: { includeSecrets?: boolean }): void {
  const safe = sanitizeStoreForExport(store, options)
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fibercell-tabel-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importFromJson(file: File): Promise<AppStore> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('invalid_json')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid_json')
  const o = parsed as AppStore
  if (![2, 3, 4, 5, 6].includes(Number(o.version))) throw new Error('version')
  if (!Array.isArray(o.employees)) throw new Error('invalid_structure')
  return migrateToV6(parsed as Record<string, unknown>)
}

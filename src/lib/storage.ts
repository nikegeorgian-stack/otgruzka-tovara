import seedEmployees from '@/data/seed-employees.json'
import { DEFAULT_BRIGADES } from './brigades.constants'
import { defaultArchivedMonths } from './monthManage'
import { defaultMonths, ensureMonth } from './monthSheet'
import {
  AI_PROVIDER_PRESETS,
  normalizeAiProvider,
} from './ai/providers'
import { DEFAULT_SHIFT_TEMPLATES } from './shiftTemplates'
import {
  createDefaultCounterparties,
  findA2LineCounterparty,
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
import {
  createDefaultWastewaterStore,
  normalizeWastewaterStore,
} from './wastewater/init'
import { createDefaultProduction, normalizeProduction } from './production/init'
import { createDefaultProcurement, normalizeProcurementStore } from './procurement/init'
import { createDefaultSales, normalizeSalesStore } from './sales/init'
import { createDefaultAiChat, normalizeAiChatStore } from './aiChat/init'
import { createDefaultAccessStore, normalizeAccessStore } from './access/init'
import { createDefaultWarehouse, normalizeWarehouse } from './warehouse/init'
import { ensureLoadingSeeds } from './warehouse/loadingSeeds'
import { createDefaultItOfficeStore, normalizeItOfficeStore } from './itOffice/init'
import { createDefaultWorkwear, normalizeWorkwear } from './workwear/init'
import { normalizeMonthSheet, purgeExpiredTrash } from './trash'
import { normalizeCandidate } from './hr/candidates'
import type { AppStore, Candidate, Employee, HrPosition, HrStructuralUnit, MonthSheet } from './types'
import { ensureOrgStructureSeed } from './hr/orgStructure'
import { STORAGE_KEY } from './types'

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
        : emp.employmentStatus === 'maternity'
          ? 'sick'
          : 'active')
  return {
    ...emp,
    shiftMode: emp.shiftMode ?? 'day',
    employmentStatus: emp.employmentStatus ?? 'active',
    hourlyRate: emp.hourlyRate ?? undefined,
    monthlySalary: emp.monthlySalary ?? undefined,
    department: emp.department ?? emp.brigade,
    line: emp.line ?? emp.brigade,
    hrStatus,
    hrDocuments: emp.hrDocuments ?? [],
    hrAbsences: emp.hrAbsences ?? [],
    hrTrainings: emp.hrTrainings ?? [],
    education: emp.education ?? [],
    workExperience: emp.workExperience ?? [],
    bankAccounts: emp.bankAccounts ?? [],
    relatives: emp.relatives ?? [],
  }
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
  const locale = settings?.locale === 'ka' ? 'ka' : 'ru'
  return {
    responsible: settings?.responsible ?? '',
    site: settings?.site ?? 'Пропитка',
    locale,
    tourCompleted: settings?.tourCompleted ?? false,
    lastBackupDate: settings?.lastBackupDate,
    signatures: settings?.signatures ?? {},
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
  const a2lineId = findA2LineCounterparty(store.counterparties.items)?.id
  const warehouse = ensureLoadingSeeds(store.warehouse, a2lineId)
  if (warehouse === store.warehouse) return store
  return { ...store, warehouse }
}

/** Подставляет демо-документы погрузки (4 × A2LINE). Вызывать после любой загрузки store. */
export function applyAppStoreSeeds(store: AppStore): AppStore {
  return withLoadingSeeds(store)
}

export function createDefaultStore(): AppStore {
  let store: AppStore = {
    version: 6,
    brigades: [...DEFAULT_BRIGADES],
    brigadeNamesKa: {},
    brigadiers: {},
    archivedMonths: defaultArchivedMonths(),
    employees: (seedEmployees as unknown as Employee[]).map(normalizeEmployee),
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
    wastewater: createDefaultWastewaterStore(),
    warehouse: createDefaultWarehouse(),
    workwear: createDefaultWorkwear(),
    itOffice: createDefaultItOfficeStore(),
    procurement: createDefaultProcurement(),
    access: createDefaultAccessStore(),
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

/** Убирает секреты из экспорта / локальных бэкапов */
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

function normalizeV6Store(raw: Record<string, unknown>): AppStore {
  const oldEmployees = ((raw.employees as Employee[]) ?? []).map(normalizeEmployee)
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
    brigadiers: (raw.brigadiers as Record<string, string>) ?? {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
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
    wastewater: normalizeWastewaterStore(
      raw.wastewater as AppStore['wastewater'],
    ),
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
    workwear: normalizeWorkwear(raw.workwear as AppStore['workwear']),
    itOffice: normalizeItOfficeStore(raw.itOffice as AppStore['itOffice']),
    procurement: normalizeProcurementStore(
      raw.procurement as AppStore['procurement'],
    ),
    access: normalizeAccessStore(raw.access as AppStore['access']),
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
  const oldEmployees = ((raw.employees as Employee[]) ?? []).map(normalizeEmployee)
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
    brigadiers: (raw.brigadiers as Record<string, string>) ?? {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
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
    wastewater: normalizeWastewaterStore(
      raw.wastewater as AppStore['wastewater'],
    ),
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
    workwear: normalizeWorkwear(raw.workwear as AppStore['workwear']),
    itOffice: normalizeItOfficeStore(raw.itOffice as AppStore['itOffice']),
    procurement: normalizeProcurementStore(
      raw.procurement as AppStore['procurement'],
    ),
    access: normalizeAccessStore(raw.access as AppStore['access']),
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    return { ok: true }
  } catch (e) {
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

import seedEmployees from '@/data/seed-employees.json'
import { DEFAULT_ACCOUNTANT_PASSWORD } from './auth'
import { DEFAULT_BRIGADES } from './brigades.constants'
import { defaultArchivedMonths } from './monthManage'
import { defaultMonths, ensureMonth } from './monthSheet'
import {
  AI_PROVIDER_PRESETS,
  normalizeAiProvider,
} from './ai/providers'
import { DEFAULT_SHIFT_TEMPLATES } from './shiftTemplates'
import { createDefaultWarehouse, normalizeWarehouse } from './warehouse/init'
import { normalizeMonthSheet, purgeExpiredTrash } from './trash'
import type { AppStore, Employee, MonthSheet } from './types'
import { STORAGE_KEY } from './types'

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
  return {
    ...emp,
    shiftMode: emp.shiftMode ?? 'day',
    employmentStatus: emp.employmentStatus ?? 'active',
    hourlyRate: emp.hourlyRate ?? undefined,
    monthlySalary: emp.monthlySalary ?? undefined,
  }
}

function normalizeSettings(
  settings: Partial<AppStore['settings']> | undefined,
): AppStore['settings'] {
  const locale = settings?.locale === 'ka' ? 'ka' : 'ru'
  return {
    responsible: settings?.responsible ?? '',
    site: settings?.site ?? 'Пропитка',
    accountantPassword: settings?.accountantPassword ?? DEFAULT_ACCOUNTANT_PASSWORD,
    locale,
    tourCompleted: settings?.tourCompleted ?? false,
    lastBackupDate: settings?.lastBackupDate,
    passwordChanged: settings?.passwordChanged ?? false,
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

export function createDefaultStore(): AppStore {
  let store: AppStore = {
    version: 6,
    brigades: [...DEFAULT_BRIGADES],
    brigadeNamesKa: {},
    archivedMonths: defaultArchivedMonths(),
    employees: (seedEmployees as unknown as Employee[]).map(normalizeEmployee),
    months: {},
    auditLog: [],
    trash: { employees: [], months: [] },
    shiftTemplates: [...DEFAULT_SHIFT_TEMPLATES],
    warehouse: createDefaultWarehouse(),
    settings: normalizeSettings(undefined),
  }
  for (const m of defaultMonths()) {
    store = ensureMonth(store, m)
  }
  return store
}

/** Убирает секреты из экспорта / локальных бэкапов */
export function sanitizeStoreForExport(
  store: AppStore,
  options?: { includeSecrets?: boolean },
): AppStore {
  if (options?.includeSecrets) return store
  return {
    ...store,
    settings: {
      ...store.settings,
      accountantPassword: '',
      ai: store.settings.ai
        ? { ...store.settings.ai, apiKey: '' }
        : store.settings.ai,
    },
  }
}

function normalizeV6Store(raw: Record<string, unknown>): AppStore {
  const oldEmployees = ((raw.employees as Employee[]) ?? []).map(normalizeEmployee)
  const months = normalizeMonths((raw.months as AppStore['months']) ?? {})

  let store: AppStore = {
    version: 6,
    brigades: Array.isArray(raw.brigades)
      ? (raw.brigades as string[])
      : [...DEFAULT_BRIGADES],
    brigadeNamesKa:
      (raw.brigadeNamesKa as Record<string, string>) ??
      (raw as AppStore).brigadeNamesKa ??
      {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
    employees: oldEmployees,
    months,
    auditLog: Array.isArray(raw.auditLog) ? (raw.auditLog as AppStore['auditLog']) : [],
    trash: (raw.trash as AppStore['trash']) ?? { employees: [], months: [] },
    shiftTemplates: Array.isArray(raw.shiftTemplates)
      ? (raw.shiftTemplates as AppStore['shiftTemplates'])
      : [...DEFAULT_SHIFT_TEMPLATES],
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
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

  return store
}

function migrateToV6(raw: Record<string, unknown>): AppStore {
  const oldEmployees = ((raw.employees as Employee[]) ?? []).map(normalizeEmployee)
  const months = normalizeMonths((raw.months as AppStore['months']) ?? {})

  let store: AppStore = {
    version: 6,
    brigades: Array.isArray(raw.brigades)
      ? (raw.brigades as string[])
      : [...DEFAULT_BRIGADES],
    brigadeNamesKa:
      (raw.brigadeNamesKa as Record<string, string>) ??
      (raw as AppStore).brigadeNamesKa ??
      {},
    archivedMonths: Array.isArray(raw.archivedMonths)
      ? (raw.archivedMonths as string[])
      : defaultArchivedMonths(),
    employees: mergeEmployeesFromSeed(oldEmployees),
    months,
    auditLog: Array.isArray(raw.auditLog) ? (raw.auditLog as AppStore['auditLog']) : [],
    trash: (raw.trash as AppStore['trash']) ?? { employees: [], months: [] },
    shiftTemplates: Array.isArray(raw.shiftTemplates)
      ? (raw.shiftTemplates as AppStore['shiftTemplates'])
      : [...DEFAULT_SHIFT_TEMPLATES],
    warehouse: normalizeWarehouse(raw.warehouse as AppStore['warehouse']),
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

  return purgeExpiredTrash(store)
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
      const store = purgeExpiredTrash(migrated)
      if (fromLegacy) {
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
  return migrated ? purgeExpiredTrash(migrated) : null
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
        ? 'Недостаточно места в браузере. Сделайте JSON-бэкап и удалите фото сотрудников.'
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

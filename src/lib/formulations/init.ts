import { normalizeGrammageRegistry } from './grammages'
import { newId } from '@/lib/production/files'
import { isFormulationWaterComponent } from './calc'
import type {
  FormulationBatchRun,
  FormulationBatchStatus,
  FormulationCategory,
  FormulationColorVariant,
  FormulationComponent,
  FormulationCurrency,
  FormulationMixTask,
  FormulationRecipe,
  FormulationStore,
  MixTaskStatus,
  PigmentPaste,
} from './types'

const VALID_MIX_TASK_STATUSES = new Set<MixTaskStatus>(['open', 'done', 'cancelled'])

/** Номер задания на замес: ЗД-YYYYMMDD-NNN */
export function nextMixTaskNumber(tasks: FormulationMixTask[], date: string): string {
  const compact = date.replace(/-/g, '')
  const prefix = `ЗД-${compact}-`
  const maxSeq = (tasks ?? []).reduce((max, taskRow) => {
    if (!taskRow.taskNumber?.startsWith(prefix)) return max
    const n = parseInt(taskRow.taskNumber.slice(prefix.length), 10)
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0)
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

function normalizeMixTask(taskRow: FormulationMixTask): FormulationMixTask {
  const status: MixTaskStatus =
    taskRow.status && VALID_MIX_TASK_STATUSES.has(taskRow.status) ? taskRow.status : 'open'
  return {
    ...taskRow,
    status,
    targetVolumeL: Number(taskRow.targetVolumeL) || 0,
    plannedDate: taskRow.plannedDate?.slice(0, 10) || new Date().toISOString().slice(0, 10),
  }
}

function normalizeMixTasks(raw: unknown): FormulationMixTask[] {
  return Array.isArray(raw) ? raw.map(normalizeMixTask) : []
}

const VALID_BATCH_STATUSES = new Set<FormulationBatchStatus>([
  'pending',
  'confirmed',
  'rejected',
])

/** Внутренний код готовой пропитки для штрихкода (Latin, чтобы кодировался в Code128) */
export function formatFormulationInternalCode(n: number): string {
  return `PM-${String(Math.max(1, Math.floor(n))).padStart(6, '0')}`
}

export function parseFormulationInternalCodeNum(code: string | undefined): number {
  const m = /^PM-(\d+)$/i.exec(code?.trim() ?? '')
  return m ? Number(m[1]) : 0
}

export function allocateFormulationInternalCode(store: FormulationStore): string {
  const fromField = store.nextInternalCode ?? 1
  const maxExisting = (store.batchRuns ?? []).reduce(
    (max, r) => Math.max(max, parseFormulationInternalCodeNum(r.internalCode)),
    0,
  )
  return formatFormulationInternalCode(Math.max(fromField, maxExisting + 1, 1))
}

function normalizeBatchRun(r: FormulationBatchRun): FormulationBatchRun {
  // Статус по умолчанию: исторические замесы уже проведены на складе → confirmed.
  const status: FormulationBatchStatus =
    r.status && VALID_BATCH_STATUSES.has(r.status) ? r.status : 'confirmed'
  return { ...r, status }
}

const VALID_CATEGORIES = new Set<FormulationCategory>([
  '75',
  '130',
  '145',
  '145ultra',
  '160',
  '165ultra',
  'membrane',
  'ratl',
  'glasspaper',
  'logo',
  'other',
])

const VALID_COLORS = new Set<FormulationColorVariant>([
  'white',
  'yellow',
  'orange',
  'red',
  'blue',
  'green',
  'black',
  'grey',
  'other',
])

function normalizeComponent(c: FormulationComponent): FormulationComponent {
  const normalized = {
    id: c.id || newId(),
    name: c.name?.trim() ?? '',
    weightKg: Number(c.weightKg) || 0,
    batchKg: c.batchKg != null ? Number(c.batchKg) : undefined,
    sharePct: c.sharePct != null ? Number(c.sharePct) : undefined,
    pricePerKg: c.pricePerKg != null ? Number(c.pricePerKg) : undefined,
    costPerBatch: c.costPerBatch != null ? Number(c.costPerBatch) : undefined,
    isWater: c.isWater === true || c.name?.trim().toLowerCase() === 'вода',
    pigmentPasteId: c.pigmentPasteId || undefined,
    warehouseItemId: c.warehouseItemId || undefined,
  }
  if (isFormulationWaterComponent(normalized)) {
    return { ...normalized, isWater: true, warehouseItemId: undefined }
  }
  return normalized
}

export function normalizeFormulationRecipe(r: FormulationRecipe): FormulationRecipe {
  const category = VALID_CATEGORIES.has(r.category as FormulationCategory)
    ? (r.category as FormulationCategory)
    : 'other'
  const colorVariant =
    r.colorVariant && VALID_COLORS.has(r.colorVariant as FormulationColorVariant)
      ? (r.colorVariant as FormulationColorVariant)
      : undefined
  const currency: FormulationCurrency =
    r.currency === 'USD' || r.currency === 'GEL' ? r.currency : 'EUR'
  return {
    ...r,
    code: r.code?.trim() || 'РП-000001',
    name: r.name?.trim() ?? '',
    category,
    variantCode: r.variantCode?.trim() || undefined,
    colorVariant,
    grammageGsm: r.grammageGsm && r.grammageGsm > 0 ? r.grammageGsm : undefined,
    currency,
    dryBatchKg: r.dryBatchKg && r.dryBatchKg > 0 ? r.dryBatchKg : undefined,
    totalBatchKg: r.totalBatchKg && r.totalBatchKg > 0 ? r.totalBatchKg : undefined,
    totalCost: r.totalCost != null ? Number(r.totalCost) : undefined,
    note: r.note?.trim() || undefined,
    labelText: r.labelText?.trim() || undefined,
    components: (r.components ?? []).map(normalizeComponent),
    outputWarehouseItemId: r.outputWarehouseItemId || undefined,
    active: r.active !== false,
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  }
}

function normalizePigment(p: PigmentPaste): PigmentPaste {
  return {
    id: p.id || newId(),
    name: p.name?.trim() ?? '',
    colorIndex: p.colorIndex?.trim() || undefined,
    pricePerKg: p.pricePerKg != null ? Number(p.pricePerKg) : undefined,
    currency: p.currency === 'EUR' || p.currency === 'GEL' ? p.currency : 'USD',
    active: p.active !== false,
  }
}

function loadSeedPigments(): PigmentPaste[] {
  return []
}

/** Пустые рецептуры — технологи создают заново из склада */
export function createDefaultFormulations(): FormulationStore {
  return {
    recipes: [],
    pigmentPastes: loadSeedPigments(),
    nextRecipeCode: 1,
    batchRuns: [],
    nextInternalCode: 1,
    mixTasks: [],
  }
}

function normalizeBatchRuns(raw: unknown): FormulationBatchRun[] {
  return Array.isArray(raw) ? raw.map(normalizeBatchRun) : []
}

/** Следующий счётчик внутренних кодов с учётом уже существующих */
function resolveNextInternalCode(
  runs: FormulationBatchRun[],
  rawNext: number | undefined,
): number {
  const maxExisting = runs.reduce(
    (max, r) => Math.max(max, parseFormulationInternalCodeNum(r.internalCode)),
    0,
  )
  return Math.max(rawNext ?? 1, maxExisting + 1, 1)
}

export function normalizeFormulationStore(
  raw: FormulationStore | undefined,
): FormulationStore {
  const pigmentPastes = (raw?.pigmentPastes ?? []).map(normalizePigment)
  const defaults = createDefaultFormulations()

  if (!raw?.recipes?.length) {
    const batchRuns = normalizeBatchRuns(raw?.batchRuns)
    return {
      ...defaults,
      pigmentPastes: pigmentPastes.length ? pigmentPastes : defaults.pigmentPastes,
      nextRecipeCode: raw?.nextRecipeCode ?? 1,
      batchRuns,
      nextInternalCode: resolveNextInternalCode(batchRuns, raw?.nextInternalCode),
      mixTasks: normalizeMixTasks(raw?.mixTasks),
      grammageRegistry: normalizeGrammageRegistry(raw?.grammageRegistry, []),
    }
  }

  // Сохраняем ВСЕ рецепты (раньше неполностью привязанные молча удалялись —
  // это приводило к потере свежесозданных рецептов). Готовность к замесу
  // проверяется отдельно (recipeFullyLinkedToWarehouse) в момент проводки.
  const recipes = raw.recipes.map(normalizeFormulationRecipe)

  const maxFromCodes = recipes.reduce((max, r) => {
    const m = r.code.match(/(\d+)\s*$/)
    return m ? Math.max(max, Number(m[1])) : max
  }, 0)

  const batchRuns = normalizeBatchRuns(raw.batchRuns)

  return {
    recipes,
    pigmentPastes: pigmentPastes.length ? pigmentPastes : defaults.pigmentPastes,
    nextRecipeCode: Math.max(raw.nextRecipeCode ?? 1, maxFromCodes + 1, 1),
    batchRuns,
    nextInternalCode: resolveNextInternalCode(batchRuns, raw.nextInternalCode),
    mixTasks: normalizeMixTasks(raw.mixTasks),
    grammageRegistry: normalizeGrammageRegistry(raw.grammageRegistry, recipes),
  }
}

export function nextFormulationCode(store: FormulationStore): string {
  return `РП-${String(store.nextRecipeCode).padStart(4, '0')}`
}

export function emptyFormulationComponent(): FormulationComponent {
  return { id: newId(), name: '', weightKg: 0 }
}

export function emptyFormulationRecipe(store: FormulationStore): FormulationRecipe {
  const now = new Date().toISOString()
  return {
    id: newId(),
    code: nextFormulationCode(store),
    name: '',
    category: '145',
    currency: 'EUR',
    components: [],
    active: true,
    createdAt: now,
    updatedAt: now,
  }
}

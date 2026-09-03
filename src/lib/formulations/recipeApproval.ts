/**
 * PHASE P1B — recipe version approval and immutable order norm snapshots.
 * Extends FormulationStore; does not rewrite legacy FormulationRecipe rows.
 */
import type { AccessRoleId, AccessStore, AppUser } from '@/lib/access/types'
import type { FormulationComponent, FormulationRecipe, FormulationStore } from './types'

export type RecipeApprovalStatus = 'draft' | 'approved' | 'retired'

export type RecipeNormBase = 'per_m2' | 'per_batch' | 'per_roll'

export type FormulationRecipeVersionComponent = {
  lineId: string
  warehouseItemId: string
  itemCodeSnapshot?: string
  itemNameSnapshot?: string
  unitSnapshot: string
  /** Norm quantity in unitSnapshot per normBase */
  normQty: number
  tolerancePct: number
  isWater?: boolean
}

export type FormulationRecipeVersion = {
  id: string
  /** Stable recipe/product family id (FormulationRecipe.id) */
  recipeId: string
  versionNumber: number
  status: RecipeApprovalStatus
  effectiveFrom?: string
  effectiveTo?: string
  components: FormulationRecipeVersionComponent[]
  normBase: RecipeNormBase
  /** Optional: batch size for per_batch base */
  batchSize?: number
  contentHash: string
  note?: string
  createdBy?: string
  createdByName?: string
  createdAt: string
  approvedBy?: string
  approvedByName?: string
  approvedAt?: string
  retiredAt?: string
  retiredBy?: string
  /** Source legacy recipe revision mark */
  sourceRecipeUpdatedAt?: string
}

/** Immutable snapshot frozen on ProductionOrder confirm/activate */
export type RecipeNormSnapshot = {
  recipeId: string
  recipeVersionId: string
  versionNumber: number
  contentHash: string
  approvedBy?: string
  approvedAt?: string
  normBase: RecipeNormBase
  batchSize?: number
  components: FormulationRecipeVersionComponent[]
  snappedAt: string
  /** Explicit legacy capture by director */
  legacyCapture?: boolean
  legacyCaptureReason?: string
}

export const RECIPE_NOT_APPROVED = 'formulations.recipe.errNotApproved' as const
export const RECIPE_IMMUTABLE = 'formulations.recipe.errImmutable' as const
export const RECIPE_APPROVE_FORBIDDEN = 'formulations.recipe.errApproveForbidden' as const
export const RECIPE_EDIT_FORBIDDEN = 'formulations.recipe.errEditForbidden' as const
export const LEGACY_CAPTURE_REASON_REQUIRED = 'formulations.recipe.errLegacyReason' as const

export function hashRecipeVersionContent(
  input: Pick<FormulationRecipeVersion, 'recipeId' | 'versionNumber' | 'normBase' | 'batchSize' | 'components'>,
): string {
  const payload = JSON.stringify({
    recipeId: input.recipeId,
    versionNumber: input.versionNumber,
    normBase: input.normBase,
    batchSize: input.batchSize ?? null,
    components: input.components.map((c) => ({
      warehouseItemId: c.warehouseItemId,
      unitSnapshot: c.unitSnapshot,
      normQty: Math.round(c.normQty * 1e6) / 1e6,
      tolerancePct: c.tolerancePct,
    })),
  })
  let h = 2166136261
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `rv_${(h >>> 0).toString(16)}`
}

export function listRecipeVersions(
  store: Pick<FormulationStore, 'recipeVersions'>,
  recipeId: string,
): FormulationRecipeVersion[] {
  return (store.recipeVersions ?? [])
    .filter((v) => v.recipeId === recipeId)
    .slice()
    .sort((a, b) => b.versionNumber - a.versionNumber)
}

export function getApprovedRecipeVersion(
  store: Pick<FormulationStore, 'recipeVersions'>,
  recipeId: string,
  atIso?: string,
): FormulationRecipeVersion | undefined {
  const at = atIso ?? new Date().toISOString()
  return listRecipeVersions(store, recipeId).find((v) => {
    if (v.status !== 'approved') return false
    if (v.effectiveFrom && v.effectiveFrom > at.slice(0, 10)) return false
    if (v.effectiveTo && v.effectiveTo < at.slice(0, 10)) return false
    return true
  })
}

export function isLegacyUnapprovedRecipe(
  store: Pick<FormulationStore, 'recipes' | 'recipeVersions'>,
  recipeId: string,
): boolean {
  const recipe = store.recipes.find((r) => r.id === recipeId)
  if (!recipe) return true
  return !getApprovedRecipeVersion(store, recipeId)
}

export function canEditRecipeDraft(
  user: AppUser | null | undefined,
): boolean {
  if (!user?.active) return false
  return (
    user.roleId === 'technologist' ||
    user.roleId === 'operations_director' ||
    user.roleId === 'sysadmin'
  )
}

export function canApproveRecipeVersion(
  user: AppUser | null | undefined,
  access?: AccessStore | null,
  opts?: { reason?: string },
): boolean {
  return assertCanApproveRecipeVersion(user, access, opts).ok
}

/** Chief technologist approval: technologist only when capability set; director always; sysadmin emergency+reason */
export function assertCanApproveRecipeVersion(
  user: AppUser | null | undefined,
  access: AccessStore | null | undefined,
  opts?: { reason?: string },
): { ok: true } | { ok: false; error: string } {
  if (!user?.active) return { ok: false, error: RECIPE_APPROVE_FORBIDDEN }
  if (user.roleId === 'operations_director') return { ok: true }
  if (user.roleId === 'technologist') {
    // Explicit «главный технолог» capability — never auto-granted to all technologists
    if (access?.roleAllowRecipeApproval?.technologist === true) return { ok: true }
    return { ok: false, error: RECIPE_APPROVE_FORBIDDEN }
  }
  if (user.roleId === 'sysadmin') {
    if (!opts?.reason?.trim()) return { ok: false, error: RECIPE_APPROVE_FORBIDDEN }
    return { ok: true }
  }
  return { ok: false, error: RECIPE_APPROVE_FORBIDDEN }
}

export function componentsFromLegacyRecipe(
  recipe: FormulationRecipe,
  itemLookup?: (id: string) => { code?: string; name?: string; unit?: string } | undefined,
  defaultTolerancePct = 5,
): FormulationRecipeVersionComponent[] {
  return recipe.components
    .filter((c) => Boolean(c.warehouseItemId?.trim()))
    .map((c, idx) => {
      const item = c.warehouseItemId ? itemLookup?.(c.warehouseItemId) : undefined
      return {
        lineId: c.id || `comp-${idx}`,
        warehouseItemId: c.warehouseItemId!,
        itemCodeSnapshot: item?.code,
        itemNameSnapshot: item?.name ?? c.name,
        unitSnapshot: item?.unit ?? 'kg',
        normQty: c.weightKg > 0 ? c.weightKg : 0,
        tolerancePct: defaultTolerancePct,
        isWater: c.isWater,
      }
    })
}

export function createDraftRecipeVersion(
  store: FormulationStore,
  input: {
    recipeId: string
    components: FormulationRecipeVersionComponent[]
    normBase?: RecipeNormBase
    batchSize?: number
    note?: string
    actor?: { id?: string; name?: string }
    sourceRecipeUpdatedAt?: string
  },
): { store: FormulationStore; version: FormulationRecipeVersion } | { error: string } {
  if (!input.components.length || input.components.some((c) => !c.warehouseItemId?.trim())) {
    return { error: 'formulations.recipe.errComponents' }
  }
  const existing = listRecipeVersions(store, input.recipeId)
  const versionNumber = (existing[0]?.versionNumber ?? 0) + 1
  const draftBase = {
    recipeId: input.recipeId,
    versionNumber,
    normBase: input.normBase ?? 'per_batch',
    batchSize: input.batchSize,
    components: input.components,
  }
  const version: FormulationRecipeVersion = {
    id: crypto.randomUUID(),
    ...draftBase,
    status: 'draft',
    contentHash: hashRecipeVersionContent(draftBase),
    note: input.note,
    createdBy: input.actor?.id,
    createdByName: input.actor?.name,
    createdAt: new Date().toISOString(),
    sourceRecipeUpdatedAt: input.sourceRecipeUpdatedAt,
  }
  return {
    store: {
      ...store,
      recipeVersions: [...(store.recipeVersions ?? []), version],
    },
    version,
  }
}

export function updateDraftRecipeVersion(
  store: FormulationStore,
  versionId: string,
  patch: Partial<
    Pick<FormulationRecipeVersion, 'components' | 'normBase' | 'batchSize' | 'note' | 'effectiveFrom' | 'effectiveTo'>
  >,
): { store: FormulationStore; version: FormulationRecipeVersion } | { error: string } {
  const list = [...(store.recipeVersions ?? [])]
  const idx = list.findIndex((v) => v.id === versionId)
  if (idx < 0) return { error: 'formulations.recipe.errNotFound' }
  const cur = list[idx]!
  if (cur.status !== 'draft') return { error: RECIPE_IMMUTABLE }
  const next: FormulationRecipeVersion = {
    ...cur,
    ...patch,
    components: patch.components ?? cur.components,
  }
  next.contentHash = hashRecipeVersionContent(next)
  list[idx] = next
  return { store: { ...store, recipeVersions: list }, version: next }
}

export function approveRecipeVersion(
  store: FormulationStore,
  versionId: string,
  actor: { id?: string; name?: string; roleId?: AccessRoleId },
  access?: AccessStore | null,
  opts?: { reason?: string },
): {
  store: FormulationStore
  version: FormulationRecipeVersion
  auditDetail: string
} | { error: string } {
  const gate = assertCanApproveRecipeVersion(
    actor.roleId
      ? ({ active: true, roleId: actor.roleId, id: actor.id ?? '', displayName: actor.name ?? '', login: '', passwordHash: '', passwordSalt: '' } as AppUser)
      : null,
    access,
    opts,
  )
  if (!gate.ok) return { error: gate.error }

  const list = [...(store.recipeVersions ?? [])]
  const idx = list.findIndex((v) => v.id === versionId)
  if (idx < 0) return { error: 'formulations.recipe.errNotFound' }
  const cur = list[idx]!
  if (cur.status !== 'draft') return { error: RECIPE_IMMUTABLE }

  const now = new Date().toISOString()
  // Retire previous approved for same recipe
  for (let i = 0; i < list.length; i++) {
    const v = list[i]!
    if (v.recipeId === cur.recipeId && v.status === 'approved' && v.id !== cur.id) {
      list[i] = { ...v, status: 'retired', retiredAt: now, retiredBy: actor.id }
    }
  }
  const approved: FormulationRecipeVersion = {
    ...cur,
    status: 'approved',
    approvedAt: now,
    approvedBy: actor.id,
    approvedByName: actor.name,
    contentHash: hashRecipeVersionContent(cur),
    note:
      actor.roleId === 'sysadmin' && opts?.reason?.trim()
        ? [cur.note, `emergency:${opts.reason.trim()}`].filter(Boolean).join(' · ')
        : cur.note,
  }
  list[idx] = approved
  const auditDetail =
    actor.roleId === 'sysadmin'
      ? `Emergency approve recipe version ${approved.id} · v${approved.versionNumber} · ${opts?.reason?.trim()}`
      : `Approve recipe version ${approved.id} · v${approved.versionNumber} · role=${actor.roleId ?? '?'}`
  return { store: { ...store, recipeVersions: list }, version: approved, auditDetail }
}

export function buildNormSnapshotFromVersion(
  version: FormulationRecipeVersion,
  opts?: { legacyCapture?: boolean; legacyCaptureReason?: string },
): RecipeNormSnapshot {
  return {
    recipeId: version.recipeId,
    recipeVersionId: version.id,
    versionNumber: version.versionNumber,
    contentHash: version.contentHash,
    approvedBy: version.approvedBy,
    approvedAt: version.approvedAt,
    normBase: version.normBase,
    batchSize: version.batchSize,
    components: version.components.map((c) => ({ ...c })),
    snappedAt: new Date().toISOString(),
    legacyCapture: opts?.legacyCapture,
    legacyCaptureReason: opts?.legacyCaptureReason,
  }
}

/** Director captures immutable norm from live legacy recipe without approved version. */
export function captureLegacyNormSnapshot(
  recipe: FormulationRecipe,
  actor: { id?: string; name?: string; roleId?: AccessRoleId },
  reason: string,
  itemLookup?: (id: string) => { code?: string; name?: string; unit?: string } | undefined,
): { snapshot: RecipeNormSnapshot } | { error: string } {
  if (actor.roleId !== 'operations_director' && actor.roleId !== 'sysadmin') {
    return { error: RECIPE_APPROVE_FORBIDDEN }
  }
  if (actor.roleId === 'sysadmin' && !reason.trim()) {
    return { error: LEGACY_CAPTURE_REASON_REQUIRED }
  }
  if (!reason.trim()) return { error: LEGACY_CAPTURE_REASON_REQUIRED }
  const components = componentsFromLegacyRecipe(recipe, itemLookup)
  if (!components.length) return { error: 'formulations.recipe.errComponents' }
  const pseudo = {
    recipeId: recipe.id,
    versionNumber: 0,
    normBase: 'per_batch' as const,
    batchSize: recipe.totalBatchKg,
    components,
  }
  return {
    snapshot: {
      recipeId: recipe.id,
      recipeVersionId: `legacy::${recipe.id}`,
      versionNumber: 0,
      contentHash: hashRecipeVersionContent(pseudo),
      approvedBy: actor.id,
      approvedAt: new Date().toISOString(),
      normBase: 'per_batch',
      batchSize: recipe.totalBatchKg,
      components,
      snappedAt: new Date().toISOString(),
      legacyCapture: true,
      legacyCaptureReason: reason.trim(),
    },
  }
}

export function normalizeRecipeVersions(
  raw: unknown,
): FormulationRecipeVersion[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v) => v && typeof v === 'object' && typeof (v as FormulationRecipeVersion).id === 'string') as FormulationRecipeVersion[]
}

export type { FormulationComponent }

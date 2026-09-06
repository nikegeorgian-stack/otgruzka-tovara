/**
 * R2.9E-B1 — recipe authorization (R29D-001) + BOM/version gate (R29D-005).
 */
import { describe, expect, it } from 'vitest'
import type { AccessRoleId, AppUser } from '@/lib/access/types'
import { recipeDryBatchKg, recipeTotalBatchKg } from '@/lib/formulations/calc'
import {
  emptyFormulationComponent,
  emptyFormulationRecipe,
  normalizeFormulationStore,
} from '@/lib/formulations/init'
import {
  createDraftRecipeVersion,
  listRecipeVersions,
  RECIPE_COMPONENTS,
  RECIPE_INVALID_QTY,
  validateRecipeBomForVersion,
} from '@/lib/formulations/recipeApproval'
import {
  assertCanEditRecipe,
  assertCanSubmitRecipe,
  canShowRecipeEditActions,
  RECIPE_ACTOR_UNRESOLVED,
  RECIPE_SUBMIT_FORBIDDEN,
  resolveRecipeAccessUser,
} from '@/lib/formulations/recipeAuth'
import { RECIPE_EDIT_FORBIDDEN } from '@/lib/formulations/recipeApproval'
import { createDefaultStore } from '@/lib/storage'
import type { AppStore } from '@/lib/types'
import { createDirectoriesSlice } from '@/store/slices/directoriesSlice'
import type { SetStore } from '@/store/storeApi'

function user(
  id: string,
  login: string,
  roleId: AccessRoleId,
  active = true,
): AppUser {
  return {
    id,
    login,
    displayName: login,
    roleId,
    passwordHash: 'x',
    passwordSalt: 'y',
    active,
  }
}

function withAccess(store: AppStore, users: AppUser[]): AppStore {
  return {
    ...store,
    access: {
      ...store.access,
      users: [...store.access.users.filter((u) => !users.some((n) => n.login === u.login)), ...users],
    },
  }
}

function makeSlice(initial: AppStore, getActor: () => { id?: string; name?: string; login?: string } | null) {
  let store = initial
  const setStore: SetStore = (updater) => {
    store = typeof updater === 'function' ? updater(store) : updater
  }
  const slice = createDirectoriesSlice({
    setStore,
    getStore: () => store,
    getActor,
  })
  return {
    get store() {
      return store
    },
    setStore,
    slice,
  }
}

function validBomRecipe(store: AppStore) {
  const recipe = emptyFormulationRecipe(store.formulations)
  recipe.code = 'РП-B1'
  recipe.name = 'EDU-B1'
  recipe.totalBatchKg = 100
  recipe.dryBatchKg = 50
  recipe.components = [
    {
      ...emptyFormulationComponent(),
      id: 'c1',
      name: 'Latex',
      warehouseItemId: 'wh-latex',
      weightKg: 40,
      batchKg: 40,
    },
    {
      ...emptyFormulationComponent(),
      id: 'c2',
      name: 'Paste',
      warehouseItemId: 'wh-paste',
      weightKg: 10,
      batchKg: 10,
    },
    {
      ...emptyFormulationComponent(),
      id: 'c3',
      name: 'Вода',
      warehouseItemId: 'wh-water',
      weightKg: 50,
      batchKg: 50,
      isWater: true,
    },
  ]
  return recipe
}

describe('R2.9E-B1 recipe authorization', () => {
  it('resolves access user by login when Firebase UID ≠ store id', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('store-tech-id', 'tech@edu.test', 'technologist'),
    ])
    const resolved = resolveRecipeAccessUser(store.access, {
      id: 'firebase-uid-xyz',
      login: 'tech@edu.test',
    })
    expect(resolved?.id).toBe('store-tech-id')
    expect(resolved?.roleId).toBe('technologist')
  })

  it.each([
    ['technologist', true],
    ['operations_director', true],
    ['sysadmin', true],
    ['warehouse_keeper', false],
    ['employee', false],
  ] as const)('role %s edit/submit allowed=%s', (roleId, allowed) => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('u1', 'u1@test', roleId),
    ])
    const session = { id: 'u1', login: 'u1@test' }
    expect(assertCanEditRecipe(store.access, session).ok).toBe(allowed)
    expect(assertCanSubmitRecipe(store.access, session).ok).toBe(allowed)
    expect(canShowRecipeEditActions(store.access, session)).toBe(allowed)
  })

  it('Firebase UID with no id match but valid login principal is allowed', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('legacy-tech', 'nike@edu.test', 'technologist'),
    ])
    const session = { id: 'GzqqX13iDjfSyxDoD9iFXiHmhdX2', login: 'nike@edu.test' }
    const auth = assertCanSubmitRecipe(store.access, session)
    expect(auth.ok).toBe(true)
    expect(canShowRecipeEditActions(store.access, session)).toBe(true)
  })

  it('hardcoded admin email without access row is denied (no FST_ADMIN bypass)', () => {
    const store = createDefaultStore() as AppStore
    // Ensure no matching access row for this login
    store.access = {
      ...store.access,
      users: store.access.users.filter((u) => u.login !== 'admin@fibercell.net'),
    }
    const session = { id: 'firebase-admin', login: 'admin@fibercell.net' }
    const auth = assertCanSubmitRecipe(store.access, session)
    expect(auth.ok).toBe(false)
    if (!auth.ok) expect(auth.error).toBe(RECIPE_ACTOR_UNRESOLVED)
  })

  it('unverified email alone never grants recipe permission', () => {
    const store = createDefaultStore() as AppStore
    const session = { id: undefined, login: 'random@example.com' }
    expect(assertCanEditRecipe(store.access, session).ok).toBe(false)
    expect(assertCanSubmitRecipe(store.access, session).ok).toBe(false)
  })

  it('unknown / missing actor fails closed', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    expect(assertCanSubmitRecipe(store.access, null).ok).toBe(false)
    expect(assertCanSubmitRecipe(store.access, { id: 'nope' }).ok).toBe(false)
  })

  it('UI visibility and domain submit agree for educational UID mismatch', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('legacy-tech', 'edu-tech@test', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    store = {
      ...store,
      formulations: { ...store.formulations, recipes: [recipe] },
    }
    const session = { id: 'firebase-edu-uid', login: 'edu-tech@test', name: 'Edu Tech' }
    expect(canShowRecipeEditActions(store.access, session)).toBe(true)

    const ctx = makeSlice(store, () => session)
    const result = ctx.slice.submitFormulationRecipeVersion(recipe.id, { approve: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(listRecipeVersions(ctx.store.formulations, recipe.id)).toHaveLength(1)
      expect(listRecipeVersions(ctx.store.formulations, recipe.id)[0]!.createdBy).toBe(
        'firebase-edu-uid',
      )
    }
  })

  it('warehouse role denied on submit path (domain)', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('wk-1', 'wk@test', 'warehouse_keeper'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'wk-1', login: 'wk@test' }))
    const result = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe(RECIPE_SUBMIT_FORBIDDEN)
    }
  })
})

describe('R2.9E-B1 recipe version / BOM', () => {
  it('empty components rejected with no state mutation', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = emptyFormulationRecipe(store.formulations)
    recipe.components = []
    recipe.totalBatchKg = 50
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const before = JSON.stringify(store.formulations.recipeVersions ?? [])
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    const result = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe(RECIPE_COMPONENTS)
    expect(JSON.stringify(ctx.store.formulations.recipeVersions ?? [])).toBe(before)
  })

  it('missing warehouseItemId rejected', () => {
    const recipe = emptyFormulationRecipe((createDefaultStore() as AppStore).formulations)
    recipe.components = [
      { ...emptyFormulationComponent(), name: 'X', weightKg: 10, batchKg: 10 },
    ]
    expect(validateRecipeBomForVersion(recipe).ok).toBe(false)
  })

  it.each([0, -1, NaN])('rejects quantity %s', (qty) => {
    const recipe = emptyFormulationRecipe((createDefaultStore() as AppStore).formulations)
    recipe.components = [
      {
        ...emptyFormulationComponent(),
        name: 'X',
        warehouseItemId: 'w1',
        weightKg: qty,
        batchKg: qty,
      },
    ]
    const v = validateRecipeBomForVersion(recipe)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe(RECIPE_INVALID_QTY)
  })

  it('valid BOM creates exactly one draft with full snapshot', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    const r1 = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(r1.ok).toBe(true)
    const versions = listRecipeVersions(ctx.store.formulations, recipe.id)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.status).toBe('draft')
    expect(versions[0]!.components).toHaveLength(3)
    expect(versions[0]!.components.map((c) => c.warehouseItemId).sort()).toEqual(
      ['wh-latex', 'wh-paste', 'wh-water'].sort(),
    )
    expect(versions[0]!.batchSize).toBe(100)
    expect(recipeDryBatchKg(recipe)).toBe(50)
    expect(recipeTotalBatchKg(recipe)).toBe(100)
    expect(`${recipeDryBatchKg(recipe)}/${recipeTotalBatchKg(recipe)}`).not.toBe('0/50')
  })

  it('listRecipeVersions returns the version after submit', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    const r = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(
        listRecipeVersions(ctx.store.formulations, recipe.id).some((v) => v.id === r.versionId),
      ).toBe(true)
    }
  })

  it('normalize/serialize/reload retains recipe, version, components and links', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    expect(ctx.slice.submitFormulationRecipeVersion(recipe.id).ok).toBe(true)
    const serialized = JSON.parse(JSON.stringify(ctx.store.formulations))
    const reloaded = normalizeFormulationStore(serialized)
    expect(reloaded.recipes).toHaveLength(1)
    expect(reloaded.recipes[0]!.id).toBe(recipe.id)
    expect(reloaded.recipes[0]!.components[0]!.warehouseItemId).toBe('wh-latex')
    const vers = listRecipeVersions(reloaded, recipe.id)
    expect(vers).toHaveLength(1)
    expect(vers[0]!.components).toHaveLength(3)
    expect(vers[0]!.batchSize).toBe(100)
  })

  it('failed submit does not show false success', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('wk-1', 'wk', 'warehouse_keeper'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'wk-1', login: 'wk' }))
    const result = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(result).toEqual({ ok: false, error: RECIPE_SUBMIT_FORBIDDEN })
  })

  it('repeated submit does not create unintended duplicates', () => {
    let store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    store = { ...store, formulations: { ...store.formulations, recipes: [recipe] } }
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    const a = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    const b = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(a.versionId).toBe(b.versionId)
      expect(listRecipeVersions(ctx.store.formulations, recipe.id)).toHaveLength(1)
    }
  })

  it('createDraftRecipeVersion rejects empty shell BOM', () => {
    const store = (createDefaultStore() as AppStore).formulations
    const out = createDraftRecipeVersion(store, {
      recipeId: 'r1',
      components: [],
    })
    expect('error' in out && out.error).toBe(RECIPE_COMPONENTS)
  })

  it('id-only mismatch without login remains edit-forbidden (regression)', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('legacy-tech', 'edu-tech@test', 'technologist'),
    ])
    // Session has Firebase UID only — no login surface → unresolved
    const auth = assertCanEditRecipe(store.access, { id: 'firebase-edu-uid' })
    expect(auth.ok).toBe(false)
    if (!auth.ok) {
      expect([RECIPE_ACTOR_UNRESOLVED, RECIPE_EDIT_FORBIDDEN]).toContain(auth.error)
      expect(auth.error).toBe(RECIPE_ACTOR_UNRESOLVED)
    }
  })
})

describe('R2.9E-B1-GATE recipe save path', () => {
  it('authorized technologist can save a recipe draft', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => ({ id: 'tech-1', login: 'tech' }))
    const before = ctx.store.formulations.recipes.length
    const result = ctx.slice.upsertFormulationRecipe(recipe)
    expect(result).toEqual({ ok: true })
    expect(ctx.store.formulations.recipes.length).toBe(before + 1)
    expect(ctx.store.formulations.recipes.some((r) => r.id === recipe.id)).toBe(true)
  })

  it.each(['operations_director', 'sysadmin'] as const)(
    'authorized %s can save a recipe',
    (roleId) => {
      const store = withAccess(createDefaultStore() as AppStore, [
        user('u-role', 'role@test', roleId),
      ])
      const recipe = validBomRecipe(store)
      const ctx = makeSlice(store, () => ({ id: 'u-role', login: 'role@test' }))
      expect(ctx.slice.upsertFormulationRecipe(recipe).ok).toBe(true)
    },
  )

  it.each(['warehouse_keeper', 'employee'] as const)(
    '%s cannot save or modify a recipe',
    (roleId) => {
      const store = withAccess(createDefaultStore() as AppStore, [
        user('u-deny', 'deny@test', roleId),
      ])
      const recipe = validBomRecipe(store)
      const ctx = makeSlice(store, () => ({ id: 'u-deny', login: 'deny@test' }))
      const before = JSON.stringify(ctx.store.formulations.recipes)
      const result = ctx.slice.upsertFormulationRecipe(recipe)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe(RECIPE_EDIT_FORBIDDEN)
      expect(JSON.stringify(ctx.store.formulations.recipes)).toBe(before)
    },
  )

  it('email-only admin without AppStore access row is denied on save', () => {
    const store = createDefaultStore() as AppStore
    store.access = {
      ...store.access,
      users: store.access.users.filter((u) => u.login !== 'admin@fibercell.net'),
    }
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => ({
      id: 'firebase-admin',
      login: 'admin@fibercell.net',
    }))
    const before = JSON.stringify(ctx.store.formulations.recipes)
    const result = ctx.slice.upsertFormulationRecipe(recipe)
    expect(result).toEqual({ ok: false, error: RECIPE_ACTOR_UNRESOLVED })
    expect(JSON.stringify(ctx.store.formulations.recipes)).toBe(before)
  })

  it('inactive AppStore access user is denied on save', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('tech-off', 'tech-off@test', 'technologist', false),
    ])
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => ({ id: 'tech-off', login: 'tech-off@test' }))
    const before = JSON.stringify(ctx.store.formulations.recipes)
    const result = ctx.slice.upsertFormulationRecipe(recipe)
    expect(result).toEqual({ ok: false, error: RECIPE_ACTOR_UNRESOLVED })
    expect(JSON.stringify(ctx.store.formulations.recipes)).toBe(before)
  })

  it('unresolved actor is denied without mutation', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => null)
    const before = JSON.stringify(ctx.store.formulations.recipes)
    expect(ctx.slice.upsertFormulationRecipe(recipe)).toEqual({
      ok: false,
      error: RECIPE_ACTOR_UNRESOLVED,
    })
    expect(JSON.stringify(ctx.store.formulations.recipes)).toBe(before)
  })

  it('authorized save → submit creates one valid draft version', () => {
    const store0 = withAccess(createDefaultStore() as AppStore, [
      user('tech-1', 'tech', 'technologist'),
    ])
    const recipe = validBomRecipe(store0)
    const ctx = makeSlice(store0, () => ({ id: 'tech-1', login: 'tech' }))
    expect(ctx.slice.upsertFormulationRecipe(recipe).ok).toBe(true)
    const submit = ctx.slice.submitFormulationRecipeVersion(recipe.id)
    expect(submit.ok).toBe(true)
    const versions = listRecipeVersions(ctx.store.formulations, recipe.id)
    expect(versions).toHaveLength(1)
    // Water loses warehouseItemId on normalize — version keeps stock lines.
    expect(versions[0]!.components.filter((c) => !c.isWater)).toHaveLength(2)
    expect(versions[0]!.batchSize).toBe(100)
  })

  it('unauthorized save cannot later be submitted (recipe absent)', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      user('wk-1', 'wk', 'warehouse_keeper'),
    ])
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => ({ id: 'wk-1', login: 'wk' }))
    expect(ctx.slice.upsertFormulationRecipe(recipe).ok).toBe(false)
    expect(ctx.store.formulations.recipes.some((r) => r.id === recipe.id)).toBe(false)
    expect(ctx.slice.submitFormulationRecipeVersion(recipe.id).ok).toBe(false)
  })

  it('does not authorize by displayName fallback', () => {
    const store = withAccess(createDefaultStore() as AppStore, [
      { ...user('tech-1', 'tech@real', 'technologist'), displayName: 'admin@fibercell.net' },
    ])
    const recipe = validBomRecipe(store)
    const ctx = makeSlice(store, () => ({
      id: 'firebase-x',
      login: 'admin@fibercell.net',
      name: 'admin@fibercell.net',
    }))
    expect(ctx.slice.upsertFormulationRecipe(recipe)).toEqual({
      ok: false,
      error: RECIPE_ACTOR_UNRESOLVED,
    })
  })
})

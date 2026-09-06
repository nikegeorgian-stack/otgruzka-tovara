/**
 * Recipe-domain authorization — AppStore access.users is authoritative.
 * Resolve session actor by id OR canonical login.
 * No email allowlists / FST_ADMIN shortcuts in this module.
 */
import type { AccessStore, AppUser } from '@/lib/access/types'
import {
  canApproveRecipeVersion,
  canEditRecipeDraft,
  RECIPE_APPROVE_FORBIDDEN,
  RECIPE_EDIT_FORBIDDEN,
} from '@/lib/formulations/recipeApproval'
import type { StoreActor } from '@/store/storeApi'

export const RECIPE_ACTOR_UNRESOLVED = 'formulations.recipe.errActorUnresolved' as const
export const RECIPE_SUBMIT_FORBIDDEN = 'formulations.recipe.errSubmitForbidden' as const

export type RecipeSessionActor = StoreActor

/** Match access.users by Firebase/session id or by canonical login. Fail closed. */
export function resolveRecipeAccessUser(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
): AppUser | null {
  if (!access?.users?.length || !session) return null
  const id = session.id?.trim()
  if (id) {
    const byId = access.users.find((u) => u.id === id && u.active)
    if (byId) return byId
  }
  const login = session.login?.trim().toLowerCase()
  if (login) {
    const byLogin = access.users.find(
      (u) => u.login.trim().toLowerCase() === login && u.active,
    )
    if (byLogin) return byLogin
  }
  return null
}

export type RecipeAuthOk = { ok: true; user: AppUser }
export type RecipeAuthFail = { ok: false; error: string }

export function assertRecipeActorResolved(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
): RecipeAuthOk | RecipeAuthFail {
  const user = resolveRecipeAccessUser(access, session)
  if (!user) return { ok: false, error: RECIPE_ACTOR_UNRESOLVED }
  return { ok: true, user }
}

/** Edit / create draft / upsert legacy recipe row. */
export function assertCanEditRecipe(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
): RecipeAuthOk | RecipeAuthFail {
  const resolved = assertRecipeActorResolved(access, session)
  if (!resolved.ok) return resolved
  if (!canEditRecipeDraft(resolved.user)) {
    return { ok: false, error: RECIPE_EDIT_FORBIDDEN }
  }
  return resolved
}

/** Submit-for-review (create draft version). Same roles as edit; distinct error key. */
export function assertCanSubmitRecipe(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
): RecipeAuthOk | RecipeAuthFail {
  const resolved = assertRecipeActorResolved(access, session)
  if (!resolved.ok) return resolved
  if (!canEditRecipeDraft(resolved.user)) {
    return { ok: false, error: RECIPE_SUBMIT_FORBIDDEN }
  }
  return resolved
}

export function assertCanApproveRecipe(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
  opts?: { reason?: string },
): RecipeAuthOk | RecipeAuthFail {
  const resolved = assertRecipeActorResolved(access, session)
  if (!resolved.ok) return resolved
  if (!canApproveRecipeVersion(resolved.user, access, opts)) {
    return { ok: false, error: RECIPE_APPROVE_FORBIDDEN }
  }
  return resolved
}

/** UI: edit/submit visible when domain edit would succeed. */
export function canShowRecipeEditActions(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
): boolean {
  return assertCanEditRecipe(access, session).ok
}

/** UI: approve visible when approve would succeed (sysadmin needs reason at click time). */
export function canShowRecipeApproveActions(
  access: AccessStore | null | undefined,
  session: RecipeSessionActor | null | undefined,
  opts?: { reason?: string },
): boolean {
  return assertCanApproveRecipe(access, session, opts).ok
}

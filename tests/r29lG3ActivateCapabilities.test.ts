/**
 * R29L — G3 activate path requires canonical ACL keys (not planner/request aliases).
 * Prior smoke grant used production.request.edit → draft.save 403 forbidden.
 */
import { describe, expect, it } from 'vitest'
import { G3_CAPS } from '../server/fst/_g3Capabilities.mjs'

describe('R29L G3 activate capability keys', () => {
  it('order draft.save / confirm use production.order.* not request.*', () => {
    expect(G3_CAPS.ORDER_EDIT).toBe('production.order.edit')
    expect(G3_CAPS.ORDER_CONFIRM).toBe('production.order.confirm')
    expect(G3_CAPS.MATERIAL_ISSUE).toBe('production.material.issue')
    expect(G3_CAPS.RECIPE_DRAFT_EDIT).toBe('production.recipe.draft.edit')
  })

  it('legacy broken aliases stay out of G3_CAPS; request.post is now real', () => {
    const brokenAliases = [
      'production.request.edit',
      'production.material.issueToLine',
      'planner.order.edit',
      'formulations.draft.edit',
    ]
    const required = new Set(Object.values(G3_CAPS))
    for (const alias of brokenAliases) {
      expect(required.has(alias)).toBe(false)
    }
    expect(G3_CAPS.REQUEST_POST).toBe('production.request.post')
    expect(required.has('production.request.post')).toBe(true)
  })
})

/**
 * G5.3 — activation wizard SSR/DOM smoke (no production login).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { G5_ACTIVATION_CONFIRM_PHRASE } from '../src/lib/planner/g5ActivationScan'

vi.mock('@/context/I18nContext', () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tf: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    locale: 'ru',
  }),
}))

vi.mock('@/lib/planner/g5ServerClient', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/planner/g5ServerClient')>(
    '../src/lib/planner/g5ServerClient',
  )
  return {
    ...actual,
    g5MasterdataDomainActivate: Object.assign(
      vi.fn(async () => ({ ok: true, data: { masterDataActive: true } })),
      { commandType: 'masterdata.domain.activate' },
    ),
    g5SalesDomainActivate: Object.assign(
      vi.fn(async () => ({ ok: true, data: { salesPlanningActive: true } })),
      { commandType: 'sales.domain.activate' },
    ),
    g5ProcurementDomainActivate: Object.assign(
      vi.fn(async () => ({ ok: true, data: { procurementActive: true } })),
      { commandType: 'procurement.domain.activate' },
    ),
  }
})

function buttonOpenTag(html: string, testId: string): string {
  const m = html.match(new RegExp(`<button\\b[^>]*data-testid="${testId}"[^>]*>`, 'i'))
  return m?.[0] ?? ''
}

function isDisabledButton(html: string, testId: string): boolean {
  return /\bdisabled(?:=""|\b)/.test(buttonOpenTag(html, testId))
}

describe('G5.3 activation wizard', () => {
  it('non-admin: no activate buttons in SSR markup', async () => {
    const { G5ActivationWizard } = await import('../src/components/planner/G5ActivationWizard')
    const html = renderToStaticMarkup(
      createElement(G5ActivationWizard, {
        store: null,
        canActivateG5: false,
        initialStep: 5,
        initialPhraseConfirmed: true,
        initialConfirmPhrase: G5_ACTIVATION_CONFIRM_PHRASE,
      }),
    )
    expect(html).toContain('g5-activation-status')
    expect(html).not.toContain('g5-activate-masterData')
    expect(html).not.toContain('g5-activate-salesPlanning')
    expect(html).not.toContain('g5-activate-procurement')
    expect(html).toContain('g5.activation.statusOnlyHint')
  })

  it('admin: steps require phrase before enable', async () => {
    const { G5ActivationWizard } = await import('../src/components/planner/G5ActivationWizard')
    const locked = renderToStaticMarkup(
      createElement(G5ActivationWizard, {
        store: null,
        canActivateG5: true,
        initialStep: 5,
        initialPhraseConfirmed: false,
        initialConfirmPhrase: '',
      }),
    )
    expect(locked).toContain('g5-activate-masterData')
    expect(locked).toContain('g5-activation-locked')
    expect(isDisabledButton(locked, 'g5-activate-masterData')).toBe(true)

    const unlocked = renderToStaticMarkup(
      createElement(G5ActivationWizard, {
        store: null,
        canActivateG5: true,
        initialStep: 5,
        initialPhraseConfirmed: true,
        initialConfirmPhrase: G5_ACTIVATION_CONFIRM_PHRASE,
        flagsOverride: {
          masterDataActive: false,
          salesPlanningActive: false,
          procurementActive: false,
        },
      }),
    )
    expect(unlocked).not.toContain('g5-activation-locked')
    expect(isDisabledButton(unlocked, 'g5-activate-masterData')).toBe(false)
  })

  it('order gating: sales disabled until masterData flag true', async () => {
    const { G5ActivationWizard } = await import('../src/components/planner/G5ActivationWizard')
    const before = renderToStaticMarkup(
      createElement(G5ActivationWizard, {
        store: null,
        canActivateG5: true,
        initialStep: 5,
        initialPhraseConfirmed: true,
        initialConfirmPhrase: G5_ACTIVATION_CONFIRM_PHRASE,
        flagsOverride: {
          masterDataActive: false,
          salesPlanningActive: false,
          procurementActive: false,
        },
      }),
    )
    expect(isDisabledButton(before, 'g5-activate-salesPlanning')).toBe(true)
    expect(isDisabledButton(before, 'g5-activate-procurement')).toBe(true)

    const after = renderToStaticMarkup(
      createElement(G5ActivationWizard, {
        store: null,
        canActivateG5: true,
        initialStep: 5,
        initialPhraseConfirmed: true,
        initialConfirmPhrase: G5_ACTIVATION_CONFIRM_PHRASE,
        flagsOverride: {
          masterDataActive: true,
          salesPlanningActive: false,
          procurementActive: false,
        },
      }),
    )
    expect(isDisabledButton(after, 'g5-activate-salesPlanning')).toBe(false)
    expect(isDisabledButton(after, 'g5-activate-procurement')).toBe(true)
  })
})

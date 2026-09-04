/**
 * PHASE G5.3 — admin-only multi-step G5 activation wizard (not a one-click MRP button).
 * Local scan → preview → dry-run → typed confirm → ordered domain activate buttons.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import type { AccessStore, AppUser } from '@/lib/access/types'
import {
  G5_ACTIVATION_CONFIRM_PHRASE,
  buildG5DryRunSummary,
  scanG5LegacyDomain,
  type G5PreviewIssue,
} from '@/lib/planner/g5ActivationScan'
import {
  g5FlagsFromStore,
  g5MasterdataDomainActivate,
  g5ProcurementDomainActivate,
  g5SalesDomainActivate,
  type G5AckPayload,
  type G5ServerResult,
} from '@/lib/planner/g5ServerClient'
import type { AppStore } from '@/lib/types'

type WizardStep = 1 | 2 | 3 | 4 | 5

export type G5ActivationWizardProps = {
  store: AppStore | null | undefined
  access?: AccessStore | unknown
  currentUser?: AppUser | null | unknown
  /** Parent decides — true only for sysadmin/admin capability. */
  canActivateG5: boolean
  onActivated?: () => void
  /** Optional override for tests (otherwise derived from store). */
  flagsOverride?: {
    masterDataActive?: boolean
    salesPlanningActive?: boolean
    procurementActive?: boolean
  }
  /** Test/SSR helper — start on a given wizard step. */
  initialStep?: WizardStep
  /** Test helper — mark phrase already confirmed (still requires exact phrase in input). */
  initialPhraseConfirmed?: boolean
  initialConfirmPhrase?: string
}

function idemKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function mapActivateError(
  result: G5ServerResult<unknown>,
  t: (k: string) => string,
): string {
  const err = result.ok === false ? String(result.error) : ''
  const msg = result.ok === false ? result.message : ''
  if (err === '401' || err === 'unauthorized' || /unauth/i.test(err)) {
    return t('g5.activation.error.unauthorized')
  }
  if (err === '403' || err === 'forbidden' || /forbidden|capability|denied/i.test(err)) {
    return t('g5.activation.error.forbidden')
  }
  if (err === '409' || /conflict|stale|revision/i.test(err) || /conflict|stale|revision/i.test(msg)) {
    return t('g5.activation.error.conflict')
  }
  return msg || err || t('g5.activation.error.generic')
}

function issueKindLabel(kind: G5PreviewIssue['kind'], t: (k: string) => string): string {
  return t(`g5.activation.issue.${kind}`)
}

export function G5ActivationWizard({
  store,
  canActivateG5,
  onActivated,
  flagsOverride,
  initialStep = 1,
  initialPhraseConfirmed = false,
  initialConfirmPhrase = '',
}: G5ActivationWizardProps) {
  const { t, tf } = useI18n()
  const [step, setStep] = useState<WizardStep>(initialStep)
  const [confirmPhrase, setConfirmPhrase] = useState(initialConfirmPhrase)
  const [phraseConfirmed, setPhraseConfirmed] = useState(initialPhraseConfirmed)
  const [inFlight, setInFlight] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [localFlags, setLocalFlags] = useState<{
    masterDataActive?: boolean
    salesPlanningActive?: boolean
    procurementActive?: boolean
  }>({})

  const storeFlags = g5FlagsFromStore(store ?? null)
  const flags = {
    masterDataActive:
      flagsOverride?.masterDataActive ??
      localFlags.masterDataActive ??
      storeFlags.masterDataActive,
    salesPlanningActive:
      flagsOverride?.salesPlanningActive ??
      localFlags.salesPlanningActive ??
      storeFlags.salesPlanningActive,
    procurementActive:
      flagsOverride?.procurementActive ??
      localFlags.procurementActive ??
      storeFlags.procurementActive,
  }

  const counts = scanG5LegacyDomain(store)
  const dryRun = buildG5DryRunSummary(store)
  const phraseOk = confirmPhrase.trim() === G5_ACTIVATION_CONFIRM_PHRASE
  const activateUnlocked = canActivateG5 && phraseConfirmed && phraseOk

  async function runActivate(
    domain: 'masterData' | 'salesPlanning' | 'procurement',
  ): Promise<void> {
    if (!activateUnlocked) return
    setInFlight(true)
    setError(null)
    setSuccess(null)
    try {
      const map = {
        masterData: g5MasterdataDomainActivate,
        salesPlanning: g5SalesDomainActivate,
        procurement: g5ProcurementDomainActivate,
      } as const
      const result = await map[domain]({
        idempotencyKey: idemKey(`g53-activate-${domain}`),
        command: { reason: 'g53-activation-wizard' },
      })
      if (!result.ok) {
        setError(mapActivateError(result, t))
        return
      }
      const data = result.data as G5AckPayload
      setLocalFlags((prev) => ({
        ...prev,
        masterDataActive:
          data.masterDataActive === true ||
          domain === 'masterData' ||
          prev.masterDataActive ||
          flags.masterDataActive,
        salesPlanningActive:
          data.salesPlanningActive === true ||
          domain === 'salesPlanning' ||
          prev.salesPlanningActive ||
          flags.salesPlanningActive,
        procurementActive:
          data.procurementActive === true ||
          domain === 'procurement' ||
          prev.procurementActive ||
          flags.procurementActive,
      }))
      setSuccess(t(`g5.activation.success.${domain}`))
      onActivated?.()
    } finally {
      setInFlight(false)
    }
  }

  const statusPanel = (
    <div
      className="rounded-sm border border-grid bg-white px-3 py-2 text-sm shadow-sm"
      data-testid="g5-activation-status"
    >
      <div className="text-xs font-bold uppercase tracking-wide text-stone-500">
        {t('g5.activation.statusTitle')}
      </div>
      <ul className="mt-2 space-y-1 font-mono text-xs text-stone-700">
        <li data-testid="g5-flag-masterData">
          masterData: {flags.masterDataActive ? 'active' : 'inactive'}
        </li>
        <li data-testid="g5-flag-salesPlanning">
          salesPlanning: {flags.salesPlanningActive ? 'active' : 'inactive'}
        </li>
        <li data-testid="g5-flag-procurement">
          procurement: {flags.procurementActive ? 'active' : 'inactive'}
        </li>
      </ul>
    </div>
  )

  if (!canActivateG5) {
    return (
      <div className="space-y-3" data-testid="g5-activation-wizard" data-coach="planner:g5-activation">
        <div
          className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950"
          role="status"
        >
          {t('g5.activation.banner.localDemo')}
        </div>
        {statusPanel}
        <p className="text-xs text-stone-500">{t('g5.activation.statusOnlyHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="g5-activation-wizard" data-coach="planner:g5-activation">
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        role="status"
        data-testid="g5-activation-banner"
      >
        {t('g5.activation.banner.localDemo')}
      </div>

      {statusPanel}

      {error && (
        <FormNotice type="error" message={error} onDismiss={() => setError(null)} />
      )}
      {success && (
        <FormNotice type="success" message={success} onDismiss={() => setSuccess(null)} />
      )}

      <div className="flex flex-wrap gap-2">
        {([1, 2, 3, 4, 5] as WizardStep[]).map((s) => (
          <Button
            key={s}
            size="xs"
            variant={step === s ? 'primary' : 'ghost'}
            onClick={() => setStep(s)}
            data-testid={`g5-activation-step-tab-${s}`}
          >
            {t(`g5.activation.step.${s}.tab`)}
          </Button>
        ))}
      </div>

      {step === 1 && (
        <section
          className="rounded-sm border border-grid bg-white p-4 shadow-sm"
          data-testid="g5-activation-step-scan"
        >
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
            {t('g5.activation.step.1.title')}
          </h3>
          <p className="mt-1 text-xs text-stone-500">{t('g5.activation.step.1.hint')}</p>
          <table className="fc-table mt-3 min-w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left">{t('g5.activation.col.domain')}</th>
                <th className="px-2 py-1 text-right">{t('g5.activation.col.count')}</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['counterparties', counts.counterparties],
                  ['finishedProducts', counts.finishedProducts],
                  ['warehouseItems', counts.warehouseItems],
                  ['salesOrders', counts.salesOrders],
                  ['purchaseOrders', counts.purchaseOrders],
                  ['packagingRecipes', counts.packagingRecipes],
                ] as const
              ).map(([key, n]) => (
                <tr key={key} className="border-t border-grid">
                  <td className="px-2 py-1">{t(`g5.activation.domain.${key}`)}</td>
                  <td className="px-2 py-1 text-right font-mono" data-testid={`g5-scan-${key}`}>
                    {n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3">
            <Button size="sm" onClick={() => setStep(2)}>
              {t('g5.activation.next')}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section
          className="overflow-auto rounded-sm border border-grid bg-white p-4 shadow-sm"
          data-testid="g5-activation-step-preview"
        >
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
            {t('g5.activation.step.2.title')}
          </h3>
          <p className="mt-1 text-xs text-stone-500">{t('g5.activation.step.2.hint')}</p>
          <table className="fc-table mt-3 min-w-full text-sm">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left">{t('g5.activation.col.kind')}</th>
                <th className="px-2 py-1 text-left">{t('g5.activation.col.entity')}</th>
                <th className="px-2 py-1 text-left">{t('g5.activation.col.id')}</th>
                <th className="px-2 py-1 text-left">{t('g5.activation.col.detail')}</th>
              </tr>
            </thead>
            <tbody>
              {dryRun.issues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-3 text-center text-stone-400">
                    {t('g5.activation.previewEmpty')}
                  </td>
                </tr>
              ) : (
                dryRun.issues.slice(0, 80).map((issue, idx) => (
                  <tr key={`${issue.kind}-${issue.id}-${idx}`} className="border-t border-grid">
                    <td className="px-2 py-1 text-xs">{issueKindLabel(issue.kind, t)}</td>
                    <td className="px-2 py-1 font-mono text-xs">{issue.entity}</td>
                    <td className="px-2 py-1 font-mono text-xs">{issue.id}</td>
                    <td className="px-2 py-1 text-xs text-stone-600">{issue.detail}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setStep(1)}>
              {t('g5.activation.back')}
            </Button>
            <Button size="sm" onClick={() => setStep(3)}>
              {t('g5.activation.next')}
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section
          className="rounded-sm border border-grid bg-white p-4 shadow-sm"
          data-testid="g5-activation-step-dryrun"
        >
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
            {t('g5.activation.step.3.title')}
          </h3>
          <p className="mt-1 text-xs text-stone-500">{t('g5.activation.step.3.hint')}</p>
          <ul className="mt-3 space-y-1 text-sm text-stone-700">
            <li>
              {tf('g5.activation.dryRun.accepted', { count: dryRun.acceptedEstimate })}
            </li>
            <li>
              {tf('g5.activation.dryRun.rejected', { count: dryRun.rejectedEstimate })}
            </li>
            <li>
              {tf('g5.activation.dryRun.issues', { count: dryRun.issues.length })}
            </li>
          </ul>
          <ul className="mt-2 list-disc pl-5 text-xs text-stone-500">
            {dryRun.notes.map((n) => {
              const m = /^g5\.activation\.note\.ordersMissingBomSnapshot:(\d+)$/.exec(n)
              if (m) {
                return (
                  <li key={n}>
                    {tf('g5.activation.note.ordersMissingBomSnapshot', {
                      count: Number(m[1]),
                    })}
                  </li>
                )
              }
              return <li key={n}>{n}</li>
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setStep(2)}>
              {t('g5.activation.back')}
            </Button>
            <Button size="sm" onClick={() => setStep(4)}>
              {t('g5.activation.next')}
            </Button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section
          className="rounded-sm border border-grid bg-white p-4 shadow-sm"
          data-testid="g5-activation-step-confirm"
        >
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
            {t('g5.activation.step.4.title')}
          </h3>
          <p className="mt-1 text-xs text-stone-500">{t('g5.activation.confirmLabel')}</p>
          <p className="mt-1 font-mono text-sm font-semibold text-stone-800">
            {G5_ACTIVATION_CONFIRM_PHRASE}
          </p>
          <input
            className="fc-input mt-2 w-full max-w-md font-mono text-sm"
            value={confirmPhrase}
            onChange={(e) => {
              setConfirmPhrase(e.target.value)
              setPhraseConfirmed(false)
            }}
            placeholder={G5_ACTIVATION_CONFIRM_PHRASE}
            data-testid="g5-activation-phrase-input"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setStep(3)}>
              {t('g5.activation.back')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!phraseOk}
              onClick={() => {
                setPhraseConfirmed(true)
                setStep(5)
              }}
              data-testid="g5-activation-confirm-phrase"
            >
              {t('g5.activation.confirmPhraseBtn')}
            </Button>
          </div>
        </section>
      )}

      {step === 5 && (
        <section
          className="rounded-sm border border-grid bg-white p-4 shadow-sm"
          data-testid="g5-activation-step-activate"
        >
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">
            {t('g5.activation.step.5.title')}
          </h3>
          <p className="mt-1 text-xs text-stone-500">{t('g5.activation.step.5.hint')}</p>
          {!activateUnlocked ? (
            <p className="mt-2 text-sm text-amber-800" data-testid="g5-activation-locked">
              {t('g5.activation.lockedUntilPhrase')}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={inFlight || !activateUnlocked || flags.masterDataActive}
              onClick={() => void runActivate('masterData')}
              data-testid="g5-activate-masterData"
            >
              {t('g5.activation.btn.masterData')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                inFlight ||
                !activateUnlocked ||
                !flags.masterDataActive ||
                flags.salesPlanningActive
              }
              onClick={() => void runActivate('salesPlanning')}
              data-testid="g5-activate-salesPlanning"
            >
              {t('g5.activation.btn.salesPlanning')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={
                inFlight ||
                !activateUnlocked ||
                !flags.salesPlanningActive ||
                flags.procurementActive
              }
              onClick={() => void runActivate('procurement')}
              data-testid="g5-activate-procurement"
            >
              {t('g5.activation.btn.procurement')}
            </Button>
          </div>
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setStep(4)}>
              {t('g5.activation.back')}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

/**
 * R2.9K — minimal UI to activate G3 production then G4 packaging QC domains.
 * Required before web packaging / QC / shipment can leave soft FstStore paths.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { isG3ProductionDomainActive, g3ProductionCommand } from '@/lib/production/g3ServerClient'
import {
  isG4PackagingQcActive,
  g4ProductionCommand,
  mirrorG4Ack,
} from '@/lib/production/g4ServerClient'
import type { AppStore } from '@/lib/types'

export type G34DomainActivationPanelProps = {
  store: AppStore | null | undefined
  canActivate: boolean
  onActivated?: (next: { warehouse: AppStore['warehouse']; production: AppStore['production'] }) => void
}

function idemKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function G34DomainActivationPanel({
  store,
  canActivate,
  onActivated,
}: G34DomainActivationPanelProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<'g3' | 'g4' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const production = store?.production as unknown as Record<string, unknown> | undefined
  const g3Active = isG3ProductionDomainActive(production)
  const g4Active = isG4PackagingQcActive(production)

  async function activateG3() {
    setError(null)
    setOkMsg(null)
    setBusy('g3')
    try {
      const res = await g3ProductionCommand({
        idempotencyKey: idemKey('ui-g3-act'),
        commandType: 'production.domain.activate',
        command: { reason: 'UI G3 activate (R2.9K)' },
      })
      if (!res.ok) {
        setError(res.message || res.error || t('g34.activation.error.generic'))
        return
      }
      setOkMsg(t('g34.activation.success.g3'))
      onActivated?.({
        warehouse: store!.warehouse,
        production: {
          ...store!.production,
          g3ProductionDomainActive: true,
          g3CriticalRevision: res.data.criticalRevision,
        } as AppStore['production'],
      })
    } finally {
      setBusy(null)
    }
  }

  async function activateG4() {
    setError(null)
    setOkMsg(null)
    setBusy('g4')
    try {
      const res = await g4ProductionCommand({
        idempotencyKey: idemKey('ui-g4-act'),
        commandType: 'packaging.domain.activate',
        command: { reason: 'UI G4 packaging activate (R2.9K)' },
      })
      if (!res.ok) {
        setError(res.message || res.error || t('g34.activation.error.generic'))
        return
      }
      if (store) {
        const mirrored = mirrorG4Ack(
          store.warehouse,
          store.production as unknown as Record<string, unknown>,
          {
            warehouse: res.data.warehouse,
            production: res.data.production,
            criticalRevision: res.data.criticalRevision,
            packagingQcActive: res.data.packagingQcActive ?? true,
            productionActive: res.data.productionActive ?? true,
          },
        )
        onActivated?.({
          warehouse: mirrored.warehouse,
          production: mirrored.production as AppStore['production'],
        })
      }
      setOkMsg(t('g34.activation.success.g4'))
    } finally {
      setBusy(null)
    }
  }

  if (!canActivate && g3Active && g4Active) {
    return (
      <div className="rounded-sm border border-grid bg-white px-4 py-3 text-sm" data-coach="g34-activation">
        <p className="font-medium text-stone-800">{t('g34.activation.title')}</p>
        <p className="mt-1 text-stone-600">{t('g34.activation.bothActive')}</p>
      </div>
    )
  }

  if (!canActivate) return null

  return (
    <div className="space-y-3 rounded-sm border border-grid bg-white px-4 py-3" data-coach="g34-activation">
      <div>
        <p className="font-medium text-stone-800">{t('g34.activation.title')}</p>
        <p className="mt-1 text-xs text-stone-500">{t('g34.activation.hint')}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className={g3Active ? 'text-emerald-700' : 'text-amber-700'}>
          G3: {g3Active ? t('g34.activation.active') : t('g34.activation.inactive')}
        </span>
        <span className={g4Active ? 'text-emerald-700' : 'text-amber-700'}>
          G4: {g4Active ? t('g34.activation.active') : t('g34.activation.inactive')}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy !== null || g3Active}
          onClick={() => void activateG3()}
          data-coach="g34-activate-g3"
        >
          {busy === 'g3' ? t('g34.activation.working') : t('g34.activation.btn.g3')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy !== null || !g3Active || g4Active}
          onClick={() => void activateG4()}
          data-coach="g34-activate-g4"
        >
          {busy === 'g4' ? t('g34.activation.working') : t('g34.activation.btn.g4')}
        </Button>
      </div>
      {error ? <FormNotice type="error" message={error} /> : null}
      {okMsg ? <FormNotice type="success" message={okMsg} /> : null}
    </div>
  )
}

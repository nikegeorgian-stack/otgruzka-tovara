import { useEffect } from 'react'
import { useI18n } from '@/context/I18nContext'
import {
  anyCriticalDomainFrozen,
  listFrozenCriticalDomains,
  type DomainFreezeKey,
} from '@/lib/cloud/criticalDomainMode'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore | null | undefined
}

const DOMAIN_LABEL_KEY: Record<DomainFreezeKey, string> = {
  warehouse: 'criticalDomain.frozen.warehouse',
  production: 'criticalDomain.frozen.production',
  packagingQc: 'criticalDomain.frozen.packagingQc',
  masterData: 'criticalDomain.frozen.masterData',
  salesPlanning: 'criticalDomain.frozen.salesPlanning',
  procurement: 'criticalDomain.frozen.procurement',
  capacityPlanning: 'criticalDomain.frozen.capacityPlanning',
}

/** Banner when any G1–G6 critical domain is frozen (read-only overlay). */
export function CriticalDomainFrozenBanner({ store }: Props) {
  const { t } = useI18n()
  const frozenActive = anyCriticalDomainFrozen(store)

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (frozenActive) {
      document.body.dataset.fstCriticalFrozen = '1'
    } else {
      delete document.body.dataset.fstCriticalFrozen
    }
    return () => {
      delete document.body.dataset.fstCriticalFrozen
    }
  }, [frozenActive])

  if (!frozenActive) return null

  const frozen = listFrozenCriticalDomains(store)
  const labels = frozen.map((k) => t(DOMAIN_LABEL_KEY[k])).join(', ')

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[440] flex justify-center px-3 pt-2 print:hidden"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto max-w-xl rounded-lg border border-sky-400 bg-sky-50 px-4 py-2.5 shadow-lg">
        <p className="text-sm font-bold text-sky-950">{t('criticalDomain.frozen.banner')}</p>
        <p className="mt-0.5 text-xs text-sky-900/90">{t('criticalDomain.frozen.hint')}</p>
        {labels ? (
          <p className="mt-0.5 text-[11px] text-sky-800/80">
            {t('criticalDomain.frozen.domains')}: {labels}
          </p>
        ) : null}
      </div>
    </div>
  )
}

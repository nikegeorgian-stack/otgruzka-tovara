import { useEffect, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { FinanceAdvanceAccrualPanel } from './FinanceAdvanceAccrualPanel'
import { FinanceAdvanceDocumentsPanel } from './FinanceAdvanceDocumentsPanel'
import { FinancePayoutDocumentsPanel } from './FinancePayoutDocumentsPanel'
import { PayoutDocumentModal } from './PayoutDocumentModal'
import type { FinanceDocumentActions } from './financeTypes'
import type { AppStore } from '@/lib/types'

export type FinanceDocumentKind = 'accrual' | 'advances' | 'salary' | 'individual'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
  documentActions: FinanceDocumentActions
  asOfDate?: string
  openDocumentId?: string | null
  openDocumentKind?: FinanceDocumentKind | null
  onOpenDocumentConsumed?: () => void
  onSetDefaultAdvancePercent: (percent: number) => void
  onOpenStatement?: () => void
}

const KINDS: {
  id: FinanceDocumentKind
  titleKey: string
  hintKey: string
  tone: string
}[] = [
  {
    id: 'accrual',
    titleKey: 'finance.docs.card.accrual',
    hintKey: 'finance.docs.card.accrualHint',
    tone: 'border-amber-200 bg-amber-50/80 hover:border-amber-400',
  },
  {
    id: 'advances',
    titleKey: 'finance.docs.card.advances',
    hintKey: 'finance.docs.card.advancesHint',
    tone: 'border-sky-200 bg-sky-50/80 hover:border-sky-400',
  },
  {
    id: 'salary',
    titleKey: 'finance.docs.card.salary',
    hintKey: 'finance.docs.card.salaryHint',
    tone: 'border-teal-200 bg-teal-50/80 hover:border-teal-400',
  },
  {
    id: 'individual',
    titleKey: 'finance.docs.card.individual',
    hintKey: 'finance.docs.card.individualHint',
    tone: 'border-violet-200 bg-violet-50/80 hover:border-violet-400',
  },
]

export function FinanceDocumentsPanel({
  store,
  month,
  onMonthChange,
  documentActions,
  asOfDate,
  openDocumentId,
  openDocumentKind,
  onOpenDocumentConsumed,
  onSetDefaultAdvancePercent,
  onOpenStatement,
}: Props) {
  const { t } = useI18n()
  const [kind, setKind] = useState<FinanceDocumentKind>('accrual')
  const [individualOpen, setIndividualOpen] = useState(false)

  useEffect(() => {
    if (!openDocumentKind) return
    if (openDocumentKind === 'individual') {
      setKind('individual')
      setIndividualOpen(true)
    } else {
      setKind(openDocumentKind)
    }
  }, [openDocumentKind])

  useEffect(() => {
    if (kind === 'individual') setIndividualOpen(true)
  }, [kind])

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-grid bg-white px-4 py-3 shadow-sm">
        <h2 className="text-base font-bold text-ink">{t('finance.docs.title')}</h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">{t('finance.docs.subtitle')}</p>
        <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
          <li>1. {t('finance.docs.step1')}</li>
          <li>2. {t('finance.docs.step2')}</li>
          <li>3. {t('finance.docs.step3')}</li>
          <li>4. {t('finance.docs.step4')}</li>
        </ol>
        {onOpenStatement ? (
          <button
            type="button"
            className="mt-3 rounded-sm border border-grid bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50"
            onClick={onOpenStatement}
          >
            {t('finance.docs.openStatement')}
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KINDS.map((card) => {
          const active = kind === card.id
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => {
                setKind(card.id)
                if (card.id === 'individual') setIndividualOpen(true)
              }}
              className={`rounded-sm border px-4 py-3 text-left transition ${card.tone} ${
                active ? 'ring-2 ring-teal-700 ring-offset-1' : ''
              }`}
            >
              <p className="text-sm font-bold text-ink">{t(card.titleKey)}</p>
              <p className="mt-1 text-xs text-stone-600">{t(card.hintKey)}</p>
            </button>
          )
        })}
      </div>

      {kind === 'accrual' ? (
        <FinanceAdvanceAccrualPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          documentActions={documentActions}
          onSetDefaultAdvancePercent={onSetDefaultAdvancePercent}
          openDocumentId={openDocumentId}
          onOpenDocumentConsumed={onOpenDocumentConsumed}
        />
      ) : kind === 'advances' ? (
        <FinanceAdvanceDocumentsPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          documentActions={documentActions}
          asOfDate={asOfDate}
          openDocumentId={openDocumentId}
          onOpenDocumentConsumed={onOpenDocumentConsumed}
        />
      ) : kind === 'salary' ? (
        <FinancePayoutDocumentsPanel
          store={store}
          month={month}
          onMonthChange={onMonthChange}
          documentActions={documentActions}
          asOfDate={asOfDate}
          openDocumentId={openDocumentId}
          onOpenDocumentConsumed={onOpenDocumentConsumed}
        />
      ) : (
        <div className="rounded-sm border border-dashed border-violet-300 bg-violet-50/40 px-4 py-6 text-center text-sm text-stone-600">
          <p>{t('finance.docs.individualHint')}</p>
          <button
            type="button"
            className="mt-3 rounded-sm bg-violet-800 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-900"
            onClick={() => setIndividualOpen(true)}
          >
            {t('finance.docs.individualPayout')}
          </button>
        </div>
      )}

      {individualOpen ? (
        <PayoutDocumentModal
          store={store}
          defaultMonth={month}
          defaultPurpose={t('finance.docs.individualPurpose')}
          actions={documentActions}
          onClose={() => setIndividualOpen(false)}
        />
      ) : null}
    </div>
  )
}

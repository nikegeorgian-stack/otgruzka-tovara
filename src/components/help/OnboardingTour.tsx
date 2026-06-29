import { useI18n } from '@/context/I18nContext'

type Props = {
  step: number
  onNext: () => void
  onSkip: () => void
}

const STEPS = [
  'tour.step1',
  'tour.step2',
  'tour.step3',
  'tour.step4',
  'tour.step5',
] as const

export function OnboardingTour({ step, onNext, onSkip }: Props) {
  const { t } = useI18n()
  if (step >= STEPS.length) return null

  return (
    <div className="fixed bottom-6 right-6 z-[115] max-w-sm rounded-sm border border-accent/30 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase text-accent">
        {t('tour.title')} {step + 1}/{STEPS.length}
      </p>
      <p className="mt-2 text-sm text-stone-700">{t(STEPS[step])}</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-sm border border-grid py-2 text-xs"
          onClick={onSkip}
        >
          {t('tour.skip')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-sm bg-accent py-2 text-xs font-semibold text-white"
          onClick={onNext}
        >
          {step + 1 >= STEPS.length ? t('tour.done') : t('tour.next')}
        </button>
      </div>
    </div>
  )
}

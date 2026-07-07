import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type Props = {
  onClick: () => void
  labelKey?: string
  hintKey?: string
}

export function ViewDefaultsToolbarButton({
  onClick,
  labelKey = 'viewDefaults.open',
  hintKey = 'viewDefaults.openHint',
}: Props) {
  const { t } = useI18n()
  return (
    <Button variant="secondary" size="sm" onClick={onClick} title={t(hintKey)}>
      ⚙ {t(labelKey)}
    </Button>
  )
}

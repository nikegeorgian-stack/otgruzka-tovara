import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type Props = { onClose: () => void }

const KEYS = [
  'hotkeys.click',
  'hotkeys.enter',
  'hotkeys.shiftClick',
  'hotkeys.arrows',
  'hotkeys.comment',
  'hotkeys.substitution',
  'hotkeys.esc',
  'hotkeys.help',
] as const

export function HotkeysHelp({ onClose }: Props) {
  const { t } = useI18n()
  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('hotkeys.title')}
      size="md"
      zIndex={120}
      footer={
        <Button variant="primary" className="w-full" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      }
    >
      <ul className="space-y-2 px-5 py-4 text-sm text-stone-700">
        {KEYS.map((k) => (
          <li key={k} className="border-b border-grid pb-2">
            {t(k)}
          </li>
        ))}
      </ul>
    </AppDialog>
  )
}

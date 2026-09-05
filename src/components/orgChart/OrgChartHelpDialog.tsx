import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

type Props = {
  open: boolean
  onClose: () => void
  canEdit: boolean
}

export function OrgChartHelpDialog({ open, onClose, canEdit }: Props) {
  const { t } = useI18n()

  const items = [
    'orgTree.help.click',
    canEdit ? 'orgTree.help.drag' : 'orgTree.help.selectOnly',
    'orgTree.help.context',
    'orgTree.help.shiftDrop',
    'orgTree.help.search',
    'orgTree.help.collapse',
    'orgTree.help.print',
  ]

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      ephemeral
      size="md"
      title={t('orgTree.helpTitle')}
      subtitle={t('orgTree.helpSubtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-stone-600">{t('orgTree.helpIntro')}</p>
        <ul className="space-y-2">
          {items.map((key) => (
            <li key={key} className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-stone-700">
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </AppDialog>
  )
}

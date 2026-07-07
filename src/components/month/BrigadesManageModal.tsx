import { BrigadesDirectoryPanel } from '@/components/directories/BrigadesDirectoryPanel'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onClose: () => void
  onAddBrigade: (name: string) => void
  onRenameBrigade: (oldName: string, newName: string) => void
  onRemoveBrigade: (name: string) => void
  onSetBrigadeNameKa: (nameRu: string, nameKa: string) => void
  onSetBrigadeUnit?: (brigade: string, unitId: string | null) => void
}

export function BrigadesManageModal({
  store,
  onClose,
  onAddBrigade,
  onRenameBrigade,
  onRemoveBrigade,
  onSetBrigadeNameKa,
  onSetBrigadeUnit,
}: Props) {
  const { t } = useI18n()

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('month.brigadesManage')}
      subtitle={t('settings.brigadesHint')}
      size="lg"
    >
      <div className="px-5 py-4">
        <BrigadesDirectoryPanel
          store={store}
          compact
          onAddBrigade={onAddBrigade}
          onRenameBrigade={onRenameBrigade}
          onRemoveBrigade={onRemoveBrigade}
          onSetBrigadeNameKa={onSetBrigadeNameKa}
          onSetBrigadeUnit={onSetBrigadeUnit}
        />
      </div>
    </AppDialog>
  )
}

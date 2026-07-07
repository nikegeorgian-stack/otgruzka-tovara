import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { useI18n } from '@/context/I18nContext'
import type { HrSection } from '@/lib/types'
import type { HrViewDefaults } from '@/lib/viewDefaults/types'

type TabDef = { id: HrSection; labelKey: string }

type Props = {
  tabs: TabDef[]
  initial: HrViewDefaults
  onSave: (defaults: HrViewDefaults) => void
  onClose: () => void
}

export function HrViewDefaultsDialog({ tabs, initial, onSave, onClose }: Props) {
  const { t } = useI18n()
  const [section, setSection] = useState<HrSection>(initial.section ?? 'employees')

  return (
    <AppDialog
      open
      onClose={onClose}
      size="md"
      title={t('hr.defaults.title')}
      subtitle={t('hr.defaults.subtitle')}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:bg-paper-dark"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-accent px-5 py-2 text-sm font-semibold text-white hover:opacity-95"
            onClick={() => {
              onSave({ section })
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="p-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('hr.defaults.section')}
        </p>
        <div className="flex flex-wrap gap-1 rounded-sm bg-stone-100 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                section === tab.id ? 'bg-white text-ink shadow-sm' : 'text-stone-500 hover:text-ink'
              }`}
              onClick={() => setSection(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </AppDialog>
  )
}

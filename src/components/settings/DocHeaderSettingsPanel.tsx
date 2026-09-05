import { useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import {
  DOC_HEADER_FIELD_KEYS,
  DOC_HEADER_PRESET_IDS,
  defaultDocHeaderFlags,
  type DocHeaderFieldFlags,
  type DocHeaderPresetId,
  type DocHeaderSettings,
} from '@/lib/print/docHeaderOptions'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onUpdateSettings: (patch: Partial<AppStore['settings']>) => void
}

export function DocHeaderSettingsPanel({ store, onUpdateSettings }: Props) {
  const { t } = useI18n()
  const [preset, setPreset] = useState<DocHeaderPresetId>('warehouse_receipt')
  const settings = store.settings.docHeader
  const flags: DocHeaderFieldFlags = {
    ...defaultDocHeaderFlags(preset),
    ...settings?.presets?.[preset],
  }
  const org = settings?.org ?? {}

  function patchDocHeader(next: DocHeaderSettings) {
    onUpdateSettings({ docHeader: next })
  }

  function setFlag(key: keyof DocHeaderFieldFlags, value: boolean) {
    patchDocHeader({
      ...settings,
      org: settings?.org,
      presets: {
        ...settings?.presets,
        [preset]: { ...settings?.presets?.[preset], [key]: value },
      },
    })
  }

  function setOrgField(key: keyof NonNullable<DocHeaderSettings['org']>, value: string) {
    patchDocHeader({
      ...settings,
      org: { ...settings?.org, [key]: value },
      presets: settings?.presets,
    })
  }

  function resetPreset() {
    const presets = { ...settings?.presets }
    delete presets[preset]
    patchDocHeader({ ...settings, org: settings?.org, presets })
  }

  return (
    <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
        {t('docHeader.settingsTitle')}
      </h3>
      <p className="mt-1 text-sm text-stone-500">{t('docHeader.settingsHint')}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(
          [
            ['orgRu', 'docHeader.orgRu'],
            ['orgKa', 'docHeader.orgKa'],
            ['idCode', 'docHeader.idCode'],
            ['unitRu', 'docHeader.unitRu'],
            ['unitKa', 'docHeader.unitKa'],
            ['addressRu', 'docHeader.addressRu'],
            ['addressKa', 'docHeader.addressKa'],
            ['bankName', 'docHeader.bankName'],
            ['bankIban', 'docHeader.bankIban'],
          ] as const
        ).map(([key, labelKey]) => (
          <label key={key} className="text-xs font-medium text-stone-500">
            {t(labelKey)}
            <input
              className="mt-1 w-full rounded-sm border border-grid px-2 py-1.5 text-sm"
              value={org[key] ?? ''}
              onChange={(e) => setOrgField(key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-stone-500">
          {t('docHeader.preset')}
          <select
            className="ml-2 rounded-sm border border-grid px-2 py-1.5 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as DocHeaderPresetId)}
          >
            {DOC_HEADER_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`docHeader.preset.${id}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rounded-sm border border-grid px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
          onClick={resetPreset}
        >
          {t('docHeader.resetPreset')}
        </button>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_HEADER_FIELD_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={flags[key]}
              onChange={(e) => setFlag(key, e.target.checked)}
            />
            {t(`docHeader.flag.${key}`)}
          </label>
        ))}
      </div>
    </section>
  )
}

import { useI18n } from '@/context/I18nContext'
import {
  ADMIN_CABINET_OPTIONS,
  type AdminCabinetId,
} from '@/lib/access/adminCabinet'
import { roleLabel } from '@/lib/access/roles'

type Props = {
  value: AdminCabinetId
  onChange: (cabinet: AdminCabinetId) => void
}

export function AdminCabinetSwitcher({ value, onChange }: Props) {
  const { t, locale } = useI18n()

  return (
    <label className="mt-3 block">
      <span className="text-[10px] font-bold uppercase tracking-wide text-violet-800">
        {t('access.cabinetSwitcherLabel')}
      </span>
      <select
        className="mt-1 w-full rounded-sm border border-violet-200 bg-white px-2.5 py-2 text-xs font-medium text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value as AdminCabinetId)}
      >
        {ADMIN_CABINET_OPTIONS.map((id) => (
          <option key={id} value={id}>
            {id === 'full'
              ? t('access.cabinetFull')
              : roleLabel(id, locale)}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[10px] leading-snug text-stone-500">{t('access.cabinetPreviewHint')}</p>
    </label>
  )
}

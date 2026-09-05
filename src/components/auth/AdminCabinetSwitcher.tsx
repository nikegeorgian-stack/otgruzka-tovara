import { useI18n } from '@/context/I18nContext'
import {
  ADMIN_CABINET_OPTIONS,
  type AdminCabinetId,
} from '@/lib/access/adminCabinet'
import { roleLabel } from '@/lib/access/roles'

type Props = {
  value: AdminCabinetId
  onChange: (cabinet: AdminCabinetId) => void
  /** Узкий сайдбар: без длинной подсказки, спокойные цвета. */
  density?: 'default' | 'sidebar'
}

export function AdminCabinetSwitcher({
  value,
  onChange,
  density = 'default',
}: Props) {
  const { t, locale } = useI18n()
  const sidebar = density === 'sidebar'

  function optionLabel(id: (typeof ADMIN_CABINET_OPTIONS)[number]): string {
    if (id === 'full') {
      return sidebar ? t('access.cabinetFullShort') : t('access.cabinetFull')
    }
    return roleLabel(id, locale)
  }

  return (
    <label className={sidebar ? 'block' : 'mt-3 block'}>
      <span
        className={
          sidebar
            ? 'text-[10px] font-semibold uppercase tracking-wide text-stone-500'
            : 'text-[10px] font-bold uppercase tracking-wide text-violet-800'
        }
      >
        {t('access.cabinetSwitcherLabel')}
      </span>
      <select
        className={
          sidebar
            ? 'mt-1 w-full rounded-md border border-stone-300/90 bg-white px-2 py-1.5 text-xs font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'
            : 'mt-1 w-full rounded-sm border border-violet-200 bg-white px-2.5 py-2 text-xs font-medium text-ink'
        }
        value={value}
        onChange={(e) => onChange(e.target.value as AdminCabinetId)}
        title={optionLabel(value)}
      >
        {ADMIN_CABINET_OPTIONS.map((id) => (
          <option key={id} value={id}>
            {optionLabel(id)}
          </option>
        ))}
      </select>
      {!sidebar ? (
        <p className="mt-1 text-[10px] leading-snug text-stone-500">
          {t('access.cabinetPreviewHint')}
        </p>
      ) : null}
    </label>
  )
}

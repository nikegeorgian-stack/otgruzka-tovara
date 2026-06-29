import { useI18n } from '@/context/I18nContext'
import { CODE_DEFS } from '@/lib/codes'

export function CodesDirectoryPanel() {
  const { t, codeLabel, codeCategory } = useI18n()
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-500">{t('codes.subtitle')}</p>
      <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">{t('codes.colCode')}</th>
              <th className="px-4 py-3">{t('codes.colHours')}</th>
              <th className="px-4 py-3">{t('codes.colCategory')}</th>
              <th className="px-4 py-3">{t('codes.colDesc')}</th>
              <th className="px-4 py-3">{t('codes.colSchedule')}</th>
            </tr>
          </thead>
          <tbody>
            {CODE_DEFS.map((c) => (
              <tr key={c.code} className="border-t border-grid">
                <td className="px-4 py-3 font-mono text-lg font-bold">{c.code}</td>
                <td className="px-4 py-3 font-mono">{c.hours}</td>
                <td className="px-4 py-3">{codeCategory(c.categoryKey)}</td>
                <td className="px-4 py-3">{codeLabel(c.code)}</td>
                <td className="px-4 py-3 text-stone-500">{c.schedule ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-sm border border-grid bg-white p-4 text-sm text-stone-600">
        <p className="font-semibold text-ink">{t('codes.autoTitle')}</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>5/2 8ч</strong> — {t('codes.auto52')}
          </li>
          <li>
            <strong>2/2 11ч</strong> — {t('codes.auto22')}
          </li>
          <li>
            <strong>1/1 11ч</strong> — {t('codes.auto11')}
          </li>
        </ul>
      </div>
    </div>
  )
}

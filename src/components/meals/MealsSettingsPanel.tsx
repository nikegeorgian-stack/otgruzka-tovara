import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { getMeals } from '@/lib/meals/init'
import type { MealSettings } from '@/lib/meals/types'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onUpdateSettings: (patch: Partial<MealSettings>) => void
}

export function MealsSettingsPanel({ store, onUpdateSettings }: Props) {
  const { t } = useI18n()
  const meals = getMeals(store)
  const s = meals.settings

  return (
    <div className="flex flex-col gap-5" data-coach="meals:settings">
      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="mb-3 font-semibold text-ink">{t('meals.settings.orders')}</p>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.ordersDisabled}
            onChange={(e) => onUpdateSettings({ ordersDisabled: e.target.checked })}
          />
          {t('meals.settings.disableOrders')}
        </label>
        <label className="mb-2 block text-sm">
          {t('meals.settings.deadline')}
          <Input
            type="time"
            className="mt-1 max-w-[8rem]"
            value={`${String(s.deadlineHourTbilisi).padStart(2, '0')}:00`}
            onChange={(e) =>
              onUpdateSettings({
                deadlineHourTbilisi: Number.parseInt(e.target.value.slice(0, 2), 10),
              })
            }
          />
        </label>
        <label className="block text-sm">
          {t('meals.settings.disabledText')}
          <Input
            className="mt-1"
            value={s.disabledTextRu}
            onChange={(e) => onUpdateSettings({ disabledTextRu: e.target.value })}
          />
        </label>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="mb-3 font-semibold text-ink">{t('meals.settings.prices')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['firstPortionEmployeeGel', t('meals.settings.firstEmployee')],
              ['firstPortionCompanyGel', t('meals.settings.firstCompany')],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-sm">
              {label}
              <Input
                type="number"
                min={0}
                step="0.5"
                className="mt-1"
                value={String(s.pricing[key])}
                onChange={(e) =>
                  onUpdateSettings({
                    pricing: { ...s.pricing, [key]: Number(e.target.value) || 0 },
                  })
                }
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="mb-3 font-semibold text-ink">{t('meals.settings.telegram')}</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.telegram.enabled}
            onChange={(e) =>
              onUpdateSettings({ telegram: { ...s.telegram, enabled: e.target.checked } })
            }
          />
          {t('meals.settings.telegramEnabled')}
        </label>
        <p className="mt-2 text-xs text-stone-500">{t('meals.settings.telegramHint')}</p>
      </section>
    </div>
  )
}

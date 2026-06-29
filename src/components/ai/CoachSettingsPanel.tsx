import { useMemo } from 'react'
import { useI18n } from '@/context/I18nContext'
import {
  AI_PROVIDER_IDS,
  applyProviderPreset,
  normalizeAiProvider,
  providerLabelKey,
  type AiProviderId,
} from '@/lib/ai/providers'
import { viewLabel, type Locale } from '@/lib/ai/coachTargets'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  onUpdateSettings: (patch: Partial<AppStore['settings']>) => void
}

const sectionClass = 'rounded-sm border border-grid bg-white p-5 shadow-sm'

export function CoachSettingsPanel({ store, onUpdateSettings }: Props) {
  const { t, locale } = useI18n()
  const loc = locale as Locale
  const ai = store.settings.ai
  const provider = normalizeAiProvider(ai)
  const needsKey = provider !== 'off' && provider !== 'local'

  function setProvider(p: AiProviderId) {
    onUpdateSettings({ ai: applyProviderPreset(ai, p) })
  }
  function patchAi(patch: Partial<NonNullable<AppStore['settings']['ai']>>) {
    onUpdateSettings({ ai: { ...ai, ...patch } })
  }

  const stats = useMemo(() => {
    const entries = store.aiChat?.entries ?? []
    const questions = entries.filter((e) => e.role === 'user')
    const byTopic = new Map<string, number>()
    const byUser = new Map<string, { count: number; last: number }>()
    for (const q of questions) {
      const topicKey = q.topic ?? '__none__'
      byTopic.set(topicKey, (byTopic.get(topicKey) ?? 0) + 1)
      const u = byUser.get(q.userName) ?? { count: 0, last: 0 }
      byUser.set(q.userName, { count: u.count + 1, last: Math.max(u.last, q.ts) })
    }
    const topics = [...byTopic.entries()].sort((a, b) => b[1] - a[1])
    const users = [...byUser.entries()].sort((a, b) => b[1].count - a[1].count)
    const recent = [...questions].sort((a, b) => b.ts - a.ts).slice(0, 25)
    return { total: questions.length, topics, users, recent }
  }, [store.aiChat])

  const suggestions = useMemo(
    () => [...(store.aiChat?.suggestions ?? [])].sort((a, b) => b.ts - a.ts),
    [store.aiChat],
  )

  const fmtDate = (ts: number) => new Date(ts).toLocaleString(loc === 'ka' ? 'ka-GE' : 'ru-RU')
  const topicName = (key: string) =>
    key === '__none__' ? t('coachAnalytics.noTopic') : viewLabel(key, loc) ?? key

  return (
    <>
      <section className={sectionClass}>
        <h2 className="text-sm font-bold text-ink">{t('settings.ai')}</h2>
        <p className="mt-1 text-xs text-stone-500">{t('settings.aiHint')}</p>
        <p className="mt-1 text-xs font-medium text-amber-700">🔒 {t('settings.aiKeyAdminOnly')}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-600">
              {t('settings.aiProvider')}
            </span>
            <select
              className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProviderId)}
            >
              {AI_PROVIDER_IDS.map((p) => (
                <option key={p} value={p}>
                  {t(providerLabelKey(p))}
                </option>
              ))}
            </select>
          </label>

          {needsKey && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-600">
                {t('settings.aiModel')}
              </span>
              <input
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={ai?.model ?? ''}
                onChange={(e) => patchAi({ model: e.target.value })}
                placeholder="gemini-2.0-flash-lite"
              />
            </label>
          )}

          {needsKey && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-stone-600">
                {t('settings.aiApiKey')}
              </span>
              <input
                type="password"
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={ai?.apiKey ?? ''}
                onChange={(e) => patchAi({ apiKey: e.target.value })}
                placeholder="AIza… / AQ… / sk-…"
              />
            </label>
          )}

          {provider === 'custom' && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-stone-600">
                {t('settings.aiBaseUrl')}
              </span>
              <input
                className="w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={ai?.baseUrl ?? ''}
                onChange={(e) => patchAi({ baseUrl: e.target.value })}
                placeholder="https://…/v1"
              />
            </label>
          )}
        </div>

        {provider === 'gemini' && (
          <p className="mt-3 text-xs text-teal-700">{t('settings.aiGeminiHint')}</p>
        )}
        {needsKey && (
          <p className="mt-2 text-xs text-amber-700">{t('settings.aiPrivacy')}</p>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-bold text-ink">{t('coachAnalytics.title')}</h2>
        <p className="mt-1 text-xs text-stone-500">{t('coachAnalytics.hint')}</p>

        {stats.total === 0 ? (
          <p className="mt-4 text-sm text-stone-400">{t('coachAnalytics.empty')}</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-4">
              <div className="rounded-sm bg-stone-50 px-4 py-2">
                <div className="text-lg font-bold text-ink">{stats.total}</div>
                <div className="text-[11px] text-stone-500">
                  {t('coachAnalytics.totalQuestions')}
                </div>
              </div>
              <div className="rounded-sm bg-stone-50 px-4 py-2">
                <div className="text-lg font-bold text-ink">{stats.users.length}</div>
                <div className="text-[11px] text-stone-500">{t('coachAnalytics.users')}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-stone-500">
                  {t('coachAnalytics.byTopic')}
                </h3>
                <div className="space-y-1.5">
                  {stats.topics.map(([key, count]) => {
                    const pct = Math.round((count / stats.total) * 100)
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-xs text-stone-700">
                          {topicName(key)}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-stone-100">
                          <div
                            className="h-full rounded bg-teal-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs text-stone-500">
                          {count}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-stone-500">
                  {t('coachAnalytics.byUser')}
                </h3>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-400">
                      <th className="py-1">{t('coachAnalytics.colUser')}</th>
                      <th className="py-1 text-right">{t('coachAnalytics.colCount')}</th>
                      <th className="py-1 text-right">{t('coachAnalytics.colLast')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.users.map(([name, info]) => (
                      <tr key={name} className="border-t border-grid">
                        <td className="py-1 text-stone-700">{name}</td>
                        <td className="py-1 text-right text-stone-600">{info.count}</td>
                        <td className="py-1 text-right text-stone-400">{fmtDate(info.last)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-xs font-semibold uppercase text-stone-500">
                {t('coachAnalytics.recent')}
              </h3>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-stone-400">
                    <th className="py-1">{t('coachAnalytics.colUser')}</th>
                    <th className="py-1">{t('coachAnalytics.colTopic')}</th>
                    <th className="py-1">{t('coachAnalytics.colQuestion')}</th>
                    <th className="py-1 text-right">{t('coachAnalytics.colLast')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((q) => (
                    <tr key={q.id} className="border-t border-grid align-top">
                      <td className="py-1 pr-2 text-stone-700">{q.userName}</td>
                      <td className="py-1 pr-2 text-stone-500">
                        {topicName(q.topic ?? '__none__')}
                      </td>
                      <td className="py-1 pr-2 text-stone-700">{q.content}</td>
                      <td className="py-1 text-right text-stone-400">{fmtDate(q.ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-bold text-ink">{t('coachSuggestions.title')}</h2>
        <p className="mt-1 text-xs text-stone-500">{t('coachSuggestions.hint')}</p>
        {suggestions.length === 0 ? (
          <p className="mt-4 text-sm text-stone-400">{t('coachSuggestions.empty')}</p>
        ) : (
          <table className="mt-4 w-full text-xs">
            <thead>
              <tr className="text-left text-stone-400">
                <th className="py-1">{t('coachAnalytics.colUser')}</th>
                <th className="py-1">{t('coachSuggestions.colText')}</th>
                <th className="py-1 text-right">{t('coachAnalytics.colLast')}</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr key={s.id} className="border-t border-grid align-top">
                  <td className="py-1 pr-2 text-stone-700">{s.userName}</td>
                  <td className="py-1 pr-2 text-stone-700">{s.text}</td>
                  <td className="py-1 text-right text-stone-400">{fmtDate(s.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

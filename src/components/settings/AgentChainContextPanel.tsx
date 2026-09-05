import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useI18n } from '@/context/I18nContext'

/**
 * Sysadmin: напоминание про агента цепочек Cursor + копирование шаблона брифа.
 * Сам graphify крутится в Cursor (`npm run agent:chain-brief`), не в браузере.
 */
export function AgentChainContextPanel() {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)

  const template = useMemo(
    () =>
      [
        'CHAIN BRIEF (для Cursor / Otgruzka)',
        'topic: <кратко что чиним>',
        'command: npm run agent:chain-brief -- "<тема>" [СимволA] [СимволB]',
        'skill: .cursor/skills/fst-chain-context/SKILL.md',
        'rule: .cursor/rules/fst-chain-context.mdc',
        'prod: https://otgruzka-tovara.vercel.app',
        'firebase: otgruzka-tovara — данные не затирать',
        '',
        'Перед правкой агент должен: graphify query/path → бриф → тонкий Edit.',
        'После правки: graphify update .',
      ].join('\n'),
    [],
  )

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(template)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
        {t('settings.agentChain.title')}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        {t('settings.agentChain.body')}
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-stone-500">
        <li>{t('settings.agentChain.b1')}</li>
        <li>{t('settings.agentChain.b2')}</li>
        <li>{t('settings.agentChain.b3')}</li>
      </ul>
      <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-700">
        {template}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={() => void copyTemplate()}>
          {copied ? t('settings.agentChain.copied') : t('settings.agentChain.copy')}
        </Button>
      </div>
    </section>
  )
}

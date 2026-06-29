import { useI18n } from '@/context/I18nContext'

type Props = { onClose: () => void }

const COMMANDS = [
  'voice.cmd.nav',
  'voice.cmd.month',
  'voice.cmd.layout',
  'voice.cmd.print',
  'voice.cmd.slots',
  'voice.cmd.filter',
  'voice.cmd.search',
  'voice.cmd.assign',
  'voice.cmd.code',
  'voice.cmd.bulk',
  'voice.cmd.system',
  'voice.cmd.confirm',
  'voice.cmd.stop',
] as const

export function VoiceHelpModal({ onClose }: Props) {
  const { t } = useI18n()

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-sm bg-white p-6 shadow-sm">
        <h3 className="text-lg font-bold">{t('voice.helpTitle')}</h3>
        <p className="mt-1 text-sm text-stone-500">{t('voice.helpHint')}</p>
        <ul className="mt-4 space-y-3 text-sm text-stone-700">
          {COMMANDS.map((key) => (
            <li key={key} className="border-b border-grid pb-2 whitespace-pre-line">
              {t(key)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="mt-6 w-full rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

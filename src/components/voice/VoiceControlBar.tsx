import { useI18n } from '@/context/I18nContext'

type Props = {
  listening: boolean
  interim: string
  feedback: string
  active: boolean
  onToggle: () => void
  onHelp: () => void
}

export function VoiceControlBar({
  listening,
  interim,
  feedback,
  active,
  onToggle,
  onHelp,
}: Props) {
  const { t } = useI18n()

  // Голос у левого дока FAB (над стеком), не в правом нижнем углу рабочей зоны
  const dockClass =
    'bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] left-3 items-start lg:bottom-[calc(3.25rem+5.5rem)] lg:left-[calc(var(--app-sidebar-w,3.5rem)+0.75rem)]'

  return (
    <div
      className={`fixed z-[89] flex max-w-sm flex-col gap-2 print:hidden ${dockClass}`}
    >
      {(feedback || interim) && (
        <div className="rounded-sm border border-grid bg-white/95 px-3 py-2 text-xs text-stone-700 shadow-sm backdrop-blur">
          {interim && <p className="italic text-stone-400">{interim}…</p>}
          {feedback && <p className="font-medium">{feedback}</p>}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-sm border border-grid bg-white px-3 py-2 text-xs font-medium shadow-md hover:bg-paper-dark"
          onClick={onHelp}
          title={t('voice.help')}
        >
          ?
        </button>
        <button
          type="button"
          className={`flex items-center gap-2 rounded-sm px-4 py-2.5 text-sm font-semibold shadow-sm transition-all ${
            active
              ? listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-stone-700 text-white'
              : 'border border-accent/30 bg-white text-accent hover:bg-accent-soft'
          }`}
          onClick={onToggle}
          title={t('voice.toggle')}
        >
          <span aria-hidden>{active && listening ? '⏹' : '🎤'}</span>
          {active ? t('voice.listening') : t('voice.start')}
        </button>
      </div>
    </div>
  )
}

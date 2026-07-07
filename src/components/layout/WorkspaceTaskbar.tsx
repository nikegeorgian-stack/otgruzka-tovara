import { CloseIcon } from '@/components/ui/icons'
import { useModalMinimizeOptional } from '@/context/ModalMinimizeContext'
import { useI18n } from '@/context/I18nContext'
import type { WorkspacePane } from '@/lib/workspace/types'

type Props = {
  panes: WorkspacePane[]
  activePaneId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

export function WorkspaceTaskbar({ panes, activePaneId, onActivate, onClose }: Props) {
  const { t } = useI18n()
  const minimizeApi = useModalMinimizeOptional()
  const modalItems = minimizeApi?.items ?? []

  if (panes.length === 0 && modalItems.length === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-300/90 bg-[#f3f1ec] shadow-[0_-4px_20px_rgba(0,0,0,0.08)] print:hidden">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1 px-3 py-2">
        {modalItems.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-wide text-stone-500 sm:inline">
              {t('workspace.minimized')}
            </span>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
              {modalItems.map((item) => (
                <div
                  key={item.id}
                  className="group flex max-w-[240px] shrink-0 items-center rounded-lg border border-amber-300/80 bg-amber-50/90 text-amber-950 shadow-sm"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-medium"
                    title={item.title}
                    onClick={() => minimizeApi?.restore(item.id)}
                  >
                    {item.title}
                  </button>
                  <button
                    type="button"
                    className="mr-1 rounded px-1.5 py-0.5 text-amber-700/70 hover:bg-amber-100 hover:text-red-600"
                    title={t('workspace.close')}
                    aria-label={t('workspace.close')}
                    onClick={(e) => {
                      e.stopPropagation()
                      item.close()
                      minimizeApi?.remove(item.id)
                    }}
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {panes.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="hidden shrink-0 text-[10px] font-bold uppercase tracking-wide text-stone-500 sm:inline">
              {t('workspace.label')}
            </span>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
              {panes.map((pane) => {
                const active = pane.id === activePaneId
                return (
                  <div
                    key={pane.id}
                    className={`group flex max-w-[220px] shrink-0 items-center rounded-t-lg border border-b-0 transition-colors ${
                      active
                        ? 'border-accent/50 bg-white text-ink shadow-sm'
                        : 'border-stone-300/80 bg-stone-100/90 text-stone-600 hover:bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-medium"
                      title={pane.title}
                      onClick={() => onActivate(pane.id)}
                    >
                      {pane.title}
                    </button>
                    <button
                      type="button"
                      className="mr-1 rounded px-1.5 py-0.5 text-stone-400 hover:bg-stone-200 hover:text-red-600"
                      title={t('workspace.close')}
                      aria-label={t('workspace.close')}
                      onClick={(e) => {
                        e.stopPropagation()
                        onClose(pane.id)
                      }}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

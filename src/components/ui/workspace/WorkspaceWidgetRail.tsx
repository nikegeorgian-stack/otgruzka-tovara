import type { ReactNode } from 'react'
import { useI18n } from '@/context/I18nContext'
import type { WorkspaceWidgetDef, WorkspaceWidgetId } from '@/lib/ui/workspaceWidgets'

type Props = {
  widgets: WorkspaceWidgetDef[]
  openId: WorkspaceWidgetId | null
  onToggle: (id: WorkspaceWidgetId) => void
  /** Чипы-сводка активных фильтров (свёрнутый режим) */
  chips?: ReactNode
  /** Быстрый поиск / поле слева */
  leading?: ReactNode
  className?: string
}

export function WorkspaceWidgetRail({
  widgets,
  openId,
  onToggle,
  chips,
  leading,
  className = '',
}: Props) {
  const { t } = useI18n()

  return (
    <div
      className={`workspace-widget-rail sticky top-0 z-[40] print:hidden ${className}`.trim()}
    >
      <div className="workspace-widget-rail__inner">
        {leading ? <div className="workspace-widget-rail__leading">{leading}</div> : null}
        {chips ? <div className="workspace-widget-rail__chips">{chips}</div> : null}
        <div className="workspace-widget-rail__tabs" role="toolbar" aria-label={t('workspace.widgets')}>
          {widgets.map((w) => {
            const active = openId === w.id
            return (
              <button
                key={w.id}
                type="button"
                className={`workspace-widget-tab ${active ? 'workspace-widget-tab--active' : ''}`}
                onClick={() => onToggle(w.id)}
                aria-pressed={active}
                title={t(w.labelKey)}
              >
                {w.icon ? <span className="workspace-widget-tab__icon">{w.icon}</span> : null}
                <span className="workspace-widget-tab__label">{t(w.labelKey)}</span>
                {w.badge != null && w.badge !== 0 && w.badge !== '' ? (
                  <span className="workspace-widget-tab__badge">{w.badge}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function WorkspaceWidgetChip({
  children,
  onClick,
  tone = 'default',
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'default' | 'warn' | 'accent'
}) {
  const cls =
    tone === 'warn'
      ? 'workspace-widget-chip workspace-widget-chip--warn'
      : tone === 'accent'
        ? 'workspace-widget-chip workspace-widget-chip--accent'
        : 'workspace-widget-chip'
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <span className={cls}>{children}</span>
}

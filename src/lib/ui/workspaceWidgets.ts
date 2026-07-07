/** Идентификатор виджета на рабочей панели раздела. */
export type WorkspaceWidgetId = string

export type WorkspaceWidgetDef = {
  id: WorkspaceWidgetId
  /** i18n-ключ подписи на кнопке */
  labelKey: string
  /** Короткий символ/иконка на узком экране */
  icon?: string
  /** Бейдж на кнопке (число предупреждений и т.п.) */
  badge?: number | string
}

export const WORKSPACE_WIDGETS_STORAGE_PREFIX = 'fst-workspace-widget:'

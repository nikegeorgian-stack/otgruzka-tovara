/** Интерактивная организационная схема (отдельно от плоского hrStructuralUnits). */

export type OrgChartDisplayMode = 'full' | 'short' | 'both'

export type OrgChartNode = {
  id: string
  /** Родитель в дереве подчинения (стрелка «кому подчиняется»). */
  parentId?: string
  /** Полное наименование должности / подразделения. */
  nameFull: string
  /** Сокращение для схемы (ГД, ОД, ОДП…). */
  nameShort: string
  sortOrder: number
  /** Координаты на канве (px). */
  layoutX: number
  layoutY: number
  /** Связь со штатным справочником (опционально). */
  structuralUnitId?: string
  positionId?: string
  /** Кто занимает ячейку (карточка HR). */
  employeeId?: string
  archived?: boolean
  updatedAt?: string
}

export type OrgChartStore = {
  nodes: OrgChartNode[]
  /** Предпочтение отображения на экране. Печать по умолчанию — both. */
  displayMode?: OrgChartDisplayMode
  /** Версия компактной раскладки (2 = узкие ячейки под A4/A3). */
  layoutVersion?: number
}

export type OrgChartNodeDraft = {
  id?: string
  parentId?: string
  nameFull: string
  nameShort: string
  sortOrder?: number
  layoutX?: number
  layoutY?: number
  structuralUnitId?: string | null
  positionId?: string | null
  /** null — явно снять сотрудника. */
  employeeId?: string | null
}

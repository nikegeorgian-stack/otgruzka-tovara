/** Группы, которые обычно остаются на ночь. */
export type NightShiftGroupId =
  | 'line1'
  | 'line2'
  | 'pack'
  | 'mixer'
  | 'mechanics'

export const NIGHT_SHIFT_GROUP_IDS: NightShiftGroupId[] = [
  'line1',
  'line2',
  'pack',
  'mixer',
  'mechanics',
]

export type NightShiftStatus = 'draft' | 'posted' | 'void'

/** Снимок применённого факта — для отката при аннулировании. */
export type NightShiftAppliedMark = {
  employeeId: string
  rowId: string
  prevFact: string
}

export type NightShiftDocument = {
  id: string
  number: string
  /** Календарный день YYYY-MM-DD */
  date: string
  status: NightShiftStatus
  groups: NightShiftGroupId[]
  /** Подбор по конкретным бригадам (альтернатива группам). */
  brigades?: string[]
  /** Кого ставим на ночь (код Н в факте). */
  employeeIds: string[]
  /** Общая причина (если не расписано по людям). */
  note?: string
  /** Почему этот человек на ночи (employeeId → текст). */
  reasons?: Record<string, string>
  applied?: NightShiftAppliedMark[]
  createdAt: string
  createdBy?: string
  createdByName?: string
  postedAt?: string
  postedBy?: string
  postedByName?: string
  voidedAt?: string
  voidedBy?: string
  voidedByName?: string
}

export type NightShiftStore = {
  documents: NightShiftDocument[]
}

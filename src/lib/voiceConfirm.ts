import { scheduleShortLabel } from './schedules'
import type { VoiceAction } from './voiceCommands'

const CONFIRM_TYPES = new Set<VoiceAction['type']>([
  'replaceInBrigade',
  'swapEmployees',
  'unassign',
  'regenerateMonth',
  'changeSchedule',
  'changeEmployeeShift',
  'permanentAssign',
  'bulkHoliday',
  'bulkCopy52',
])

export function voiceActionNeedsConfirm(action: VoiceAction): boolean {
  return CONFIRM_TYPES.has(action.type)
}

export function describeVoiceAction(action: VoiceAction): string {
  switch (action.type) {
    case 'replaceInBrigade':
      return `замена ${action.fromName} → ${action.toName}`
    case 'swapEmployees':
      return `поменять ${action.nameA} и ${action.nameB}`
    case 'unassign':
      return `освободить ${action.name}`
    case 'regenerateMonth':
      return 'пересчитать весь план'
    case 'changeSchedule':
      return `график ${action.name} с ${action.fromDay}`
    case 'changeEmployeeShift': {
      const parts = []
      if (action.schedule) parts.push(scheduleShortLabel(action.schedule))
      if (action.group2x2) parts.push(`гр.${action.group2x2}`)
      if (action.shiftMode) parts.push(action.shiftMode === 'night' ? 'ночь' : 'день')
      return `${action.name} · ${parts.join(' ') || 'смена'} · с ${action.fromDay}`
    }
    case 'permanentAssign':
      return `перевести ${action.name} в бригаду`
    case 'bulkHoliday':
      return 'праздники для всех'
    case 'bulkCopy52':
      return 'копировать план в факт'
    default:
      return action.type
  }
}

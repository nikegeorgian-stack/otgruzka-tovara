import type { EngineerLogDraft } from './init'
import type { EngineerLogEntryKind } from './types'

export type EngineerLogTemplateId = 'morning_round' | 'end_of_shift' | 'breakdown' | 'handoff'

export type EngineerLogTemplate = {
  id: EngineerLogTemplateId
  kind: EngineerLogEntryKind
  /** i18n key suffix under engineerLog.tpl.* */
  titleKey: string
  bodyKey: string
  checklistKeys?: string[]
  severity?: EngineerLogDraft['severity']
  status?: EngineerLogDraft['status']
  tags: string[]
}

export const ENGINEER_LOG_TEMPLATES: EngineerLogTemplate[] = [
  {
    id: 'morning_round',
    kind: 'inspection',
    titleKey: 'morningTitle',
    bodyKey: 'morningBody',
    checklistKeys: ['morningC1', 'morningC2', 'morningC3', 'morningC4'],
    status: 'open',
    tags: ['обход', 'утро'],
  },
  {
    id: 'end_of_shift',
    kind: 'handoff',
    titleKey: 'eosTitle',
    bodyKey: 'eosBody',
    checklistKeys: ['eosC1', 'eosC2', 'eosC3'],
    status: 'done',
    tags: ['смена', 'итог'],
  },
  {
    id: 'breakdown',
    kind: 'issue',
    titleKey: 'breakTitle',
    bodyKey: 'breakBody',
    severity: 'critical',
    status: 'open',
    tags: ['простой', 'авария'],
  },
  {
    id: 'handoff',
    kind: 'handoff',
    titleKey: 'handTitle',
    bodyKey: 'handBody',
    status: 'open',
    tags: ['передача'],
  },
]

export function draftFromTemplate(
  tpl: EngineerLogTemplate,
  opts: {
    date: string
    title: string
    body: string
    checklistTexts?: string[]
    authorId?: string
    authorName?: string
  },
): EngineerLogDraft {
  return {
    kind: tpl.kind,
    date: opts.date,
    title: opts.title,
    body: opts.body,
    tags: [...tpl.tags],
    severity: tpl.severity,
    status: tpl.status,
    authorId: opts.authorId,
    authorName: opts.authorName,
    pinned: tpl.severity === 'critical',
    checklist: opts.checklistTexts?.map((text) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
    })),
  }
}

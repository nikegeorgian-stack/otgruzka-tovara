/** Реестр печатных форм табеля (FST-TB-*) */

export type TimesheetPrintFormId = 'plan' | 'fact' | 'both' | 'summary'

export type TimesheetPrintFormMeta = {
  code: string
  orientation: 'landscape' | 'portrait'
}

export const TIMESHEET_PRINT_FORMS: Record<TimesheetPrintFormId, TimesheetPrintFormMeta> = {
  plan: { code: 'FST-TB-01', orientation: 'landscape' },
  fact: { code: 'FST-TB-02', orientation: 'landscape' },
  both: { code: 'FST-TB-03', orientation: 'landscape' },
  summary: { code: 'FST-TB-04', orientation: 'portrait' },
}

export function timesheetFormMeta(
  variant: TimesheetPrintFormId,
  page?: { index: number; total: number },
): { code: string; pageLabel?: string } {
  const { code } = TIMESHEET_PRINT_FORMS[variant]
  if (!page || page.total <= 1) return { code }
  return { code, pageLabel: `${page.index}/${page.total}` }
}

/** Код для конкретного листа в комплекте «план + факт». */
export function sheetFormCode(mode: 'plan' | 'fact'): string {
  return mode === 'plan' ? TIMESHEET_PRINT_FORMS.plan.code : TIMESHEET_PRINT_FORMS.fact.code
}

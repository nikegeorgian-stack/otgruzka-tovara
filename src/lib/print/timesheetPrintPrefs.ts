import { safeLocalGet, safeLocalSet } from '@/lib/safeStorage'
import type { MonthGroupMode } from '@/lib/monthViewOptions'
import type { Locale } from '@/lib/types'
import type { PrintConfig, PrintVariant } from '@/components/print/PrintPreviewModal'

const STORAGE_KEY = 'fst.timesheetPrintPrefs:v1'

export type TimesheetPrintPresetId = 'master' | 'hr' | 'accountant'

/** Сохраняемые опции (бригады — отдельно, сверяются с текущим месяцем). */
export type TimesheetPrintPrefs = {
  v: 1
  variant: PrintVariant
  fitOnePage: boolean
  showHours: boolean
  /** Каждая бригада на своём листе (default true). */
  oneBrigadePerPage: boolean
  printLocale: Locale
  georgiaOfficialHeader: boolean
  groupMode: MonthGroupMode
  brigades?: string[]
  lastPreset?: TimesheetPrintPresetId
}

export type PrintPresetDef = {
  id: TimesheetPrintPresetId
  labelKey: string
  hintKey: string
  patch: Pick<
    TimesheetPrintPrefs,
    'variant' | 'showHours' | 'fitOnePage' | 'groupMode' | 'oneBrigadePerPage'
  >
}

export const TIMESHEET_PRINT_PRESETS: PrintPresetDef[] = [
  {
    id: 'master',
    labelKey: 'print.preset.master',
    hintKey: 'print.preset.masterHint',
    patch: {
      variant: 'plan',
      showHours: false,
      fitOnePage: true,
      oneBrigadePerPage: true,
      groupMode: 'brigade',
    },
  },
  {
    id: 'hr',
    labelKey: 'print.preset.hr',
    hintKey: 'print.preset.hrHint',
    patch: {
      variant: 'fact',
      showHours: true,
      fitOnePage: true,
      oneBrigadePerPage: true,
      groupMode: 'brigade',
    },
  },
  {
    id: 'accountant',
    labelKey: 'print.preset.accountant',
    hintKey: 'print.preset.accountantHint',
    patch: {
      variant: 'summary',
      showHours: true,
      fitOnePage: true,
      oneBrigadePerPage: true,
      groupMode: 'brigade',
    },
  },
]

function isVariant(v: unknown): v is PrintVariant {
  return v === 'plan' || v === 'fact' || v === 'both' || v === 'summary'
}

function isLocale(v: unknown): v is Locale {
  return v === 'ru' || v === 'ka' || v === 'en'
}

function isGroupMode(v: unknown): v is MonthGroupMode {
  return v === 'brigade' || v === 'unit'
}

export function loadTimesheetPrintPrefs(): TimesheetPrintPrefs | null {
  const raw = safeLocalGet(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<TimesheetPrintPrefs>
    if (parsed.v !== 1) return null
    if (!isVariant(parsed.variant) || !isLocale(parsed.printLocale)) return null
    return {
      v: 1,
      variant: parsed.variant,
      fitOnePage: parsed.fitOnePage !== false,
      showHours: parsed.showHours === true,
      oneBrigadePerPage: parsed.oneBrigadePerPage !== false,
      printLocale: parsed.printLocale,
      georgiaOfficialHeader: parsed.georgiaOfficialHeader === true,
      groupMode: isGroupMode(parsed.groupMode) ? parsed.groupMode : 'brigade',
      brigades: Array.isArray(parsed.brigades)
        ? parsed.brigades.filter((b): b is string => typeof b === 'string')
        : undefined,
      lastPreset:
        parsed.lastPreset === 'master' ||
        parsed.lastPreset === 'hr' ||
        parsed.lastPreset === 'accountant'
          ? parsed.lastPreset
          : undefined,
    }
  } catch {
    return null
  }
}

export function saveTimesheetPrintPrefs(
  config: PrintConfig,
  opts?: { lastPreset?: TimesheetPrintPresetId },
): void {
  const prefs: TimesheetPrintPrefs = {
    v: 1,
    variant: config.variant,
    fitOnePage: config.fitOnePage,
    showHours: config.showHours,
    oneBrigadePerPage: config.oneBrigadePerPage !== false,
    printLocale: config.printLocale,
    georgiaOfficialHeader: config.georgiaOfficialHeader === true,
    groupMode: config.groupMode ?? 'brigade',
    brigades: config.brigades,
    lastPreset: opts?.lastPreset,
  }
  safeLocalSet(STORAGE_KEY, JSON.stringify(prefs))
}

/** Сводка для шапки превью: «Факт · часы · 3 бригады · RU». */
export function formatPrintConfigCaption(
  config: PrintConfig,
  t: (key: string) => string,
): string {
  const parts: string[] = []
  const variantKey =
    config.variant === 'plan'
      ? 'print.plan'
      : config.variant === 'fact'
        ? 'print.fact'
        : config.variant === 'both'
          ? 'print.both'
          : 'print.summary'
  parts.push(t(variantKey))
  parts.push(config.showHours ? t('print.caption.withHours') : t('print.caption.noHours'))
  if (config.brigades.length) {
    parts.push(
      config.brigades.length < 4
        ? config.brigades.join(', ')
        : `${config.brigades.length} ${t('print.brigadesCount')}`,
    )
  }
  parts.push(config.printLocale.toUpperCase())
  if (config.oneBrigadePerPage !== false) parts.push(t('print.caption.oneBrigade'))
  if (config.fitOnePage) parts.push(t('print.caption.fitOne'))
  return parts.join(' · ')
}

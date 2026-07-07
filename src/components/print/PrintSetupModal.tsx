import { useMemo, useRef, useState } from 'react'
import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { useModalScope } from '@/hooks/useModalScope'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { createPortal } from 'react-dom'
import { formatMonthTitle } from '@/lib/dates'
import {
  activeStructuralUnits,
  NO_STRUCTURAL_UNIT_ID,
  structuralUnitFilterKeys,
  type MonthGroupMode,
} from '@/lib/monthViewOptions'
import { timesheetStructuralUnits } from '@/lib/workshopMasterScope'
import type { AppStore, Locale } from '@/lib/types'
import { defaultSelectedBrigades, getBrigadesForPrint } from '@/lib/printBrigades'
import type { MonthSheet } from '@/lib/types'
import type { PrintConfig } from './PrintPreviewModal'

type Props = {
  sheet: MonthSheet
  store: AppStore
  brigades: string[]
  workshopMasterMode?: boolean
  primaryBrigades?: string[]
  initialConfig?: PrintConfig | null
  onConfirm: (config: PrintConfig) => void
  onClose: () => void
}

export function PrintSetupModal({
  sheet,
  store,
  brigades,
  workshopMasterMode = false,
  primaryBrigades,
  initialConfig,
  onConfirm,
  onClose,
}: Props) {
  const brigadesInfo = useMemo(
    () => getBrigadesForPrint(sheet, brigades),
    [sheet, brigades],
  )
  const { t, locale: uiLocale } = useI18n()
  const { alert } = useConfirm()
  const filled = brigadesInfo.filter((b) => b.hasEmployees)

  const timesheetUnits = useMemo(
    () => timesheetStructuralUnits(store.hrStructuralUnits, workshopMasterMode),
    [store.hrStructuralUnits, workshopMasterMode],
  )
  const unitKeys = useMemo(
    () =>
      workshopMasterMode
        ? []
        : structuralUnitFilterKeys(timesheetUnits, store.employees),
    [timesheetUnits, store.employees, workshopMasterMode],
  )
  const unitItems = useMemo(() => {
    const items = activeStructuralUnits(timesheetUnits).map((u) => ({
      id: u.id,
      name: u.name,
    }))
    if (unitKeys.includes(NO_STRUCTURAL_UNIT_ID)) {
      items.push({ id: NO_STRUCTURAL_UNIT_ID, name: t('month.unitUnassigned') })
    }
    return items
  }, [t, timesheetUnits, unitKeys])

  const [selected, setSelected] = useState<Set<string>>(() => {
    if (initialConfig?.brigades) return new Set(initialConfig.brigades)
    if (workshopMasterMode && primaryBrigades?.length) {
      return new Set(primaryBrigades.filter((b) => brigades.includes(b)))
    }
    return new Set(defaultSelectedBrigades(sheet, brigades))
  })
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(
    () => new Set(initialConfig?.structuralUnitIds ?? unitKeys),
  )
  const [groupMode, setGroupMode] = useState<MonthGroupMode>(
    initialConfig?.groupMode ?? 'brigade',
  )
  const [variant, setVariant] = useState<PrintConfig['variant']>(
    initialConfig?.variant ?? 'plan',
  )
  const [fitOnePage, setFitOnePage] = useState(initialConfig?.fitOnePage ?? true)
  const [printLocale, setPrintLocale] = useState<Locale>(
    initialConfig?.printLocale ?? uiLocale,
  )
  const panelRef = useRef<HTMLDivElement>(null)

  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    onPrimaryAction: () => {
      void handleContinue()
    },
    initialFocus: 'primary',
  })

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filled.map((b) => b.name)))
  }

  function selectNone() {
    setSelected(new Set())
  }

  async function handleContinue() {
    if (selected.size === 0) {
      await alert({ message: t('print.selectBrigade') })
      return
    }
    onConfirm({
      variant,
      brigades: [...selected],
      fitOnePage,
      printLocale,
      groupMode: workshopMasterMode ? 'brigade' : groupMode,
      structuralUnitIds:
        !workshopMasterMode && selectedUnits.size < unitKeys.length
          ? [...selectedUnits]
          : undefined,
    })
  }

  const content = (
    <div
      ref={panelRef}
      className="fixed inset-0 flex items-center justify-center bg-stone-900/50 p-4"
      style={{ zIndex }}
      role="dialog"
      aria-labelledby="print-setup-title"
      aria-modal="true"
    >
      <div className="w-full max-w-lg rounded-sm bg-white shadow-sm">
        <div className="flex items-center gap-4 border-b border-grid px-6 py-4">
          <FiberCellBrand variant="page" className="shrink-0" />
          <div>
            <h2 id="print-setup-title" className="text-lg font-bold text-ink">
              {t('print.setup')}
            </h2>
            <p className="mt-1 text-sm text-stone-500 capitalize">
              {formatMonthTitle(sheet.month, uiLocale)} — {t('print.setupHint')}
            </p>
          </div>
        </div>

        <div className="space-y-4 px-6 py-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              {t('print.language')}
            </p>
            <p className="mb-2 text-xs text-stone-500">{t('print.languageHint')}</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['ru', t('locale.ru')],
                  ['ka', t('locale.ka')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-sm border px-3 py-1.5 text-sm font-medium ${
                    printLocale === id
                      ? 'border-accent bg-accent text-white'
                      : 'border-grid bg-white text-stone-700 hover:bg-paper-dark'
                  }`}
                  onClick={() => setPrintLocale(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              {t('print.what')}
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['plan', t('print.plan')],
                  ['fact', t('print.fact')],
                  ['both', t('print.both')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`rounded-sm border px-3 py-1.5 text-sm font-medium ${
                    variant === id
                      ? 'border-accent bg-accent text-white'
                      : 'border-grid bg-white text-stone-700 hover:bg-paper-dark'
                  }`}
                  onClick={() => setVariant(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!workshopMasterMode ? (
            <>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
                  {t('month.groupBy')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['brigade', t('month.groupByBrigade')],
                      ['unit', t('month.groupByUnit')],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`rounded-sm border px-3 py-1.5 text-sm font-medium ${
                        groupMode === id
                          ? 'border-accent bg-accent text-white'
                          : 'border-grid bg-white text-stone-700 hover:bg-paper-dark'
                      }`}
                      onClick={() => setGroupMode(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {unitItems.length > 0 ? (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                      {t('month.unitsShow')}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => setSelectedUnits(new Set(unitKeys))}
                      >
                        {t('common.all')}
                      </button>
                      <span className="text-stone-300">|</span>
                      <button
                        type="button"
                        className="text-stone-500 hover:underline"
                        onClick={() => setSelectedUnits(new Set())}
                      >
                        {t('common.none')}
                      </button>
                    </div>
                  </div>
                  <ul className="max-h-[10rem] space-y-1 overflow-auto rounded-sm border border-grid p-2">
                    {unitItems.map((u) => (
                      <li key={u.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-stone-50">
                          <input
                            type="checkbox"
                            checked={selectedUnits.has(u.id)}
                            onChange={() =>
                              setSelectedUnits((prev) => {
                                const next = new Set(prev)
                                if (next.has(u.id)) next.delete(u.id)
                                else next.add(u.id)
                                return next
                              })
                            }
                          />
                          <span className="text-sm">{u.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                {t('print.brigades')}
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={selectAll}
                >
                  {t('common.all')}
                </button>
                <span className="text-stone-300">|</span>
                <button
                  type="button"
                  className="text-stone-500 hover:underline"
                  onClick={selectNone}
                >
                  {t('common.none')}
                </button>
              </div>
            </div>

            {filled.length === 0 ? (
              <p className="rounded-sm bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('print.noEmployees')}
              </p>
            ) : (
              <ul className="max-h-[14rem] space-y-2 overflow-auto rounded-sm border border-grid p-2">
                {brigadesInfo.map((b) => (
                  <li key={b.name}>
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-sm px-3 py-2.5 transition-colors ${
                        !b.hasEmployees
                          ? 'cursor-not-allowed opacity-40'
                          : selected.has(b.name)
                            ? 'bg-accent-soft/60 ring-1 ring-accent/30'
                            : 'hover:bg-stone-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-stone-300 text-accent focus:ring-accent"
                        checked={selected.has(b.name)}
                        disabled={!b.hasEmployees}
                        onChange={() => b.hasEmployees && toggle(b.name)}
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium text-ink">
                          {b.name}
                        </span>
                        <span className="text-xs text-stone-500">
                          {b.hasEmployees
                            ? `${b.employeeCount} ${t('print.employeesInSheet')}`
                            : t('print.noAssign')}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-sm border border-grid bg-stone-50 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded text-accent focus:ring-accent"
              checked={fitOnePage}
              onChange={(e) => setFitOnePage(e.target.checked)}
            />
            <span>
              <strong>{t('print.fitOnePage')}</strong>
              <span className="block text-xs font-normal text-stone-500">
                {t('print.fitOnePageHint')}
              </span>
            </span>
          </label>

          <p className="rounded-sm bg-sky-50 px-3 py-2 text-xs text-sky-900">
            {t('print.marginsHint')}
          </p>

          <p className="text-xs text-stone-400">{t('print.pagesHint')}</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-grid px-6 py-4">
          <button
            type="button"
            className="rounded-sm border border-grid px-4 py-2 text-sm font-medium hover:bg-stone-50"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-modal-primary
            className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
            disabled={filled.length === 0}
            onClick={() => void handleContinue()}
          >
            {t('print.continue')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

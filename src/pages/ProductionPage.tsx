import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceDraftRestore } from '@/hooks/useWorkspaceDraftRestore'
import { Button } from '@/components/ui/Button'
import { MonthNavigator } from '@/components/ui/MonthNavigator'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { brigadeLabel } from '@/lib/brigadeText'
import {
  brigadesForLine,
  buildBrigadeRoster,
  defaultBrigadeForLine,
  defaultForemanId,
  foremanSelectOptions,
  requestShiftKey,
} from '@/lib/production/brigades'
import {
  emptyFactRow,
  emptyPackaging,
  emptyPackagingRow,
  emptyPlanSegment,
  emptyProductionRequest,
} from '@/lib/production/init'
import { ProductionPrintPreview } from '@/components/production/ProductionPrintPreview'
import { ProductionDaySnapshot } from '@/components/production/ProductionDaySnapshot'
import { ProductionBrigadeRoster } from '@/components/production/ProductionBrigadeRoster'
import { AsOfSnapshotBar } from '@/components/asOf/AsOfSnapshotBar'
import { useAsOfSnapshot } from '@/hooks/useAsOfSnapshot'
import {
  formatNum,
  summarizeProductionMonth,
  summarizeRequest,
  weekdayLabel,
} from '@/lib/production/stats'
import {
  categoryLabel,
  PACKAGING_SECTIONS,
  PRODUCTION_CATEGORIES,
  PRODUCTION_LINES,
  type PackagingRow,
  type PackagingSectionKey,
  type ProductionCategoryKey,
  type ProductionCategoryCell,
  type ProductionLineId,
  type ProductionPlanSegment,
  type ProductionRequest,
  type ProductionRosterEntry,
  type ProductionShift,
} from '@/lib/production/types'
import {
  dayPlanMp,
  lineAllocationForDate,
  previewRequestFromPlanner,
  type GeneratePlannerRequestsResult,
} from '@/lib/planner/generateRequests'
import { useDirectoryBranch } from '@/hooks/useDirectoryBranch'
import type { WorkspaceBranchFrom, WorkspaceBranchTarget } from '@/lib/workspace/types'
import type { ProductionOrder } from '@/lib/planner/types'
import type { Employee, MonthSheet } from '@/lib/types'

type Tab = 'request' | 'journal' | 'summary'

type Props = {
  requests: ProductionRequest[]
  orders: ProductionOrder[]
  employees: Employee[]
  brigades: string[]
  brigadeNamesKa: Record<string, string>
  monthSheet?: MonthSheet | null
  activeMonth: string
  onMonthChange: (m: string) => void
  onSaveRequest: (r: ProductionRequest) => void
  onRemoveRequest: (id: string) => void
  onGenerateFromPlanner: (
    opts: { date: string; lineId?: ProductionLineId; shift?: ProductionShift; orderIds?: string[] },
  ) => GeneratePlannerRequestsResult
  branchWorkspace: (target: WorkspaceBranchTarget, from?: WorkspaceBranchFrom) => void
  clearWorkspaceDraft: (draftKey: string) => void
  workspaceRestoreSeq: number
  workspaceDrafts: Record<string, unknown>
  focusRequestId?: string | null
  onJournalFocusConsumed?: () => void
}

type ProductionWorkspaceDraft = {
  form: ProductionRequest
  editId: string | null
  tab: Tab
}

export function ProductionPage({
  requests,
  orders,
  employees,
  brigades,
  brigadeNamesKa,
  monthSheet,
  activeMonth,
  onMonthChange,
  onSaveRequest,
  onRemoveRequest,
  onGenerateFromPlanner,
  branchWorkspace,
  clearWorkspaceDraft,
  workspaceRestoreSeq,
  workspaceDrafts,
  focusRequestId,
  onJournalFocusConsumed,
}: Props) {
  const { t, tf, locale, employeeName } = useI18n()
  const { confirm } = useConfirm()
  const PROD_DRAFT_KEY = 'production-request'
  const [tab, setTab] = useState<Tab>('request')
  const [notice, setNotice] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const daySnapshot = useAsOfSnapshot()
  const {
    enabled: daySnapshotEnabled,
    setEnabled: setDaySnapshotEnabled,
    date: daySnapshotDate,
    setDate: setDaySnapshotDate,
    time: daySnapshotTime,
    setTime: setDaySnapshotTime,
    asOfIso: daySnapshotAsOf,
  } = daySnapshot
  const [form, setForm] = useState<ProductionRequest>(() =>
    emptyProductionRequest(today, '1', 'day', defaultBrigadeForLine('1', brigades)),
  )

  useWorkspaceDraftRestore<ProductionWorkspaceDraft>(
    PROD_DRAFT_KEY,
    (draft) => {
      setForm(draft.form)
      setEditId(draft.editId)
      setTab(draft.tab)
    },
    workspaceRestoreSeq,
    workspaceDrafts,
  )

  function productionDraft(): ProductionWorkspaceDraft {
    return { form, editId, tab }
  }

  const branchDirectory = useDirectoryBranch({
    t,
    branchWorkspace,
    stackDraft: true,
    returnTitle: t('nav.production'),
    returnView: 'production',
    draftKey: PROD_DRAFT_KEY,
    draft: productionDraft(),
  })

  function branchPlanner() {
    branchWorkspace(
      { title: t('nav.planner'), view: 'planner' },
      {
        title: t('nav.production'),
        draftKey: PROD_DRAFT_KEY,
        draft: productionDraft(),
        view: 'production',
      },
    )
  }

  const liveSummary = useMemo(() => summarizeRequest(form), [form])
  const monthSummary = useMemo(
    () => summarizeProductionMonth(requests, activeMonth),
    [requests, activeMonth],
  )

  const journal = useMemo(
    () =>
      [...requests]
        .filter((r) => r.date.startsWith(activeMonth))
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            a.lineId.localeCompare(b.lineId) ||
            (a.shift === 'night' ? 1 : 0) - (b.shift === 'night' ? 1 : 0),
        ),
    [requests, activeMonth],
  )

  const journalDisplay = useMemo(() => {
    if (!daySnapshotEnabled) return journal
    let list = journal.filter((r) => r.date === daySnapshotDate)
    if (daySnapshotAsOf) {
      list = list.filter(
        (r) => r.status !== 'posted' || !r.postedAt || r.postedAt <= daySnapshotAsOf,
      )
    }
    return list
  }, [journal, daySnapshotEnabled, daySnapshotDate, daySnapshotAsOf])

  const brigadeOptions = useMemo(() => {
    const preferred = brigadesForLine(form.lineId, brigades)
    const rest = brigades.filter((b) => !preferred.includes(b))
    return [...preferred, ...rest]
  }, [form.lineId, brigades])

  const foremanOptions = useMemo(
    () => foremanSelectOptions(form.brigadeName, employees, monthSheet),
    [form.brigadeName, employees, monthSheet],
  )


  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'active' || o.status === 'draft'),
    [orders],
  )

  const plannerPreview = useMemo(
    () => lineAllocationForDate(orders, form.date),
    [orders, form.date],
  )

  const plannerForCurrentShift = useMemo(
    () =>
      previewRequestFromPlanner(
        orders,
        form.date,
        form.lineId,
        form.shift,
        brigades,
        employees,
        monthSheet,
      ),
    [orders, form.date, form.lineId, form.shift, brigades, employees, monthSheet],
  )

  function applyBrigade(brigadeName: string) {
    const foremanId = defaultForemanId(brigadeName, employees, monthSheet)
    setForm((f) => ({
      ...f,
      brigadeName,
      rosterAttendance: buildBrigadeRoster(
        brigadeName,
        employees,
        monthSheet,
        f.brigadeName === brigadeName ? f.rosterAttendance : undefined,
      ),
      foremanId:
        f.foremanId && foremanSelectOptions(brigadeName, employees, monthSheet).some(
          (e) => e.id === f.foremanId,
        )
          ? f.foremanId
          : foremanId,
    }))
  }

  function effectiveRoster(): ProductionRosterEntry[] {
    if (!form.brigadeName) return []
    if (form.rosterAttendance?.length) return form.rosterAttendance
    return buildBrigadeRoster(form.brigadeName, employees, monthSheet)
  }

  function rosterDisplayLines(): { name: string; present: boolean }[] {
    return effectiveRoster()
      .map((entry) => {
        const emp = employees.find((e) => e.id === entry.employeeId)
        if (!emp) return null
        return { name: employeeName(emp), present: entry.present }
      })
      .filter((x): x is { name: string; present: boolean } => x != null)
  }

  function foremanDisplayName(foremanId?: string): string {
    if (!foremanId) return '—'
    const emp = employees.find((e) => e.id === foremanId)
    return emp ? employeeName(emp) : '—'
  }

  function resetForm(lineId: ProductionLineId = '1', shift: ProductionShift = 'day') {
    setEditId(null)
    clearWorkspaceDraft(PROD_DRAFT_KEY)
    setForm(
      emptyProductionRequest(
        today,
        lineId,
        shift,
        defaultBrigadeForLine(lineId, brigades),
      ),
    )
  }

  function loadRequest(req: ProductionRequest) {
    setEditId(req.id)
    setForm({
      ...req,
      planSegments: req.planSegments.map((s) => ({ ...s })),
      factRows: req.factRows.map((r) => ({
        ...r,
        ratl1: { ...r.ratl1 },
        ratl2: { ...r.ratl2 },
        cat4: { ...r.cat4 },
        cat31: { ...r.cat31 },
        cat32: { ...r.cat32 },
        defect: { ...r.defect },
      })),
      packaging: req.packaging
        ? {
            ...req.packaging,
            rolls: req.packaging.rolls.map((r) => ({ ...r })),
            boxes: req.packaging.boxes.map((r) => ({ ...r })),
            pallets: req.packaging.pallets.map((r) => ({ ...r })),
          }
        : req.lineId === 'pack'
          ? emptyPackaging()
          : undefined,
    })
    setTab('request')
  }

  useEffect(() => {
    if (!focusRequestId) return
    const req = requests.find((r) => r.id === focusRequestId)
    if (req) loadRequest(req)
    onJournalFocusConsumed?.()
  }, [focusRequestId])

  function updatePackagingField(field: 'thermoFilm' | 'stretch', value: string) {
    setForm((f) => ({
      ...f,
      packaging: { ...(f.packaging ?? emptyPackaging()), [field]: value },
    }))
  }

  function updatePackagingRow(
    section: PackagingSectionKey,
    idx: number,
    patch: Partial<PackagingRow>,
  ) {
    setForm((f) => {
      const p = f.packaging ?? emptyPackaging()
      const rows = [...p[section]]
      rows[idx] = { ...rows[idx], ...patch }
      return { ...f, packaging: { ...p, [section]: rows } }
    })
  }

  function addPackagingRow(section: PackagingSectionKey) {
    setForm((f) => {
      const p = f.packaging ?? emptyPackaging()
      return {
        ...f,
        packaging: { ...p, [section]: [...p[section], emptyPackagingRow()] },
      }
    })
  }

  function removePackagingRow(section: PackagingSectionKey, idx: number) {
    setForm((f) => {
      const p = f.packaging ?? emptyPackaging()
      return {
        ...f,
        packaging: { ...p, [section]: p[section].filter((_, i) => i !== idx) },
      }
    })
  }

  function updatePlanSegment(
    idx: number,
    patch: Partial<ProductionPlanSegment>,
  ) {
    setForm((f) => {
      const planSegments = [...f.planSegments]
      planSegments[idx] = { ...planSegments[idx], ...patch }
      return { ...f, planSegments }
    })
  }

  function updateFactRowMeta(
    rowIdx: number,
    field: 'palletRollQty' | 'rowNote',
    value: string,
  ) {
    setForm((f) => {
      const rows = [...f.factRows]
      const row = { ...rows[rowIdx] }
      if (field === 'rowNote') {
        row.rowNote = value || undefined
      } else {
        row.palletRollQty = value === '' ? undefined : Number(value)
      }
      rows[rowIdx] = row
      return { ...f, factRows: rows }
    })
  }

  const shiftLabel = (shift: ProductionShift) =>
    shift === 'night' ? t('production.shiftNight') : t('production.shiftDay')

  function updateCell(
    rowIdx: number,
    cat: ProductionCategoryKey,
    field: keyof ProductionCategoryCell,
    value: string,
  ) {
    setForm((f) => {
      const rows = [...f.factRows]
      const row = { ...rows[rowIdx] }
      const cell = { ...row[cat] }
      if (field === 'note') {
        cell.note = value || undefined
      } else {
        cell[field] = value === '' ? undefined : Number(value)
      }
      row[cat] = cell
      rows[rowIdx] = row
      return { ...f, factRows: rows }
    })
  }

  function applyPlannerRequest(req: ProductionRequest) {
    setEditId(req.id)
    setForm({
      ...req,
      planSegments: req.planSegments.map((s) => ({ ...s })),
      factRows: req.factRows.map((r) => ({
        ...r,
        ratl1: { ...r.ratl1 },
        ratl2: { ...r.ratl2 },
        cat4: { ...r.cat4 },
        cat31: { ...r.cat31 },
        cat32: { ...r.cat32 },
        defect: { ...r.defect },
      })),
    })
  }

  function pickFromPlanner() {
    const result = onGenerateFromPlanner({
      date: form.date,
      lineId: form.lineId,
      shift: form.shift,
    })
    const touched = result.touched.find(
      (r) =>
        r.date === form.date && r.lineId === form.lineId && r.shift === form.shift,
    )
    if (touched) {
      applyPlannerRequest(touched)
      setNotice(t('production.plannerPicked'))
      return
    }
    if (result.messages.includes('no_tasks')) {
      setNotice(t('production.plannerNoTasks'))
      return
    }
    if (result.skipped > 0) {
      setNotice(t('production.plannerSkipped'))
      return
    }
    setNotice(t('production.plannerNoTasks'))
  }

  function submit(post: boolean) {
    if (!form.date) {
      setNotice(t('production.errDate'))
      return
    }
    const key = requestShiftKey(form.date, form.lineId, form.shift)
    const duplicate = requests.find(
      (r) =>
        r.id !== editId &&
        r.status !== 'draft' &&
        requestShiftKey(r.date, r.lineId, r.shift) === key,
    )
    if (duplicate) {
      setNotice(t('production.duplicateWarn'))
      return
    }
    const now = new Date().toISOString()
    onSaveRequest({
      ...form,
      rosterAttendance: effectiveRoster(),
      status: post ? 'posted' : 'draft',
      updatedAt: now,
      createdAt: editId ? form.createdAt : now,
    })
    setNotice(post ? t('production.savedPosted') : t('production.savedDraft'))
    clearWorkspaceDraft(PROD_DRAFT_KEY)
    if (!editId) resetForm(form.lineId, form.shift)
  }

  function saveToJournal() {
    if (!form.date) {
      setNotice(t('production.errDate'))
      return
    }
    const key = requestShiftKey(form.date, form.lineId, form.shift)
    const duplicate = requests.find(
      (r) =>
        r.id !== editId &&
        r.status !== 'draft' &&
        requestShiftKey(r.date, r.lineId, r.shift) === key,
    )
    if (duplicate) {
      setNotice(t('production.duplicateWarn'))
      return
    }
    const now = new Date().toISOString()
    onSaveRequest({
      ...form,
      rosterAttendance: effectiveRoster(),
      status: 'saved',
      savedAt: now,
      updatedAt: now,
      createdAt: editId ? form.createdAt : now,
    })
    setNotice(t('production.savedToJournal'))
    clearWorkspaceDraft(PROD_DRAFT_KEY)
    setEditId(null)
    resetForm(form.lineId, form.shift)
    setTab('journal')
  }

  const lineTitle = (id: ProductionLineId) => {
    const line = PRODUCTION_LINES.find((l) => l.id === id)!
    return locale === 'ka' ? line.labelKa : line.labelRu
  }

  const planStatus =
    liveSummary.planMp <= 0
      ? 'neutral'
      : liveSummary.factMp >= liveSummary.planMp
        ? 'ok'
        : 'under'

  return (
    <PageLayout>
      <PageHeader
        badge={t('production.badge')}
        title={t('production.title')}
        subtitle={t('production.subtitle')}
        actions={
          <Button variant="secondary" size="sm" onClick={() => setPrintOpen(true)}>
            {t('production.print')}
          </Button>
        }
      />

      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-stone-500">{t('production.month')}</span>
          <MonthNavigator month={activeMonth} onChange={onMonthChange} variant="input" />
        </label>
        <TabBar
          tabs={(
            [
              ['request', 'production.tab.request'],
              ['journal', 'production.tab.journal'],
              ['summary', 'production.tab.summary'],
            ] as const
          ).map(([id, key]) => ({ id, label: t(key) }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'request' && (
        <div className="space-y-4">
          {form.packagingPlan && (
            <div className="rounded-sm border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
              <p className="font-semibold text-amber-950">{t('production.packPlanTitle')}</p>
              <p className="mt-1 text-amber-900">{form.packagingPlan.stackDescription}</p>
              <p className="mt-2 text-xs text-stone-600">
                {tf('production.packPlanStats', {
                  rolls: form.packagingPlan.rawRollsEstimated,
                  pallets: form.packagingPlan.palletsNeeded,
                  boxes: form.packagingPlan.boxesNeeded,
                  perPallet: form.packagingPlan.rollsPerPallet,
                })}
              </p>
            </div>
          )}

          {(form.fromPlanner || form.plannerSourceNote) && (
            <div className="rounded-sm border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <p className="font-semibold">{t('production.plannerBannerTitle')}</p>
              <p className="mt-1 text-emerald-800">
                {tf('production.plannerBannerBody', {
                  orders: form.plannerSourceNote || '—',
                })}
              </p>
            </div>
          )}

          {plannerPreview.length > 0 && !form.fromPlanner && (
            <div className="rounded-sm border border-emerald-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                    {t('production.plannerDayTitle')}
                  </p>
                  <p className="mt-1 text-sm text-stone-600">{t('production.plannerDayHint')}</p>
                </div>
                <button type="button" className="btn-add-outline" onClick={pickFromPlanner}>
                  {t('production.pickFromPlanner')}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {plannerPreview.map((row) => (
                  <div
                    key={row.lineId}
                    className="rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs"
                  >
                    <span className="font-semibold text-emerald-900">
                      {lineTitle(row.lineId)}
                    </span>
                    <span className="ml-2 text-emerald-800">
                      {formatNum(row.totalMp)} {t('production.unitMp')}
                    </span>
                    <span className="ml-2 text-stone-500">
                      ({row.tasks.length} {t('production.plannerOrdersShort')})
                    </span>
                  </div>
                ))}
              </div>
              {plannerForCurrentShift && (
                <p className="mt-2 text-xs text-stone-500">
                  {tf('production.plannerShiftPreview', {
                    mp: formatNum(
                      plannerForCurrentShift.planSegments.reduce(
                        (s, seg) => s + (seg.plannedQtyMp ?? 0),
                        0,
                      ),
                    ),
                  })}
                </p>
              )}
            </div>
          )}

          <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
            <h3 className="text-center text-sm font-bold uppercase tracking-wide text-ink">
              {t('production.formTitle')}
            </h3>
            <p className="text-center text-xs text-stone-500">{t('production.formTitleKa')}</p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-medium text-stone-500">
                {t('production.date')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                />
              </label>
              <div className="text-xs font-medium text-stone-500">
                {t('production.weekday')}
                <p className="mt-2 rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm capitalize">
                  {weekdayLabel(form.date, locale)}
                </p>
              </div>
              <label className="text-xs font-medium text-stone-500">
                {t('production.line')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={form.lineId}
                  onChange={(e) => {
                    const lineId = e.target.value as ProductionLineId
                    setForm((f) => {
                      const brigadeName =
                        f.brigadeName || defaultBrigadeForLine(lineId, brigades)
                      return {
                        ...f,
                        lineId,
                        packaging:
                          lineId === 'pack'
                            ? (f.packaging ?? emptyPackaging())
                            : f.packaging,
                        brigadeName,
                        foremanId:
                          f.foremanId &&
                          foremanSelectOptions(brigadeName, employees, monthSheet).some(
                            (emp) => emp.id === f.foremanId,
                          )
                            ? f.foremanId
                            : defaultForemanId(brigadeName, employees, monthSheet),
                      }
                    })
                  }}
                >
                  {PRODUCTION_LINES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {locale === 'ka' ? l.labelKa : l.labelRu}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-stone-500">
                {t('production.shift')}
                <select
                  className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                  value={form.shift}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      shift: e.target.value as ProductionShift,
                    }))
                  }
                >
                  <option value="day">{t('production.shiftDay')}</option>
                  <option value="night">{t('production.shiftNight')}</option>
                </select>
                <span className="mt-1 block text-[10px] text-stone-400">
                  {t('production.shiftNightHint')}
                </span>
              </label>
              <DirectoryFieldPicker
                label={t('production.orderLink')}
                hint={t('production.orderHint')}
                value={form.orderId ?? ''}
                placeholder={t('production.orderNone')}
                options={activeOrders.map((o) => ({
                  value: o.id,
                  label: `${o.orderNumber || o.productName} · ${o.customer}`,
                }))}
                onChange={(orderId) => {
                  const order = activeOrders.find((o) => o.id === orderId)
                  setForm((f) => {
                    const dp = order?.dayPlans.find((p) => p.date === f.date)
                    const planMp = dp ? dayPlanMp(dp) : undefined
                    return {
                      ...f,
                      orderId: orderId || undefined,
                      ...(order
                        ? {
                            lineId: dp?.lineId ?? order.lineId,
                            planSegments: f.planSegments.map((seg, i) =>
                              i === 0
                                ? {
                                    ...seg,
                                    orderId: order.id,
                                    orderNumber: order.orderNumber,
                                    dayPlanId: dp?.id,
                                    customer: order.customer,
                                    productName: order.productName,
                                    colorLogo: order.colorLogo ?? seg.colorLogo,
                                    plannedQtyMp: planMp ?? seg.plannedQtyMp,
                                    note: dp?.note || order.note || seg.note,
                                  }
                                : seg,
                            ),
                          }
                        : {}),
                    }
                  })
                }}
                onAdd={() => branchPlanner()}
              />
              <div className="sm:col-span-2 lg:col-span-2">
                <div className="rounded-sm border border-grid bg-stone-50/80 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-accent">
                    {t('production.brigadeBlock')}
                  </p>
                  <DirectoryFieldPicker
                    label={t('production.foreman')}
                    disabled={!form.brigadeName}
                    value={form.foremanId ?? ''}
                    placeholder={
                      form.brigadeName
                        ? t('production.foremanPick')
                        : t('production.foremanNeedBrigade')
                    }
                    options={foremanOptions.map((e) => ({
                      value: e.id,
                      label: employeeName(e),
                    }))}
                    onChange={(id) =>
                      setForm((f) => ({
                        ...f,
                        foremanId: id || undefined,
                      }))
                    }
                    onAdd={() => branchDirectory('employees')}
                  />
                  <DirectoryFieldPicker
                    label={t('production.brigade')}
                    value={form.brigadeName}
                    placeholder="—"
                    options={brigadeOptions.map((b) => ({
                      value: b,
                      label: brigadeLabel(b, brigadeNamesKa, locale),
                    }))}
                    onChange={(b) => applyBrigade(b)}
                    onAdd={() => branchDirectory('brigades')}
                  />
                  {form.brigadeName && (
                    <ProductionBrigadeRoster
                      brigadeName={form.brigadeName}
                      roster={effectiveRoster()}
                      employees={employees}
                      monthSheet={monthSheet}
                      onChange={(rosterAttendance) =>
                        setForm((f) => ({ ...f, rosterAttendance }))
                      }
                    />
                  )}
                </div>
              </div>
            </div>

            {form.lineId === 'pack' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-stone-500">
                  {t('production.pack.thermoFilm')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={form.packaging?.thermoFilm ?? ''}
                    onChange={(e) => updatePackagingField('thermoFilm', e.target.value)}
                  />
                </label>
                <label className="text-xs font-medium text-stone-500">
                  {t('production.pack.stretch')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={form.packaging?.stretch ?? ''}
                    onChange={(e) => updatePackagingField('stretch', e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-stone-500">
                  {t('production.rawQty')}
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    value={form.rawRollQty ?? ''}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        rawRollQty: e.target.value ? Number(e.target.value) : undefined,
                      }))
                    }
                  />
                </label>
                <label className="text-xs font-medium text-stone-500">
                  {t('production.rawNumbers')}
                  <input
                    className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                    placeholder="№1, №2…"
                    value={form.rawRollNumbers}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rawRollNumbers: e.target.value }))
                    }
                  />
                </label>
              </div>
            )}
          </div>

          {form.lineId === 'pack' &&
            PACKAGING_SECTIONS.map((section) => {
              const rows = form.packaging?.[section.key] ?? []
              const planSum = rows.reduce((s, r) => s + (r.planQty ?? 0), 0)
              const factSum = rows.reduce((s, r) => s + (r.factQty ?? 0), 0)
              return (
                <section
                  key={section.key}
                  className="rounded-sm border-2 border-accent/25 bg-orange-50/30 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-accent">
                      {t(`production.pack.${section.key}`)}
                      <span className="ml-2 font-normal normal-case text-stone-500">
                        {section.labelKa}
                      </span>
                    </h3>
                    <button
                      type="button"
                      className="btn-add-outline"
                      onClick={() => addPackagingRow(section.key)}
                    >
                      + {t('production.addRow')}
                    </button>
                  </div>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-[640px] w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-white/60 text-stone-500">
                          <th className="border border-grid px-2 py-2 w-8">№</th>
                          <th className="border border-grid px-2 py-1 text-left">
                            {t('production.pack.name')}
                          </th>
                          <th className="border border-grid px-2 py-1 text-left">
                            {t('production.planColor')}
                          </th>
                          <th className="border border-grid px-2 py-1 w-28">
                            {t('production.pack.planQty')}
                          </th>
                          <th className="border border-grid px-2 py-1 w-28">
                            {t('production.pack.factQty')}
                          </th>
                          <th className="border border-grid w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, idx) => (
                          <tr key={row.id} className="bg-white">
                            <td className="border border-grid bg-stone-50 px-2 py-1 text-center font-mono">
                              {idx + 1}
                            </td>
                            <td className="border border-grid p-0">
                              <input
                                className="w-full border-0 px-2 py-1.5"
                                value={row.name}
                                onChange={(e) =>
                                  updatePackagingRow(section.key, idx, {
                                    name: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td className="border border-grid p-0">
                              <input
                                className="w-full border-0 px-2 py-1.5"
                                value={row.colorLogo}
                                onChange={(e) =>
                                  updatePackagingRow(section.key, idx, {
                                    colorLogo: e.target.value,
                                  })
                                }
                              />
                            </td>
                            <td className="border border-grid p-0">
                              <input
                                type="number"
                                min={0}
                                className="w-full border-0 px-2 py-1.5 text-right font-mono"
                                value={row.planQty ?? ''}
                                onChange={(e) =>
                                  updatePackagingRow(section.key, idx, {
                                    planQty: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            </td>
                            <td className="border border-grid p-0">
                              <input
                                type="number"
                                min={0}
                                className="w-full border-0 px-2 py-1.5 text-right font-mono"
                                value={row.factQty ?? ''}
                                onChange={(e) =>
                                  updatePackagingRow(section.key, idx, {
                                    factQty: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            </td>
                            <td className="border border-grid px-1 py-1 text-center">
                              {rows.length > 1 && (
                                <button
                                  type="button"
                                  className="text-red-600"
                                  onClick={() => removePackagingRow(section.key, idx)}
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-accent/10 font-semibold">
                          <td className="border border-grid px-2 py-1.5" colSpan={3}>
                            {t('production.totalRow')}
                          </td>
                          <td className="border border-grid px-2 py-1.5 text-right font-mono">
                            {formatNum(planSum)}
                          </td>
                          <td className="border border-grid px-2 py-1.5 text-right font-mono">
                            {formatNum(factSum)}
                          </td>
                          <td className="border border-grid" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              )
            })}

          {form.lineId !== 'pack' && (
          <section className="rounded-sm border-2 border-accent/25 bg-orange-50/30 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-accent">
                {t('production.planBlock')}
              </h3>
              <button
                type="button"
                className="btn-add-outline"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    planSegments: [...f.planSegments, emptyPlanSegment()],
                  }))
                }
              >
                + {t('production.addPlan')}
              </button>
            </div>
            {form.planSegments.map((seg, segIdx) => (
              <div
                key={seg.id}
                className={`mt-3 rounded-sm border border-accent/20 bg-white/80 p-3 ${
                  segIdx > 0 ? 'border-t-2 border-t-accent/30 pt-4' : ''
                }`}
              >
                {(form.planSegments.length > 1 || seg.orderNumber) && (
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-accent">
                      {seg.orderNumber ? (
                        <>
                          {seg.orderNumber}
                          <span className="ml-2 font-normal text-stone-500">
                            {t('production.planSegment')} {segIdx + 1}
                          </span>
                        </>
                      ) : (
                        <>
                          {t('production.planSegment')} {segIdx + 1}
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-red-600"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          planSegments: f.planSegments.filter((_, i) => i !== segIdx),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <label className="text-xs font-medium text-stone-600">
                    {t('production.planCustomer')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={seg.customer}
                      onChange={(e) =>
                        updatePlanSegment(segIdx, { customer: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    {t('production.planProduct')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={seg.productName}
                      onChange={(e) =>
                        updatePlanSegment(segIdx, { productName: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    {t('production.planColor')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      value={seg.colorLogo}
                      onChange={(e) =>
                        updatePlanSegment(segIdx, { colorLogo: e.target.value })
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    {t('production.planQty')}
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm font-mono"
                      value={seg.plannedQtyMp ?? ''}
                      onChange={(e) =>
                        updatePlanSegment(segIdx, {
                          plannedQtyMp: e.target.value
                            ? Number(e.target.value)
                            : undefined,
                        })
                      }
                    />
                  </label>
                  <label className="text-xs font-medium text-stone-600">
                    {t('production.planNote')}
                    <input
                      className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                      placeholder="с 14:00"
                      value={seg.note ?? ''}
                      onChange={(e) =>
                        updatePlanSegment(segIdx, { note: e.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
          </section>
          )}

          {form.lineId !== 'pack' && (
          <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
                {t('production.factBlock')}
              </h3>
              <button
                type="button"
                className="btn-add-outline"
                onClick={() =>
                  setForm((f) => ({ ...f, factRows: [...f.factRows, emptyFactRow()] }))
                }
              >
                + {t('production.addRow')}
              </button>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[1100px] border-collapse text-xs">
                <thead>
                  <tr className="bg-stone-50 text-stone-500">
                    <th className="border border-grid px-2 py-2" rowSpan={2}>
                      №
                    </th>
                    <th className="border border-grid px-2 py-1 text-center" rowSpan={2}>
                      {t('production.palletRolls')}
                    </th>
                    <th className="border border-grid px-2 py-1 text-center" rowSpan={2}>
                      {t('production.rowNote')}
                    </th>
                    {PRODUCTION_CATEGORIES.map((cat) => (
                      <th
                        key={cat.key}
                        className="border border-grid px-2 py-1 text-center"
                        colSpan={cat.key === 'defect' ? 3 : 2}
                      >
                        {categoryLabel(cat.key, form.lineId, locale)}
                      </th>
                    ))}
                    <th className="border border-grid px-2 py-2" rowSpan={2} />
                  </tr>
                  <tr className="bg-stone-50/80 text-[10px] text-stone-400">
                    {PRODUCTION_CATEGORIES.map((cat) =>
                      cat.key === 'defect' ? (
                        <>
                          <th key={`${cat.key}-mp`} className="border border-grid px-1 py-1">
                            п.м
                          </th>
                          <th key={`${cat.key}-kg`} className="border border-grid px-1 py-1">
                            кг
                          </th>
                          <th key={`${cat.key}-n`} className="border border-grid px-1 py-1">
                            {t('production.noteShort')}
                          </th>
                        </>
                      ) : (
                        <>
                          <th key={`${cat.key}-mp`} className="border border-grid px-1 py-1">
                            {t('production.qtyMp')}
                          </th>
                          <th key={`${cat.key}-n`} className="border border-grid px-1 py-1">
                            {t('production.noteShort')}
                          </th>
                        </>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {form.factRows.map((row, rowIdx) => (
                    <tr key={row.id}>
                      <td className="border border-grid bg-stone-50 px-2 py-1 text-center font-mono">
                        {rowIdx + 1}
                      </td>
                      <td className="border border-grid p-0">
                        <input
                          type="number"
                          min={0}
                          className="w-full min-w-[3rem] border-0 px-1 py-1 text-center font-mono"
                          value={row.palletRollQty ?? ''}
                          onChange={(e) =>
                            updateFactRowMeta(rowIdx, 'palletRollQty', e.target.value)
                          }
                        />
                      </td>
                      <td className="border border-grid p-0">
                        <input
                          className="w-full min-w-[5rem] border-0 px-1 py-1 text-xs"
                          value={row.rowNote ?? ''}
                          onChange={(e) =>
                            updateFactRowMeta(rowIdx, 'rowNote', e.target.value)
                          }
                        />
                      </td>
                      {PRODUCTION_CATEGORIES.map((cat) => {
                        const cell = row[cat.key]
                        if (cat.key === 'defect') {
                          return (
                            <>
                              <td key={`${cat.key}-mp`} className="border border-grid p-0">
                                <input
                                  type="number"
                                  min={0}
                                  className="w-full border-0 px-1 py-1 text-right font-mono"
                                  value={cell.qtyMp ?? ''}
                                  onChange={(e) =>
                                    updateCell(rowIdx, cat.key, 'qtyMp', e.target.value)
                                  }
                                />
                              </td>
                              <td key={`${cat.key}-kg`} className="border border-grid p-0">
                                <input
                                  type="number"
                                  min={0}
                                  step={0.1}
                                  className="w-full border-0 px-1 py-1 text-right font-mono"
                                  value={cell.qtyKg ?? ''}
                                  onChange={(e) =>
                                    updateCell(rowIdx, cat.key, 'qtyKg', e.target.value)
                                  }
                                />
                              </td>
                              <td key={`${cat.key}-n`} className="border border-grid p-0">
                                <input
                                  className="w-full border-0 px-1 py-1"
                                  value={cell.note ?? ''}
                                  onChange={(e) =>
                                    updateCell(rowIdx, cat.key, 'note', e.target.value)
                                  }
                                />
                              </td>
                            </>
                          )
                        }
                        return (
                          <>
                            <td key={`${cat.key}-mp`} className="border border-grid p-0">
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                className="w-full border-0 px-1 py-1 text-right font-mono"
                                value={cell.qtyMp ?? ''}
                                onChange={(e) =>
                                  updateCell(rowIdx, cat.key, 'qtyMp', e.target.value)
                                }
                              />
                            </td>
                            <td key={`${cat.key}-n`} className="border border-grid p-0">
                              <input
                                className="w-full border-0 px-1 py-1"
                                value={cell.note ?? ''}
                                onChange={(e) =>
                                  updateCell(rowIdx, cat.key, 'note', e.target.value)
                                }
                              />
                            </td>
                          </>
                        )
                      })}
                      <td className="border border-grid px-1 py-1">
                        {form.factRows.length > 1 && (
                          <button
                            type="button"
                            className="text-red-600"
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                factRows: f.factRows.filter((_, i) => i !== rowIdx),
                              }))
                            }
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-accent/10 font-semibold">
                    <td className="border border-grid px-2 py-2">{t('production.totalRow')}</td>
                    <td className="border border-grid px-2 py-2 text-center font-mono">
                      {liveSummary.palletRolls > 0
                        ? formatNum(liveSummary.palletRolls)
                        : '—'}
                    </td>
                    <td className="border border-grid" />
                    {PRODUCTION_CATEGORIES.map((cat) =>
                      cat.key === 'defect' ? (
                        <>
                          <td className="border border-grid px-2 py-2 text-right font-mono">
                            {formatNum(liveSummary.byCategory.defect.qtyMp)}
                          </td>
                          <td className="border border-grid px-2 py-2 text-right font-mono">
                            {formatNum(liveSummary.byCategory.defect.qtyKg)}
                          </td>
                          <td className="border border-grid" />
                        </>
                      ) : (
                        <>
                          <td className="border border-grid px-2 py-2 text-right font-mono">
                            {formatNum(liveSummary.byCategory[cat.key].qtyMp)}
                          </td>
                          <td className="border border-grid" />
                        </>
                      ),
                    )}
                    <td className="border border-grid" />
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              className={`mt-4 flex flex-wrap gap-4 rounded-sm px-4 py-3 text-sm ${
                planStatus === 'ok'
                  ? 'bg-emerald-50 text-emerald-900'
                  : planStatus === 'under'
                    ? 'bg-amber-50 text-amber-900'
                    : 'bg-stone-50 text-stone-700'
              }`}
            >
              <span>
                <strong>{t('production.planLabel')}:</strong>{' '}
                {formatNum(liveSummary.planMp)} {t('production.unitMp')}
              </span>
              <span>
                <strong>{t('production.factLabel')}:</strong>{' '}
                {formatNum(liveSummary.factMp)} {t('production.unitMp')}
              </span>
              {liveSummary.palletRolls > 0 && (
                <span>
                  <strong>{t('production.palletTotal')}:</strong>{' '}
                  {formatNum(liveSummary.palletRolls)}
                </span>
              )}
              {liveSummary.factKg > 0 && (
                <span>
                  <strong>{t('production.defect')}:</strong>{' '}
                  {formatNum(liveSummary.factKg)} кг
                </span>
              )}
            </div>
          </section>
          )}

          {form.lineId !== 'pack' && (
          <label className="block rounded-sm border border-grid bg-white p-4 shadow-sm">
            <span className="text-xs font-bold uppercase text-ink-muted">
              {t('production.defectReasons')}
            </span>
            <textarea
              className="mt-2 min-h-[5rem] w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={form.defectReasons}
              onChange={(e) => setForm((f) => ({ ...f, defectReasons: e.target.value }))}
            />
          </label>
          )}

          {form.status !== 'posted' && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm hover:bg-paper-dark"
              onClick={() => submit(false)}
            >
              {t('production.saveDraft')}
            </button>
            <button
              type="button"
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
              onClick={saveToJournal}
            >
              {t('production.saveToJournal')}
            </button>
            {editId && (
              <>
                <button
                  type="button"
                  className="rounded-sm border border-red-200 px-4 py-2 text-sm text-red-700"
                  onClick={async () => {
                    if (await confirm({ message: t('production.deleteConfirm'), danger: true })) {
                      onRemoveRequest(editId)
                      resetForm()
                    }
                  }}
                >
                  {t('common.delete')}
                </button>
                <button
                  type="button"
                  className="rounded-sm px-4 py-2 text-sm text-stone-500"
                  onClick={() => resetForm(form.lineId, form.shift)}
                >
                  {t('production.newRequest')}
                </button>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {tab === 'journal' && (
        <>
          <AsOfSnapshotBar
            className="mb-4"
            enabled={daySnapshotEnabled}
            onEnabledChange={setDaySnapshotEnabled}
            date={daySnapshotDate}
            onDateChange={setDaySnapshotDate}
            time={daySnapshotTime}
            onTimeChange={setDaySnapshotTime}
            hintKey="asOf.hintProduction"
          />
          {daySnapshotEnabled ? (
            <div className="mb-4">
              <ProductionDaySnapshot
                requests={requests}
                date={daySnapshotDate}
                asOfIso={daySnapshotAsOf ?? undefined}
              />
            </div>
          ) : null}
          <div className="overflow-auto rounded-sm border border-grid bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-xs uppercase text-stone-500">
              <tr>
                <th className="px-3 py-2">{t('production.date')}</th>
                <th className="px-3 py-2">{t('production.line')}</th>
                <th className="px-3 py-2">{t('production.shift')}</th>
                <th className="px-3 py-2">{t('production.foreman')}</th>
                <th className="px-3 py-2">{t('production.brigade')}</th>
                <th className="px-3 py-2">{t('production.planLabel')}</th>
                <th className="px-3 py-2">{t('production.factLabel')}</th>
                <th className="px-3 py-2">{t('production.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {journalDisplay.map((r) => {
                const s = summarizeRequest(r)
                return (
                  <tr key={r.id} className="border-t border-grid">
                    <td className="px-3 py-2 font-mono text-xs">{r.date}</td>
                    <td className="px-3 py-2">{lineTitle(r.lineId)}</td>
                    <td className="px-3 py-2 text-xs">{shiftLabel(r.shift)}</td>
                    <td className="px-3 py-2 text-xs">{foremanDisplayName(r.foremanId)}</td>
                    <td className="px-3 py-2 text-xs text-stone-600">
                      {r.brigadeName
                        ? brigadeLabel(r.brigadeName, brigadeNamesKa, locale)
                        : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {formatNum(s.planMp)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{formatNum(s.factMp)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                          r.status === 'posted'
                            ? 'bg-emerald-100 text-emerald-800'
                            : r.status === 'saved'
                              ? 'bg-sky-100 text-sky-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {r.status === 'posted'
                          ? t('production.posted')
                          : r.status === 'saved'
                            ? t('production.saved')
                            : t('production.draft')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status !== 'posted' ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-accent hover:underline"
                          onClick={() => loadRequest(r)}
                        >
                          {t('common.edit')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="text-xs text-stone-400 hover:underline"
                          onClick={() => loadRequest(r)}
                        >
                          {t('common.view')}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {journalDisplay.length === 0 && (
            <p className="p-6 text-center text-sm text-stone-500">{t('production.empty')}</p>
          )}
        </div>
        </>
      )}

      {tab === 'summary' && (
        <div className="space-y-4">
          <AsOfSnapshotBar
            enabled={daySnapshotEnabled}
            onEnabledChange={setDaySnapshotEnabled}
            date={daySnapshotDate}
            onDateChange={setDaySnapshotDate}
            time={daySnapshotTime}
            onTimeChange={setDaySnapshotTime}
            scope="all"
            onScopeChange={() => {}}
            showScope={false}
          />
          {daySnapshotEnabled ? (
            <ProductionDaySnapshot
              requests={requests}
              date={daySnapshotDate}
              asOfIso={daySnapshotAsOf ?? undefined}
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-stone-500">{t('production.monthPlan')}</p>
              <p className="font-mono text-2xl font-bold">{formatNum(monthSummary.planMp)}</p>
              <p className="text-xs text-stone-400">{t('production.unitMp')}</p>
            </div>
            <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-stone-500">{t('production.monthFact')}</p>
              <p className="font-mono text-2xl font-bold text-accent">
                {formatNum(monthSummary.factMp)}
              </p>
              <p className="text-xs text-stone-400">{t('production.unitMp')}</p>
            </div>
            <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
              <p className="text-xs uppercase text-stone-500">{t('production.deviation')}</p>
              <p className="font-mono text-2xl font-bold">
                {formatNum(monthSummary.factMp - monthSummary.planMp)}
              </p>
            </div>
          </div>

          {monthSummary.byLine.map((row) => (
            <section
              key={row.lineId}
              className="rounded-sm border border-grid bg-white p-5 shadow-sm"
            >
              <h3 className="text-lg font-bold">{lineTitle(row.lineId)}</h3>
              <p className="text-xs text-stone-500">
                {t('production.requestsCount')}: {row.requests} · {t('production.planLabel')}:{' '}
                {formatNum(row.planMp)} · {t('production.factLabel')}: {formatNum(row.factMp)}
              </p>
              <table className="mt-4 min-w-full text-sm">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('production.col.category')}</th>
                    <th className="px-3 py-2 text-right">{t('production.factLabel')} (п.м)</th>
                    <th className="px-3 py-2 text-right">кг</th>
                  </tr>
                </thead>
                <tbody>
                  {PRODUCTION_CATEGORIES.map((cat) => (
                    <tr key={cat.key} className="border-t border-grid">
                      <td className="px-3 py-2 font-medium">
                        {categoryLabel(cat.key, row.lineId, locale)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatNum(row.byCategory[cat.key].qtyMp)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {cat.key === 'defect'
                          ? formatNum(row.byCategory.defect.qtyKg)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {printOpen && (
        <ProductionPrintPreview
          request={{ ...form, rosterAttendance: effectiveRoster() }}
          foremanName={
            form.foremanId ? foremanDisplayName(form.foremanId) : undefined
          }
          rosterLines={rosterDisplayLines()}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </PageLayout>
  )
}

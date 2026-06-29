import { useMemo, useState } from 'react'
import {
  buildItHandoverPrintModel,
  type ItHandoverPrintModel,
} from '@/components/itOffice/ItHandoverPrintSheet'
import { ItHandoverPrintPreview } from '@/components/itOffice/ItHandoverPrintPreview'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { KpiCard } from '@/components/ui/KpiCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import type { PostItHandoverActResult, UpsertItHandoverActInput } from '@/lib/itOffice/acts'
import type { IssueConsumableInput } from '@/lib/itOffice/consumables'
import { consumableBalanceQty, listLowStockConsumables } from '@/lib/itOffice/consumables'
import { actFolderPath } from '@/lib/itOffice/folders'
import { emptyAsset } from '@/lib/itOffice/init'
import {
  itActTypeLabelKey,
  itAssetKindLabelKey,
  itAssetStatusLabelKey,
  itMaintenanceKindLabelKey,
} from '@/lib/itOffice/labels'
import { listMaintenanceDue, listMaintenanceOverdue } from '@/lib/itOffice/maintenance'
import {
  assetsByEmployee,
  employeeNameMap,
  itOfficeReportSummary,
  printerAssets,
} from '@/lib/itOffice/reports'
import type {
  ItActType,
  ItAsset,
  ItAssetCatalogItem,
  ItAssetKind,
  ItAssetStatus,
  ItConsumableSpec,
  ItHandoverAct,
  ItMaintenanceKind,
  ItMaintenanceRecord,
  ItOfficeStore,
} from '@/lib/itOffice/types'
import { IT_ASSET_KINDS } from '@/lib/itOffice/types'
import type { Employee } from '@/lib/types'

type ItOfficeTab =
  | 'registry'
  | 'acts'
  | 'printers'
  | 'maintenance'
  | 'consumables'
  | 'catalog'
  | 'reports'

const IT_ACT_TYPES: ItActType[] = ['issue', 'return', 'transfer', 'write_off']

const IT_OFFICE_TABS: ItOfficeTab[] = [
  'registry',
  'acts',
  'printers',
  'maintenance',
  'consumables',
  'catalog',
  'reports',
]

type Props = {
  itOffice: ItOfficeStore
  employees: Employee[]
  operatorId: string
  operatorName: string
  onUpsertItAsset: (asset: ItAsset, nextSeq?: number) => void
  onRemoveItAsset: (assetId: string) => void
  onUpsertItCatalogItem: (item: ItAssetCatalogItem) => void
  onUpsertItHandoverActDraft: (input: UpsertItHandoverActInput) => void
  onPostItHandoverAct: (actId: string) => PostItHandoverActResult
  onRemoveItHandoverActDraft: (actId: string) => void
  onUpsertItMaintenance: (record: ItMaintenanceRecord) => void
  onRemoveItMaintenance: (id: string) => void
  onUpsertItConsumableSpec: (spec: ItConsumableSpec) => void
  onSetItConsumableBalance: (specId: string, locationId: string, qty: number) => void
  onPostItConsumableIssue: (input: IssueConsumableInput) => string | null
}

type ActFormState = {
  id?: string
  actType: ItActType
  date: string
  employeeId: string | null
  fromEmployeeId: string | null
  selectedAssetIds: string[]
  lineConditions: Record<string, string>
  comment: string
}

type Notice = { type: 'error' | 'success' | 'info'; message: string }

function mapItError(t: (key: string) => string, error: string): string {
  const key = `itOffice.error.${error}`
  const translated = t(key)
  return translated !== key ? translated : error
}

function assetsForAct(
  store: ItOfficeStore,
  actType: ItActType,
  employeeId: string | null,
  fromEmployeeId: string | null,
): ItAsset[] {
  switch (actType) {
    case 'issue':
      return store.assets.filter((a) => a.status === 'stock' || a.status === 'repair')
    case 'return':
      return store.assets.filter(
        (a) => a.status === 'issued' && (!employeeId || a.currentEmployeeId === employeeId),
      )
    case 'transfer':
      return store.assets.filter(
        (a) =>
          a.status === 'issued' &&
          (!fromEmployeeId || a.currentEmployeeId === fromEmployeeId),
      )
    case 'write_off':
      return store.assets.filter((a) => a.status !== 'written_off')
    default:
      return []
  }
}

function emptyActForm(): ActFormState {
  return {
    id: crypto.randomUUID(),
    actType: 'issue',
    date: new Date().toISOString().slice(0, 10),
    employeeId: null,
    fromEmployeeId: null,
    selectedAssetIds: [],
    lineConditions: {},
    comment: '',
  }
}

function actToForm(act: ItHandoverAct): ActFormState {
  return {
    id: act.id,
    actType: act.actType,
    date: act.date,
    employeeId: act.employeeId,
    fromEmployeeId: act.fromEmployeeId ?? null,
    selectedAssetIds: act.lines.map((l) => l.assetId),
    lineConditions: Object.fromEntries(
      act.lines.filter((l) => l.condition).map((l) => [l.assetId, l.condition!]),
    ),
    comment: act.comment ?? '',
  }
}

const selectClass = 'rounded-sm border border-grid px-3 py-2 text-sm'

export function ItOfficePage({
  itOffice,
  employees,
  operatorId,
  operatorName,
  onUpsertItAsset,
  onRemoveItAsset,
  onUpsertItCatalogItem,
  onUpsertItHandoverActDraft,
  onPostItHandoverAct,
  onRemoveItHandoverActDraft,
  onUpsertItMaintenance,
  onRemoveItMaintenance,
  onUpsertItConsumableSpec,
  onSetItConsumableBalance,
  onPostItConsumableIssue,
}: Props) {
  const { t, employeeName } = useI18n()
  const [tab, setTab] = useState<ItOfficeTab>('registry')
  const [notice, setNotice] = useState<Notice | null>(null)

  const [kindFilter, setKindFilter] = useState<ItAssetKind | ''>('')
  const [statusFilter, setStatusFilter] = useState<ItAssetStatus | ''>('')
  const [registrySearch, setRegistrySearch] = useState('')
  const [editAsset, setEditAsset] = useState<{ asset: ItAsset; nextSeq?: number } | null>(null)

  const [actFormOpen, setActFormOpen] = useState(false)
  const [actForm, setActForm] = useState<ActFormState>(emptyActForm)
  const [printModel, setPrintModel] = useState<ItHandoverPrintModel | null>(null)

  const [maintFormOpen, setMaintFormOpen] = useState(false)
  const [maintForm, setMaintForm] = useState<ItMaintenanceRecord | null>(null)

  const [editCatalog, setEditCatalog] = useState<ItAssetCatalogItem | null>(null)
  const [editSpec, setEditSpec] = useState<ItConsumableSpec | null>(null)

  const [issueSpecId, setIssueSpecId] = useState('')
  const [issueQty, setIssueQty] = useState('1')
  const [issuePrinterId, setIssuePrinterId] = useState('')
  const [issueEmployeeId, setIssueEmployeeId] = useState<string | null>(null)
  const [issueNote, setIssueNote] = useState('')

  const mainLocationId = itOffice.locations[0]?.id ?? ''
  const empNames = useMemo(() => employeeNameMap(employees), [employees])
  const locationNames = useMemo(
    () => new Map(itOffice.locations.map((l) => [l.id, l.name])),
    [itOffice.locations],
  )

  const tabLabels = useMemo(
    () =>
      Object.fromEntries(IT_OFFICE_TABS.map((id) => [id, t(`itOffice.tab.${id}`)])) as Record<
        ItOfficeTab,
        string
      >,
    [t],
  )

  const filteredAssets = useMemo(() => {
    const q = registrySearch.trim().toLowerCase()
    return itOffice.assets.filter((a) => {
      if (kindFilter && a.kind !== kindFilter) return false
      if (statusFilter && a.status !== statusFilter) return false
      if (!q) return true
      const holder = a.currentEmployeeId ? empNames.get(a.currentEmployeeId) ?? '' : ''
      return (
        a.name.toLowerCase().includes(q) ||
        a.inventoryNo.toLowerCase().includes(q) ||
        a.serialNo?.toLowerCase().includes(q) ||
        holder.toLowerCase().includes(q)
      )
    })
  }, [itOffice.assets, kindFilter, statusFilter, registrySearch, empNames])

  const actAvailableAssets = useMemo(
    () => assetsForAct(itOffice, actForm.actType, actForm.employeeId, actForm.fromEmployeeId),
    [itOffice, actForm.actType, actForm.employeeId, actForm.fromEmployeeId],
  )

  const reportSummary = useMemo(() => itOfficeReportSummary(itOffice), [itOffice])
  const byEmployee = useMemo(() => assetsByEmployee(itOffice), [itOffice])
  const lowStock = useMemo(() => listLowStockConsumables(itOffice), [itOffice])
  const maintDue = useMemo(() => listMaintenanceDue(itOffice), [itOffice])
  const maintOverdue = useMemo(() => listMaintenanceOverdue(itOffice), [itOffice])
  const printers = useMemo(() => printerAssets(itOffice), [itOffice])

  const maintenanceByAsset = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of itOffice.maintenance) {
      map.set(m.assetId, (map.get(m.assetId) ?? 0) + 1)
    }
    return map
  }, [itOffice.maintenance])

  function showNotice(type: Notice['type'], message: string) {
    setNotice({ type, message })
  }

  function openNewAsset(kind: ItAssetKind = 'laptop') {
    const { asset, nextSeq } = emptyAsset(itOffice, kind)
    setEditAsset({ asset, nextSeq })
  }

  function saveAsset() {
    if (!editAsset) return
    if (!editAsset.asset.name.trim()) {
      showNotice('error', t('itOffice.error.nameRequired'))
      return
    }
    onUpsertItAsset(editAsset.asset, editAsset.nextSeq)
    setEditAsset(null)
    showNotice('success', t('itOffice.saved'))
  }

  function openNewAct() {
    setActForm(emptyActForm())
    setActFormOpen(true)
  }

  function openEditAct(act: ItHandoverAct) {
    if (act.status !== 'draft') return
    setActForm(actToForm(act))
    setActFormOpen(true)
  }

  function buildActInput(form: ActFormState): UpsertItHandoverActInput | null {
    if (!form.employeeId) {
      showNotice('error', t('itOffice.error.employeeRequired'))
      return null
    }
    if (form.actType === 'transfer' && !form.fromEmployeeId) {
      showNotice('error', t('itOffice.error.fromEmployeeRequired'))
      return null
    }
    if (!form.selectedAssetIds.length) {
      showNotice('error', t('itOffice.error.assetsRequired'))
      return null
    }
    return {
      id: form.id ?? crypto.randomUUID(),
      actType: form.actType,
      date: form.date,
      employeeId: form.employeeId,
      fromEmployeeId: form.fromEmployeeId ?? undefined,
      issuedBy: operatorId,
      issuedByName: operatorName,
      lines: form.selectedAssetIds.map((assetId) => ({
        id: crypto.randomUUID(),
        assetId,
        condition: form.lineConditions[assetId]?.trim() || undefined,
      })),
      comment: form.comment.trim() || undefined,
    }
  }

  function saveActDraft() {
    const input = buildActInput(actForm)
    if (!input) return
    onUpsertItHandoverActDraft(input)
    setActFormOpen(false)
    showNotice('success', t('itOffice.actDraftSaved'))
  }

  function postAct() {
    const input = buildActInput(actForm)
    if (!input) return
    onUpsertItHandoverActDraft(input)
    const result = onPostItHandoverAct(input.id!)
    if (!result.ok) {
      showNotice('error', mapItError(t, result.error))
      return
    }
    setActFormOpen(false)
    showNotice('success', t('itOffice.actPosted'))
  }

  function openActPrint(act: ItHandoverAct) {
    const model = buildItHandoverPrintModel(
      act,
      itOffice.assets,
      empNames.get(act.employeeId) ?? act.employeeId,
      act.fromEmployeeId ? empNames.get(act.fromEmployeeId) : undefined,
    )
    setPrintModel(model)
  }

  function openNewMaintenance() {
    setMaintForm({
      id: crypto.randomUUID(),
      assetId: itOffice.assets[0]?.id ?? '',
      date: new Date().toISOString().slice(0, 10),
      kind: 'service',
      description: '',
      createdAt: new Date().toISOString(),
    })
    setMaintFormOpen(true)
  }

  function saveMaintenance() {
    if (!maintForm?.assetId || !maintForm.description.trim()) {
      showNotice('error', t('itOffice.error.maintenanceRequired'))
      return
    }
    onUpsertItMaintenance(maintForm)
    setMaintFormOpen(false)
    setMaintForm(null)
    showNotice('success', t('itOffice.saved'))
  }

  function openNewCatalogItem() {
    setEditCatalog({
      id: crypto.randomUUID(),
      name: '',
      kind: 'laptop',
      active: true,
      sortOrder: itOffice.catalog.length,
    })
  }

  function saveCatalogItem() {
    if (!editCatalog?.name.trim()) {
      showNotice('error', t('itOffice.error.nameRequired'))
      return
    }
    onUpsertItCatalogItem(editCatalog)
    setEditCatalog(null)
    showNotice('success', t('itOffice.saved'))
  }

  function saveSpec() {
    if (!editSpec?.name.trim()) {
      showNotice('error', t('itOffice.error.nameRequired'))
      return
    }
    onUpsertItConsumableSpec(editSpec)
    setEditSpec(null)
    showNotice('success', t('itOffice.saved'))
  }

  function submitIssue() {
    if (!issueSpecId) {
      showNotice('error', t('itOffice.error.specRequired'))
      return
    }
    const error = onPostItConsumableIssue({
      specId: issueSpecId,
      qty: Math.max(1, parseInt(issueQty, 10) || 1),
      date: new Date().toISOString().slice(0, 10),
      locationId: mainLocationId,
      printerAssetId: issuePrinterId || undefined,
      employeeId: issueEmployeeId ?? undefined,
      issuedBy: operatorId,
      issuedByName: operatorName,
      note: issueNote.trim() || undefined,
    })
    if (error) {
      showNotice('error', mapItError(t, error))
      return
    }
    setIssueQty('1')
    setIssueNote('')
    showNotice('success', t('itOffice.issuePosted'))
  }

  function toggleActAsset(assetId: string) {
    setActForm((prev) => {
      const selected = prev.selectedAssetIds.includes(assetId)
        ? prev.selectedAssetIds.filter((id) => id !== assetId)
        : [...prev.selectedAssetIds, assetId]
      return { ...prev, selectedAssetIds: selected }
    })
  }

  return (
    <PageLayout>
      <PageHeader
        badge={t('itOffice.badge')}
        title={t('itOffice.title')}
        subtitle={t('itOffice.subtitle')}
      />

      {notice && (
        <FormNotice type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <TabBar tabs={IT_OFFICE_TABS.map((id) => ({ id, label: tabLabels[id] }))} value={tab} onChange={setTab} />

      {tab === 'registry' && (
        <Card
          title={t('itOffice.registry.title')}
          actions={
            <Button variant="primary" size="sm" onClick={() => openNewAsset()}>
              {t('itOffice.addAsset')}
            </Button>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            <Input
              className="min-w-[12rem] flex-1"
              placeholder={t('itOffice.search')}
              value={registrySearch}
              onChange={(e) => setRegistrySearch(e.target.value)}
            />
            <select
              className={selectClass}
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as ItAssetKind | '')}
            >
              <option value="">{t('itOffice.filter.allKinds')}</option>
              {IT_ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(itAssetKindLabelKey(k))}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ItAssetStatus | '')}
            >
              <option value="">{t('itOffice.filter.allStatuses')}</option>
              {(['stock', 'issued', 'repair', 'written_off'] as ItAssetStatus[]).map((s) => (
                <option key={s} value={s}>
                  {t(itAssetStatusLabelKey(s))}
                </option>
              ))}
            </select>
          </div>

          <div className="fc-table-wrap">
            <table className="fc-table min-w-full">
              <thead>
                <tr>
                  <th>{t('itOffice.col.inventoryNo')}</th>
                  <th>{t('itOffice.col.name')}</th>
                  <th>{t('itOffice.col.kind')}</th>
                  <th>{t('itOffice.col.status')}</th>
                  <th>{t('itOffice.col.employee')}</th>
                  <th>{t('itOffice.col.location')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-stone-500">
                      {t('itOffice.empty')}
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td className="font-mono text-xs">{asset.inventoryNo}</td>
                      <td>{asset.name}</td>
                      <td>{t(itAssetKindLabelKey(asset.kind))}</td>
                      <td>{t(itAssetStatusLabelKey(asset.status))}</td>
                      <td>
                        {asset.currentEmployeeId
                          ? (() => {
                              const emp = employees.find((e) => e.id === asset.currentEmployeeId)
                              return emp ? employeeName(emp) : '—'
                            })()
                          : '—'}
                      </td>
                      <td>{asset.locationId ? locationNames.get(asset.locationId) ?? '—' : '—'}</td>
                      <td>
                        <div className="flex gap-1">
                          <Button size="xs" onClick={() => setEditAsset({ asset })}>
                            {t('itOffice.edit')}
                          </Button>
                          {asset.status !== 'issued' && (
                            <Button
                              size="xs"
                              variant="danger"
                              onClick={() => onRemoveItAsset(asset.id)}
                            >
                              {t('itOffice.delete')}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'acts' && (
        <div className="flex flex-col gap-4">
          <Card
            title={t('itOffice.acts.title')}
            actions={
              <Button variant="primary" size="sm" onClick={openNewAct}>
                {t('itOffice.newAct')}
              </Button>
            }
          >
            <div className="fc-table-wrap">
              <table className="fc-table min-w-full">
                <thead>
                  <tr>
                    <th>{t('itOffice.col.number')}</th>
                    <th>{t('itOffice.col.date')}</th>
                    <th>{t('itOffice.col.actType')}</th>
                    <th>{t('itOffice.col.employee')}</th>
                    <th>{t('itOffice.col.status')}</th>
                    <th>{t('itOffice.col.folder')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {itOffice.acts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-stone-500">
                        {t('itOffice.empty')}
                      </td>
                    </tr>
                  ) : (
                    [...itOffice.acts]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((act) => (
                        <tr key={act.id}>
                          <td className="font-mono text-xs">{act.number}</td>
                          <td>{act.date}</td>
                          <td>{t(itActTypeLabelKey(act.actType))}</td>
                          <td>{empNames.get(act.employeeId) ?? act.employeeId}</td>
                          <td>
                            <span
                              className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                                act.status === 'posted'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {t(`itOffice.actStatus.${act.status}`)}
                            </span>
                          </td>
                          <td className="max-w-[12rem] truncate text-xs text-stone-500">
                            {actFolderPath(act)}
                          </td>
                          <td>
                            <div className="flex flex-wrap gap-1">
                              {act.status === 'draft' && (
                                <>
                                  <Button size="xs" onClick={() => openEditAct(act)}>
                                    {t('itOffice.edit')}
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="primary"
                                    onClick={() => {
                                      const result = onPostItHandoverAct(act.id)
                                      if (!result.ok) {
                                        showNotice('error', mapItError(t, result.error))
                                      } else {
                                        showNotice('success', t('itOffice.actPosted'))
                                      }
                                    }}
                                  >
                                    {t('itOffice.post')}
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="danger"
                                    onClick={() => onRemoveItHandoverActDraft(act.id)}
                                  >
                                    {t('itOffice.delete')}
                                  </Button>
                                </>
                              )}
                              {act.status === 'posted' && (
                                <Button size="xs" variant="print" onClick={() => openActPrint(act)}>
                                  {t('itOffice.print')}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'printers' && (
        <Card title={t('itOffice.printers.title')}>
          <div className="fc-table-wrap">
            <table className="fc-table min-w-full">
              <thead>
                <tr>
                  <th>{t('itOffice.col.inventoryNo')}</th>
                  <th>{t('itOffice.col.name')}</th>
                  <th>{t('itOffice.col.kind')}</th>
                  <th>{t('itOffice.col.ip')}</th>
                  <th>{t('itOffice.col.location')}</th>
                  <th>{t('itOffice.col.employee')}</th>
                  <th>{t('itOffice.col.maintenanceCount')}</th>
                </tr>
              </thead>
              <tbody>
                {printers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-stone-500">
                      {t('itOffice.empty')}
                    </td>
                  </tr>
                ) : (
                  printers.map((asset) => (
                    <tr key={asset.id}>
                      <td className="font-mono text-xs">{asset.inventoryNo}</td>
                      <td>{asset.name}</td>
                      <td>{t(itAssetKindLabelKey(asset.kind))}</td>
                      <td className="font-mono text-xs">{asset.ipAddress || '—'}</td>
                      <td>{asset.locationId ? locationNames.get(asset.locationId) ?? '—' : '—'}</td>
                      <td>
                        {asset.currentEmployeeId
                          ? empNames.get(asset.currentEmployeeId) ?? '—'
                          : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-sm font-medium text-stone-800 underline hover:text-stone-600"
                          onClick={() => setTab('maintenance')}
                        >
                          {maintenanceByAsset.get(asset.id) ?? 0}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'maintenance' && (
        <div className="flex flex-col gap-4">
          <Card
            title={t('itOffice.maintenance.title')}
            actions={
              <Button variant="primary" size="sm" onClick={openNewMaintenance}>
                {t('itOffice.addMaintenance')}
              </Button>
            }
          >
            <div className="fc-table-wrap">
              <table className="fc-table min-w-full">
                <thead>
                  <tr>
                    <th>{t('itOffice.col.date')}</th>
                    <th>{t('itOffice.col.asset')}</th>
                    <th>{t('itOffice.col.kind')}</th>
                    <th>{t('itOffice.col.description')}</th>
                    <th>{t('itOffice.col.nextDueDate')}</th>
                    <th>{t('itOffice.col.cost')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {itOffice.maintenance.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-stone-500">
                        {t('itOffice.empty')}
                      </td>
                    </tr>
                  ) : (
                    [...itOffice.maintenance]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((rec) => {
                        const asset = itOffice.assets.find((a) => a.id === rec.assetId)
                        return (
                          <tr key={rec.id}>
                            <td>{rec.date}</td>
                            <td>{asset?.name ?? rec.assetId}</td>
                            <td>{t(itMaintenanceKindLabelKey(rec.kind))}</td>
                            <td className="max-w-xs truncate">{rec.description}</td>
                            <td>{rec.nextDueDate ?? '—'}</td>
                            <td>{rec.cost != null ? rec.cost : '—'}</td>
                            <td>
                              <Button size="xs" variant="danger" onClick={() => onRemoveItMaintenance(rec.id)}>
                                {t('itOffice.delete')}
                              </Button>
                            </td>
                          </tr>
                        )
                      })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'consumables' && (
        <div className="flex flex-col gap-4">
          <Card title={t('itOffice.consumables.specsTitle')}>
            <div className="fc-table-wrap">
              <table className="fc-table min-w-full">
                <thead>
                  <tr>
                    <th>{t('itOffice.col.name')}</th>
                    <th>{t('itOffice.col.sku')}</th>
                    <th>{t('itOffice.col.unit')}</th>
                    <th>{t('itOffice.col.balance')}</th>
                    <th>{t('itOffice.col.minStock')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {itOffice.consumableSpecs
                    .filter((s) => s.active)
                    .map((spec) => {
                      const qty = consumableBalanceQty(itOffice, spec.id, mainLocationId)
                      const low = qty < spec.minStock
                      return (
                        <tr key={spec.id} className={low ? 'bg-red-50' : undefined}>
                          <td>{spec.name}</td>
                          <td className="font-mono text-xs">{spec.sku ?? '—'}</td>
                          <td>{spec.unit}</td>
                          <td>
                            <Input
                              type="number"
                              min={0}
                              className="w-20"
                              value={qty}
                              onChange={(e) =>
                                onSetItConsumableBalance(
                                  spec.id,
                                  mainLocationId,
                                  Math.max(0, parseInt(e.target.value, 10) || 0),
                                )
                              }
                            />
                          </td>
                          <td className={low ? 'font-semibold text-red-700' : ''}>{spec.minStock}</td>
                          <td>
                            <Button size="xs" onClick={() => setEditSpec({ ...spec })}>
                              {t('itOffice.edit')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={t('itOffice.consumables.issueTitle')}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-xs font-medium text-stone-500">
                {t('itOffice.col.spec')}
                <select
                  className={`${selectClass} mt-1 block w-full`}
                  value={issueSpecId}
                  onChange={(e) => setIssueSpecId(e.target.value)}
                >
                  <option value="">{t('itOffice.selectSpec')}</option>
                  {itOffice.consumableSpecs
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs font-medium text-stone-500">
                {t('itOffice.col.qty')}
                <Input
                  type="number"
                  min={1}
                  className="mt-1"
                  value={issueQty}
                  onChange={(e) => setIssueQty(e.target.value)}
                />
              </label>
              <label className="text-xs font-medium text-stone-500">
                {t('itOffice.col.printer')}
                <select
                  className={`${selectClass} mt-1 block w-full`}
                  value={issuePrinterId}
                  onChange={(e) => setIssuePrinterId(e.target.value)}
                >
                  <option value="">{t('itOffice.optional')}</option>
                  {printers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.inventoryNo})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                {t('itOffice.col.employee')}
                <div className="mt-1">
                  <EmployeePicker
                    employees={employees}
                    value={issueEmployeeId}
                    placeholder={t('itOffice.optional')}
                    onChange={setIssueEmployeeId}
                  />
                </div>
              </label>
              <label className="text-xs font-medium text-stone-500 sm:col-span-2">
                {t('itOffice.col.note')}
                <Input className="mt-1" value={issueNote} onChange={(e) => setIssueNote(e.target.value)} />
              </label>
            </div>
            <div className="mt-4">
              <Button variant="primary" onClick={submitIssue}>
                {t('itOffice.issue')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'catalog' && (
        <Card
          title={t('itOffice.catalog.title')}
          actions={
            <Button variant="primary" size="sm" onClick={openNewCatalogItem}>
              {t('itOffice.addCatalogItem')}
            </Button>
          }
        >
          <div className="fc-table-wrap">
            <table className="fc-table min-w-full">
              <thead>
                <tr>
                  <th>{t('itOffice.col.name')}</th>
                  <th>{t('itOffice.col.kind')}</th>
                  <th>{t('itOffice.col.manufacturer')}</th>
                  <th>{t('itOffice.col.model')}</th>
                  <th>{t('itOffice.col.active')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...itOffice.catalog]
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{t(itAssetKindLabelKey(item.kind))}</td>
                      <td>{item.manufacturer ?? '—'}</td>
                      <td>{item.model ?? '—'}</td>
                      <td>{item.active ? t('itOffice.yes') : t('itOffice.no')}</td>
                      <td>
                        <Button size="xs" onClick={() => setEditCatalog({ ...item })}>
                          {t('itOffice.edit')}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'reports' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('itOffice.kpi.totalAssets')} value={reportSummary.totalAssets} />
            <KpiCard label={t('itOffice.kpi.inStock')} value={reportSummary.inStock} tone="ok" />
            <KpiCard label={t('itOffice.kpi.issued')} value={reportSummary.issued} />
            <KpiCard label={t('itOffice.kpi.inRepair')} value={reportSummary.inRepair} tone="warn" />
            <KpiCard label={t('itOffice.kpi.printers')} value={reportSummary.printers} />
            <KpiCard label={t('itOffice.kpi.actsPosted')} value={reportSummary.actsPosted} />
            <KpiCard
              label={t('itOffice.kpi.lowStock')}
              value={reportSummary.lowStockCount}
              tone={reportSummary.lowStockCount > 0 ? 'warn' : 'default'}
            />
            <KpiCard
              label={t('itOffice.kpi.maintenanceOverdue')}
              value={reportSummary.maintenanceOverdue}
              tone={reportSummary.maintenanceOverdue > 0 ? 'warn' : 'default'}
            />
          </div>

          <Card title={t('itOffice.reports.byEmployee')}>
            <div className="fc-table-wrap">
              <table className="fc-table min-w-full">
                <thead>
                  <tr>
                    <th>{t('itOffice.col.employee')}</th>
                    <th>{t('itOffice.col.assetsCount')}</th>
                    <th>{t('itOffice.col.assets')}</th>
                  </tr>
                </thead>
                <tbody>
                  {byEmployee.size === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-stone-500">
                        {t('itOffice.empty')}
                      </td>
                    </tr>
                  ) : (
                    [...byEmployee.entries()].map(([empId, assets]) => (
                      <tr key={empId}>
                        <td>{empNames.get(empId) ?? empId}</td>
                        <td>{assets.length}</td>
                        <td className="text-sm text-stone-600">
                          {assets.map((a) => `${a.name} (${a.inventoryNo})`).join('; ')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('itOffice.reports.lowStock')}>
              {lowStock.length === 0 ? (
                <p className="text-sm text-stone-500">{t('itOffice.reports.none')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {lowStock.map(({ spec, total }) => (
                    <li key={spec.id} className="text-red-800">
                      {spec.name}: {total} / {spec.minStock} {spec.unit}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t('itOffice.reports.maintenanceOverdue')}>
              {maintOverdue.length === 0 ? (
                <p className="text-sm text-stone-500">{t('itOffice.reports.none')}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {maintOverdue.map((m) => {
                    const asset = itOffice.assets.find((a) => a.id === m.assetId)
                    return (
                      <li key={m.id} className="text-red-800">
                        {asset?.name ?? m.assetId} — {m.nextDueDate}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>

          {maintDue.length > 0 && (
            <Card title={t('itOffice.reports.maintenanceDue')}>
              <ul className="space-y-2 text-sm">
                {maintDue.map((m) => {
                  const asset = itOffice.assets.find((a) => a.id === m.assetId)
                  return (
                    <li key={m.id}>
                      {asset?.name ?? m.assetId} — {m.nextDueDate}
                    </li>
                  )
                })}
              </ul>
            </Card>
          )}
        </div>
      )}

      <AppDialog
        open={!!editAsset}
        onClose={() => setEditAsset(null)}
        title={t('itOffice.assetForm.title')}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditAsset(null)}>{t('itOffice.cancel')}</Button>
            <Button variant="primary" onClick={saveAsset}>
              {t('itOffice.save')}
            </Button>
          </div>
        }
      >
        {editAsset && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.inventoryNo')}
              <Input className="mt-1 font-mono" value={editAsset.asset.inventoryNo} readOnly />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.kind')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={editAsset.asset.kind}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, kind: e.target.value as ItAssetKind },
                  })
                }
              >
                {IT_ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(itAssetKindLabelKey(k))}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.name')}
              <Input
                className="mt-1"
                value={editAsset.asset.name}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, name: e.target.value },
                  })
                }
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.serialNo')}
              <Input
                className="mt-1"
                value={editAsset.asset.serialNo ?? ''}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, serialNo: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.status')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={editAsset.asset.status}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, status: e.target.value as ItAssetStatus },
                  })
                }
              >
                {(['stock', 'issued', 'repair', 'written_off'] as ItAssetStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {t(itAssetStatusLabelKey(s))}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.location')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={editAsset.asset.locationId ?? ''}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, locationId: e.target.value || undefined },
                  })
                }
              >
                {itOffice.locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.ip')}
              <Input
                className="mt-1 font-mono"
                value={editAsset.asset.ipAddress ?? ''}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, ipAddress: e.target.value || undefined },
                  })
                }
              />
            </label>
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.note')}
              <Input
                className="mt-1"
                value={editAsset.asset.note ?? ''}
                onChange={(e) =>
                  setEditAsset({
                    ...editAsset,
                    asset: { ...editAsset.asset, note: e.target.value || undefined },
                  })
                }
              />
            </label>
          </div>
        )}
      </AppDialog>

      <AppDialog
        open={actFormOpen}
        onClose={() => setActFormOpen(false)}
        title={actForm.id ? t('itOffice.actForm.editTitle') : t('itOffice.actForm.newTitle')}
        size="xl"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setActFormOpen(false)}>{t('itOffice.cancel')}</Button>
            <Button onClick={saveActDraft}>{t('itOffice.saveDraft')}</Button>
            <Button variant="primary" onClick={postAct}>
              {t('itOffice.post')}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-stone-500">
            {t('itOffice.col.actType')}
            <select
              className={`${selectClass} mt-1 block w-full`}
              value={actForm.actType}
              onChange={(e) =>
                setActForm({
                  ...actForm,
                  actType: e.target.value as ItActType,
                  selectedAssetIds: [],
                })
              }
            >
              {IT_ACT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(itActTypeLabelKey(type))}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-500">
            {t('itOffice.col.date')}
            <Input
              type="date"
              className="mt-1"
              value={actForm.date}
              onChange={(e) => setActForm({ ...actForm, date: e.target.value })}
            />
          </label>
          <label className="text-xs font-medium text-stone-500 sm:col-span-2">
            {t('itOffice.col.employee')}
            <div className="mt-1">
              <EmployeePicker
                employees={employees}
                value={actForm.employeeId}
                onChange={(id) => setActForm({ ...actForm, employeeId: id, selectedAssetIds: [] })}
              />
            </div>
          </label>
          {actForm.actType === 'transfer' && (
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.fromEmployee')}
              <div className="mt-1">
                <EmployeePicker
                  employees={employees}
                  value={actForm.fromEmployeeId}
                  excludeId={actForm.employeeId ?? undefined}
                  onChange={(id) =>
                    setActForm({ ...actForm, fromEmployeeId: id, selectedAssetIds: [] })
                  }
                />
              </div>
            </label>
          )}
          <label className="text-xs font-medium text-stone-500 sm:col-span-2">
            {t('itOffice.col.comment')}
            <Input
              className="mt-1"
              value={actForm.comment}
              onChange={(e) => setActForm({ ...actForm, comment: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-stone-700">{t('itOffice.actForm.selectAssets')}</p>
          {actAvailableAssets.length === 0 ? (
            <p className="text-sm text-stone-500">{t('itOffice.actForm.noAssets')}</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-sm border border-grid p-3">
              {actAvailableAssets.map((asset) => {
                const checked = actForm.selectedAssetIds.includes(asset.id)
                return (
                  <label
                    key={asset.id}
                    className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1 hover:bg-stone-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleActAsset(asset.id)}
                      className="mt-1"
                    />
                    <span className="flex-1 text-sm">
                      <span className="font-medium">{asset.name}</span>{' '}
                      <span className="font-mono text-xs text-stone-500">({asset.inventoryNo})</span>
                      {checked && (
                        <Input
                          className="mt-1"
                          placeholder={t('itOffice.col.condition')}
                          value={actForm.lineConditions[asset.id] ?? ''}
                          onChange={(e) =>
                            setActForm({
                              ...actForm,
                              lineConditions: {
                                ...actForm.lineConditions,
                                [asset.id]: e.target.value,
                              },
                            })
                          }
                        />
                      )}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {actForm.id && itOffice.acts.find((a) => a.id === actForm.id) && (
          <p className="mt-3 text-xs text-stone-500">
            {t('itOffice.col.folder')}:{' '}
            {actFolderPath(itOffice.acts.find((a) => a.id === actForm.id)!)}
          </p>
        )}
      </AppDialog>

      <AppDialog
        open={maintFormOpen}
        onClose={() => setMaintFormOpen(false)}
        title={t('itOffice.maintenance.formTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMaintFormOpen(false)}>{t('itOffice.cancel')}</Button>
            <Button variant="primary" onClick={saveMaintenance}>
              {t('itOffice.save')}
            </Button>
          </div>
        }
      >
        {maintForm && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.asset')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={maintForm.assetId}
                onChange={(e) => setMaintForm({ ...maintForm, assetId: e.target.value })}
              >
                {itOffice.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.inventoryNo})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.date')}
              <Input
                type="date"
                className="mt-1"
                value={maintForm.date}
                onChange={(e) => setMaintForm({ ...maintForm, date: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.kind')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={maintForm.kind}
                onChange={(e) =>
                  setMaintForm({ ...maintForm, kind: e.target.value as ItMaintenanceKind })
                }
              >
                {(['service', 'repair', 'replacement', 'other'] as ItMaintenanceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {t(itMaintenanceKindLabelKey(k))}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.description')}
              <Input
                as="textarea"
                className="mt-1 min-h-[4rem]"
                value={maintForm.description}
                onChange={(e) => setMaintForm({ ...maintForm, description: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.nextDueDate')}
              <Input
                type="date"
                className="mt-1"
                value={maintForm.nextDueDate ?? ''}
                onChange={(e) =>
                  setMaintForm({ ...maintForm, nextDueDate: e.target.value || undefined })
                }
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.cost')}
              <Input
                type="number"
                min={0}
                step="0.01"
                className="mt-1"
                value={maintForm.cost ?? ''}
                onChange={(e) =>
                  setMaintForm({
                    ...maintForm,
                    cost: e.target.value ? parseFloat(e.target.value) : undefined,
                  })
                }
              />
            </label>
          </div>
        )}
      </AppDialog>

      <AppDialog
        open={!!editCatalog}
        onClose={() => setEditCatalog(null)}
        title={t('itOffice.catalog.formTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditCatalog(null)}>{t('itOffice.cancel')}</Button>
            <Button variant="primary" onClick={saveCatalogItem}>
              {t('itOffice.save')}
            </Button>
          </div>
        }
      >
        {editCatalog && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.name')}
              <Input
                className="mt-1"
                value={editCatalog.name}
                onChange={(e) => setEditCatalog({ ...editCatalog, name: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.kind')}
              <select
                className={`${selectClass} mt-1 block w-full`}
                value={editCatalog.kind}
                onChange={(e) =>
                  setEditCatalog({ ...editCatalog, kind: e.target.value as ItAssetKind })
                }
              >
                {IT_ASSET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(itAssetKindLabelKey(k))}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-500 flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={editCatalog.active}
                onChange={(e) => setEditCatalog({ ...editCatalog, active: e.target.checked })}
              />
              {t('itOffice.col.active')}
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.manufacturer')}
              <Input
                className="mt-1"
                value={editCatalog.manufacturer ?? ''}
                onChange={(e) =>
                  setEditCatalog({ ...editCatalog, manufacturer: e.target.value || undefined })
                }
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.model')}
              <Input
                className="mt-1"
                value={editCatalog.model ?? ''}
                onChange={(e) =>
                  setEditCatalog({ ...editCatalog, model: e.target.value || undefined })
                }
              />
            </label>
          </div>
        )}
      </AppDialog>

      <AppDialog
        open={!!editSpec}
        onClose={() => setEditSpec(null)}
        title={t('itOffice.consumables.specFormTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditSpec(null)}>{t('itOffice.cancel')}</Button>
            <Button variant="primary" onClick={saveSpec}>
              {t('itOffice.save')}
            </Button>
          </div>
        }
      >
        {editSpec && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-500 sm:col-span-2">
              {t('itOffice.col.name')}
              <Input
                className="mt-1"
                value={editSpec.name}
                onChange={(e) => setEditSpec({ ...editSpec, name: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.sku')}
              <Input
                className="mt-1 font-mono"
                value={editSpec.sku ?? ''}
                onChange={(e) => setEditSpec({ ...editSpec, sku: e.target.value || undefined })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.unit')}
              <Input
                className="mt-1"
                value={editSpec.unit}
                onChange={(e) => setEditSpec({ ...editSpec, unit: e.target.value })}
              />
            </label>
            <label className="text-xs font-medium text-stone-500">
              {t('itOffice.col.minStock')}
              <Input
                type="number"
                min={0}
                className="mt-1"
                value={editSpec.minStock}
                onChange={(e) =>
                  setEditSpec({ ...editSpec, minStock: Math.max(0, parseInt(e.target.value, 10) || 0) })
                }
              />
            </label>
          </div>
        )}
      </AppDialog>

      {printModel && (
        <ItHandoverPrintPreview model={printModel} onClose={() => setPrintModel(null)} />
      )}
    </PageLayout>
  )
}

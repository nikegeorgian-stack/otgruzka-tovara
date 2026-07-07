import { useMemo, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { FormNotice } from '@/components/ui/FormNotice'
import { Input } from '@/components/ui/Input'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { employmentAgreementLabel } from '@/lib/hr/labels'
import { calcWorkwearAmortization, calcWorkwearWithholding } from '@/lib/workwear/amortization'
import { checkWorkwearEligibility } from '@/lib/workwear/eligibility'
import { filterEmployeesForDate } from '@/lib/hr/employeeActive'
import {
  workwearSeasonLabel,
  workwearPpeCategoryLabel,
  workwearSizeGridLabel,
  WORKWEAR_PPE_CATEGORIES,
  WORKWEAR_SIZE_GRIDS,
  defaultSizesForCatalog,
} from '@/lib/workwear/labels'
import { warehouseStockForCatalogItem } from '@/lib/workwear/warehouseSync'
import { defaultSizeGridForCategory } from '@/lib/workwear/sizes'
import type { PostWorkwearIssueResult } from '@/lib/workwear/issue'
import type {
  WorkwearCatalogItem,
  WorkwearPpeCategory,
  WorkwearSeason,
  WorkwearSizeGrid,
  WorkwearStore,
} from '@/lib/workwear/types'
import { WORKWEAR_AMORTIZATION_MONTHS } from '@/lib/workwear/types'
import type { Employee } from '@/lib/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import { formatQty } from '@/lib/warehouse/stock'

type Props = {
  workwear: WorkwearStore
  warehouse: WarehouseStore
  employees: Employee[]
  keeperId?: string
  keeperName?: string
  /** Срез на дату архива — фильтр списка сотрудников */
  asOfDate?: string
  onUpsertCatalogItem: (item: WorkwearCatalogItem) => void
  onArchiveCatalogItem: (id: string, archived: boolean) => void
  onPostIssuance: (
    input: {
      employeeId: string
      itemId: string
      size: string
      quantity: number
      issueDate: string
      unitPrice?: number
      comment?: string
      issuedBy: string
      issuedByName: string
    },
  ) => PostWorkwearIssueResult
}

type SubTab = 'issue' | 'catalog'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function parsePrice(raw: string): number {
  const n = Number(raw.replace(',', '.').trim())
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function errorKey(error: string): string {
  const map: Record<string, string> = {
    no_agreement: 'workwear.error.noAgreement',
    fixed_term: 'workwear.error.fixedTerm',
    inactive: 'workwear.error.inactive',
    employee_not_found: 'workwear.error.employeeNotFound',
    item_not_found: 'workwear.error.itemNotFound',
    size_required: 'workwear.error.sizeRequired',
    invalid_size: 'workwear.error.invalidSize',
    price_required: 'workwear.error.priceRequired',
    insufficient_stock: 'workwear.error.insufficientStock',
    no_warehouse_link: 'workwear.error.noWarehouseLink',
    no_warehouse: 'workwear.error.noWarehouse',
  }
  return map[error] ?? 'workwear.error.unknown'
}

export function WarehouseWorkwearTab({
  workwear,
  warehouse,
  employees,
  keeperId,
  keeperName,
  asOfDate,
  onUpsertCatalogItem,
  onArchiveCatalogItem,
  onPostIssuance,
}: Props) {
  const { t, locale } = useI18n()
  const [subTab, setSubTab] = useState<SubTab>('issue')
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogSeasonFilter, setCatalogSeasonFilter] = useState<'' | WorkwearSeason>('')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [itemId, setItemId] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [issueDate, setIssueDate] = useState(todayIso)
  const [unitPrice, setUnitPrice] = useState('')
  const [comment, setComment] = useState('')
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; key: string } | null>(null)
  const [editCatalog, setEditCatalog] = useState<WorkwearCatalogItem | null>(null)
  const [priceDraft, setPriceDraft] = useState('')

  const activeEmployees = useMemo(
    () =>
      filterEmployeesForDate(employees, asOfDate)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [employees, asOfDate],
  )

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return activeEmployees
    return activeEmployees.filter((e) => e.fullName.toLowerCase().includes(q))
  }, [activeEmployees, employeeSearch])

  const selectedEmployee = selectedEmployeeId
    ? employees.find((e) => e.id === selectedEmployeeId) ?? null
    : null

  const eligibility = selectedEmployee
    ? checkWorkwearEligibility(selectedEmployee, asOfDate ?? issueDate)
    : null

  const catalogItems = useMemo(
    () => [...workwear.catalog].sort((a, b) => a.sortOrder - b.sortOrder),
    [workwear.catalog],
  )

  const activeCatalog = catalogItems.filter((c) => c.active)

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    return catalogItems.filter((c) => {
      if (catalogSeasonFilter && c.season !== catalogSeasonFilter) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        workwearPpeCategoryLabel(c.ppeCategory, locale).toLowerCase().includes(q)
      )
    })
  }, [catalogItems, catalogSearch, catalogSeasonFilter, locale])

  const selectedItem = itemId ? catalogItems.find((c) => c.id === itemId) : undefined

  const selectedStock = selectedItem
    ? warehouseStockForCatalogItem(warehouse, selectedItem)
    : null

  const employeeIssuances = useMemo(() => {
    if (!selectedEmployeeId) return []
    return workwear.issuances
      .filter((i) => i.employeeId === selectedEmployeeId)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
  }, [workwear.issuances, selectedEmployeeId])

  const withholding = selectedEmployeeId
    ? calcWorkwearWithholding(employeeIssuances, todayIso())
    : 0

  function openCatalogEditor(item: WorkwearCatalogItem) {
    setEditCatalog({ ...item })
    setPriceDraft(item.unitPrice > 0 ? String(item.unitPrice) : '')
  }

  function startNewCatalogItem() {
    const ppeCategory: WorkwearPpeCategory = 'upper'
    const sizeGrid = defaultSizeGridForCategory(ppeCategory)
    const item: WorkwearCatalogItem = {
      id: crypto.randomUUID(),
      name: '',
      ppeCategory,
      season: 'summer',
      sizeGrid,
      unitPrice: 0,
      currency: 'GEL',
      sizes: defaultSizesForCatalog(ppeCategory, sizeGrid),
      active: true,
      sortOrder: catalogItems.length,
    }
    openCatalogEditor(item)
  }

  function setCatalogPpeCategory(ppeCategory: WorkwearPpeCategory) {
    if (!editCatalog) return
    const sizeGrid = defaultSizeGridForCategory(ppeCategory)
    setEditCatalog({
      ...editCatalog,
      ppeCategory,
      sizeGrid,
      sizes: defaultSizesForCatalog(ppeCategory, sizeGrid),
    })
  }

  function setCatalogSizeGrid(sizeGrid: WorkwearSizeGrid) {
    if (!editCatalog) return
    setEditCatalog({
      ...editCatalog,
      sizeGrid,
      sizes:
        sizeGrid === 'free'
          ? editCatalog.sizes
          : defaultSizesForCatalog(editCatalog.ppeCategory, sizeGrid),
    })
  }

  function toggleCatalogSize(sizeLabel: string) {
    if (!editCatalog) return
    const has = editCatalog.sizes.includes(sizeLabel)
    setEditCatalog({
      ...editCatalog,
      sizes: has
        ? editCatalog.sizes.filter((s) => s !== sizeLabel)
        : [...editCatalog.sizes, sizeLabel].sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true }),
          ),
    })
  }

  function selectItem(id: string) {
    setItemId(id)
    const item = catalogItems.find((c) => c.id === id)
    if (item) {
      setUnitPrice(item.unitPrice > 0 ? String(item.unitPrice) : '')
      setSize(item.sizes[0] ?? '')
    }
  }

  function handlePost() {
    if (!selectedEmployee || !keeperId || !keeperName) return
    if (!eligibility?.ok) {
      setNotice({
        type: 'error',
        key: errorKey(eligibility?.reason ?? 'no_agreement'),
      })
      return
    }
    const price = unitPrice.trim() ? parsePrice(unitPrice) : undefined
    const result = onPostIssuance({
      employeeId: selectedEmployee.id,
      itemId,
      size,
      quantity,
      issueDate,
      unitPrice: price,
      comment,
      issuedBy: keeperId,
      issuedByName: keeperName,
    })
    if (!result.ok) {
      setNotice({ type: 'error', key: errorKey(result.error) })
      return
    }
    setNotice({ type: 'success', key: 'workwear.issueSuccess' })
    setComment('')
    setQuantity(1)
  }

  function saveCatalogItem() {
    if (!editCatalog || !editCatalog.name.trim()) return
    const unitPrice = parsePrice(priceDraft)
    onUpsertCatalogItem({
      ...editCatalog,
      name: editCatalog.name.trim(),
      unitPrice,
      sizes: editCatalog.sizes.filter(Boolean),
    })
    setEditCatalog(null)
    setPriceDraft('')
  }

  const catalogDialogFooter = (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={() => setEditCatalog(null)}>
        {t('workwear.cancel')}
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={saveCatalogItem}
        disabled={!editCatalog?.name.trim()}
      >
        {t('workwear.save')}
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      <TabBar
        tabs={[
          { id: 'issue' as const, label: t('workwear.subTab.issue') },
          { id: 'catalog' as const, label: t('workwear.subTab.catalog'), count: activeCatalog.length },
        ]}
        value={subTab}
        onChange={setSubTab}
      />

      {notice && (
        <FormNotice
          type={notice.type}
          message={t(notice.key)}
          onDismiss={() => setNotice(null)}
        />
      )}

      {subTab === 'issue' && (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
          <Card title={t('workwear.employeeList')} padding="sm">
            <Input
              type="search"
              placeholder={t('workwear.searchEmployee')}
              value={employeeSearch}
              onChange={(e) => setEmployeeSearch(e.target.value)}
            />
            <ul className="mt-3 max-h-[480px] space-y-0.5 overflow-y-auto">
              {filteredEmployees.map((emp) => {
                const el = checkWorkwearEligibility(emp)
                const active = selectedEmployeeId === emp.id
                return (
                  <li key={emp.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedEmployeeId(emp.id)
                        setNotice(null)
                      }}
                      className={`w-full rounded-sm px-3 py-2.5 text-left text-sm transition ${
                        active
                          ? 'bg-teal-800 text-white shadow-sm'
                          : 'hover:bg-stone-50'
                      }`}
                    >
                      <span className="font-medium">{emp.fullName}</span>
                      {!el.ok && (
                        <span
                          className={`mt-0.5 block text-[11px] leading-tight ${
                            active ? 'text-teal-100' : 'text-amber-700'
                          }`}
                        >
                          {t(errorKey(el.reason))}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
              {filteredEmployees.length === 0 && (
                <li className="py-6 text-center text-sm text-stone-400">
                  {t('workwear.noEmployees')}
                </li>
              )}
            </ul>
          </Card>

          <div className="space-y-4">
            {!selectedEmployee ? (
              <Card>
                <p className="py-8 text-center text-sm text-stone-500">
                  {t('workwear.selectEmployee')}
                </p>
              </Card>
            ) : (
              <>
                <Card title={selectedEmployee.fullName}>
                  <p className="text-sm text-stone-600">
                    {t('workwear.agreement')}:{' '}
                    <span className="font-medium text-ink">
                      {employmentAgreementLabel(
                        selectedEmployee.employmentAgreementKind,
                        locale,
                      )}
                    </span>
                  </p>
                  {eligibility && !eligibility.ok && (
                    <div className="mt-3">
                      <FormNotice type="error" message={t(errorKey(eligibility.reason))} />
                    </div>
                  )}
                  {withholding > 0 && (
                    <p className="mt-2 text-sm text-amber-800">
                      {t('workwear.withholdingHint')}:{' '}
                      <span className="font-semibold">{withholding.toFixed(2)} GEL</span>
                    </p>
                  )}
                </Card>

                <Card
                  title={t('workwear.issueForm')}
                  className={eligibility && !eligibility.ok ? 'opacity-50 pointer-events-none' : ''}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label={t('workwear.field.item')}>
                      <select
                        className="fc-input"
                        value={itemId}
                        onChange={(e) => selectItem(e.target.value)}
                      >
                        <option value="">—</option>
                        {activeCatalog.map((c) => {
                          const stock = warehouseStockForCatalogItem(warehouse, c)
                          return (
                            <option key={c.id} value={c.id}>
                              [{workwearPpeCategoryLabel(c.ppeCategory, locale)}] {c.name} —{' '}
                              {workwearSeasonLabel(c.season, locale)}
                              {stock != null
                                ? ` (${formatQty(stock.available)} ${t('workwear.pcs')})`
                                : ''}
                            </option>
                          )
                        })}
                      </select>
                    </FormField>

                    <FormField label={t('workwear.field.size')}>
                      {selectedItem && selectedItem.sizes.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedItem.sizes.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setSize(s)}
                              className={`rounded-sm border px-2.5 py-1 text-sm ${
                                size === s
                                  ? 'border-teal-700 bg-teal-50 font-medium text-teal-900'
                                  : 'border-grid bg-white text-stone-600 hover:border-stone-300'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <Input value={size} onChange={(e) => setSize(e.target.value)} />
                      )}
                    </FormField>

                    <FormField label={t('workwear.field.quantity')}>
                      <Input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(e) =>
                          setQuantity(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    </FormField>

                    <FormField label={t('workwear.field.price')}>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={unitPrice}
                        onChange={(e) => setUnitPrice(e.target.value)}
                        placeholder="0.00"
                      />
                    </FormField>

                    <FormField label={t('workwear.field.issueDate')}>
                      <Input
                        type="date"
                        value={issueDate}
                        onChange={(e) => setIssueDate(e.target.value)}
                      />
                    </FormField>

                    <FormField label={t('workwear.field.comment')} className="sm:col-span-2">
                      <Input value={comment} onChange={(e) => setComment(e.target.value)} />
                    </FormField>
                  </div>

                  {selectedItem && (
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 rounded-sm bg-stone-50 px-3 py-2 text-xs text-stone-600">
                      <span>{workwearPpeCategoryLabel(selectedItem.ppeCategory, locale)}</span>
                      <span>
                        {t('workwear.amortizationHint')}:{' '}
                        {WORKWEAR_AMORTIZATION_MONTHS[selectedItem.season]} {t('workwear.months')}
                      </span>
                      {selectedStock != null && (
                        <span
                          className={
                            selectedStock.available < quantity
                              ? 'font-semibold text-red-700'
                              : 'font-semibold text-teal-800'
                          }
                        >
                          {t('workwear.stock')}: {formatQty(selectedStock.available)}{' '}
                          {t('workwear.pcs')}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-4">
                    <Button
                      variant="primary"
                      disabled={!itemId || !size || !keeperId || !eligibility?.ok}
                      onClick={handlePost}
                    >
                      {t('workwear.postIssue')}
                    </Button>
                  </div>
                </Card>

                {employeeIssuances.length > 0 && (
                  <Card title={t('workwear.history')}>
                    <div className="overflow-x-auto">
                      <table className="fc-table w-full text-sm">
                        <thead>
                          <tr>
                            <th>{t('workwear.col.date')}</th>
                            <th>{t('workwear.col.item')}</th>
                            <th>{t('workwear.col.size')}</th>
                            <th>{t('workwear.col.amount')}</th>
                            <th>{t('workwear.col.residual')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employeeIssuances.map((iss) => {
                            const item = catalogItems.find((c) => c.id === iss.itemId)
                            const am = calcWorkwearAmortization(iss, todayIso())
                            return (
                              <tr key={iss.id}>
                                <td className="whitespace-nowrap">{iss.issueDate}</td>
                                <td>
                                  {item?.name ?? '—'}
                                  <span className="block text-[11px] text-stone-400">
                                    {iss.documentNumber}
                                  </span>
                                </td>
                                <td>{iss.size}</td>
                                <td>
                                  {(iss.unitPrice * iss.quantity).toFixed(2)} {iss.currency}
                                </td>
                                <td>
                                  {am.fullyAmortized
                                    ? t('workwear.amortized')
                                    : `${am.residualValue.toFixed(2)} ${iss.currency}`}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {subTab === 'catalog' && (
        <div className="space-y-4">
          <Card
            title={t('workwear.subTab.catalog')}
            description={t('workwear.catalogHint')}
            actions={
              <Button variant="primary" size="sm" onClick={startNewCatalogItem}>
                + {t('workwear.addItem')}
              </Button>
            }
            padding="sm"
          >
            <div className="flex flex-wrap gap-2">
              <Input
                type="search"
                className="min-w-[12rem] flex-1"
                placeholder={t('workwear.searchCatalog')}
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
              />
              <select
                className="fc-input w-auto min-w-[10rem]"
                value={catalogSeasonFilter}
                onChange={(e) =>
                  setCatalogSeasonFilter(e.target.value as '' | WorkwearSeason)
                }
              >
                <option value="">{t('workwear.allSeasons')}</option>
                <option value="summer">{workwearSeasonLabel('summer', locale)}</option>
                <option value="winter">{workwearSeasonLabel('winter', locale)}</option>
              </select>
            </div>
          </Card>

          <div className="overflow-x-auto rounded-sm border border-grid bg-white">
            <table className="fc-table w-full text-sm">
              <thead>
                <tr>
                  <th>{t('workwear.col.category')}</th>
                  <th>{t('workwear.col.name')}</th>
                  <th>{t('workwear.col.season')}</th>
                  <th className="text-right">{t('workwear.col.price')}</th>
                  <th className="text-right">{t('workwear.col.stock')}</th>
                  <th>{t('workwear.col.sizes')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredCatalog.map((c) => {
                  const stock = warehouseStockForCatalogItem(warehouse, c)
                  return (
                    <tr key={c.id} className={!c.active ? 'opacity-45' : undefined}>
                      <td className="text-xs text-stone-500">
                        {workwearPpeCategoryLabel(c.ppeCategory, locale)}
                      </td>
                      <td className="font-medium text-ink">{c.name}</td>
                      <td>{workwearSeasonLabel(c.season, locale)}</td>
                      <td className="text-right whitespace-nowrap">
                        {c.unitPrice.toFixed(2)} {c.currency}
                      </td>
                      <td className="text-right">
                        {stock != null ? (
                          <span
                            className={
                              stock.available <= 0
                                ? 'font-medium text-red-600'
                                : 'text-teal-800'
                            }
                          >
                            {formatQty(stock.available)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="max-w-[200px] truncate text-xs text-stone-500">
                        {c.sizes.join(', ')}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        <Button variant="ghost" size="xs" onClick={() => openCatalogEditor(c)}>
                          {t('workwear.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => onArchiveCatalogItem(c.id, c.active)}
                        >
                          {c.active ? t('workwear.archive') : t('workwear.restore')}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AppDialog
        open={editCatalog != null}
        onClose={() => setEditCatalog(null)}
        title={t('workwear.catalogEdit')}
        subtitle={t('workwear.warehouseLinkHint')}
        size="lg"
        footer={catalogDialogFooter}
      >
        {editCatalog && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('workwear.col.category')}>
              <select
                className="fc-input"
                value={editCatalog.ppeCategory}
                onChange={(e) => setCatalogPpeCategory(e.target.value as WorkwearPpeCategory)}
              >
                {WORKWEAR_PPE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {workwearPpeCategoryLabel(cat, locale)}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label={t('workwear.col.season')}>
              <select
                className="fc-input"
                value={editCatalog.season}
                onChange={(e) =>
                  setEditCatalog({
                    ...editCatalog,
                    season: e.target.value as WorkwearSeason,
                  })
                }
              >
                <option value="summer">{workwearSeasonLabel('summer', locale)}</option>
                <option value="winter">{workwearSeasonLabel('winter', locale)}</option>
              </select>
            </FormField>

            <FormField label={t('workwear.col.name')} className="sm:col-span-2">
              <Input
                value={editCatalog.name}
                onChange={(e) => setEditCatalog({ ...editCatalog, name: e.target.value })}
                placeholder={t('workwear.namePlaceholder')}
                autoFocus
              />
            </FormField>

            <FormField label={t('workwear.col.price')}>
              <Input
                type="text"
                inputMode="decimal"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                placeholder="0.00"
              />
            </FormField>

            <FormField label={t('workwear.field.sizeGrid')}>
              <select
                className="fc-input"
                value={editCatalog.sizeGrid}
                onChange={(e) => setCatalogSizeGrid(e.target.value as WorkwearSizeGrid)}
              >
                {WORKWEAR_SIZE_GRIDS.map((g) => (
                  <option key={g} value={g}>
                    {workwearSizeGridLabel(g, locale)}
                  </option>
                ))}
              </select>
            </FormField>

            <div className="sm:col-span-2">
              <FormField
                label={t('workwear.col.sizes')}
                hint={
                  editCatalog.sizeGrid === 'free'
                    ? undefined
                    : t('workwear.sizesHint')
                }
              >
                {editCatalog.sizeGrid === 'free' ? (
                  <Input
                    placeholder="S, M, L, 42, 43"
                    value={editCatalog.sizes.join(', ')}
                    onChange={(e) =>
                      setEditCatalog({
                        ...editCatalog,
                        sizes: e.target.value
                          .split(/[,;]/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {defaultSizesForCatalog(editCatalog.ppeCategory, editCatalog.sizeGrid).map(
                      (s) => {
                        const on = editCatalog.sizes.includes(s)
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleCatalogSize(s)}
                            className={`min-w-[2.25rem] rounded-sm border px-2 py-1 text-sm transition ${
                              on
                                ? 'border-teal-700 bg-teal-50 font-medium text-teal-900'
                                : 'border-grid bg-white text-stone-600 hover:border-stone-300'
                            }`}
                          >
                            {s}
                          </button>
                        )
                      },
                    )}
                  </div>
                )}
              </FormField>
            </div>
          </div>
        )}
      </AppDialog>
    </div>
  )
}

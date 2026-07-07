import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { CloseIcon } from '@/components/ui/icons'
import { exportPrintAreaToPdf } from '@/lib/pdfExport'
import { fitPrintPages, resetPrintFit } from '@/lib/printFit'
import type { Counterparty } from '@/lib/counterparties/types'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { LoadingPickCounterpartyModal } from '@/components/warehouse/LoadingPickCounterpartyModal'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import type { PackagingRecipe } from '@/lib/packaging/types'
import { LoadingPickProductModal } from '@/components/warehouse/LoadingPickProductModal'
import { LoadingQuickProductModal } from '@/components/warehouse/LoadingQuickProductModal'
import { LoadingWeightPromptModal } from '@/components/warehouse/LoadingWeightPromptModal'
import { listLoadingShipments, buildCombinedLoadingShipmentInput, sumLoadingShipments } from '@/lib/warehouse/loadingShipments'
import { buildA2LinePortugalMay2026Documents } from '@/lib/warehouse/loadingPresets'
import { buildA2LineCounterparty, findA2LineCounterparty } from '@/lib/counterparties/presets'
import {
  findFinishedProductForItem,
  resolveLoadingLineProfile,
  resolvePackagingCounts,
  resolveRollMetrics,
  type MissingWeight,
} from '@/lib/warehouse/loadingProfile'
import { filterFinishedProductItems } from '@/lib/warehouse/locationKindFilter'
import {
  counterpartyOptionLabel,
  counterpartyOptionsForLoading,
  counterpartyRoleLabelKey,
} from '@/lib/warehouse/documentValidation'
import {
  LOADING_CONTAINERS,
  computeLoadingBalance,
  computeLoadingLine,
  computeLoadingTotals,
  formatInt,
  formatKg,
  formatTons,
  parseNum,
  type LoadingLine,
} from '@/lib/warehouse/loading'
import { resolveSalesOrderLink, type SalesOrderLinkInfo } from '@/lib/sales/loadingLink'
import type { SalesOrder } from '@/lib/sales/types'
import type { LoadingShipment, LoadingShipmentLine, WarehouseItem, WarehouseStore } from '@/lib/warehouse/types'
import {
  WarehouseLoadingPrintSheet,
  type LoadingPrintMeta,
} from '@/components/warehouse/WarehouseLoadingPrintSheet'

type UiLine = {
  id: string
  productKey: string
  itemId?: string
  finishedProductId?: string
  name: string
  note: string
  rollLengthM: string
  grammageGsm: string
  rollWidthM: string
  rolls: string
  weightPerRollKg: string
  areaPerRollM2: string
  rollsPerBox: string
  topRolls: string
  rollsPerPallet: string
  palletLayers: string
  boxLayers: string
  palletTareKg: string
  boxes: string
  boxTareKg: string
  palletPlaces: string
  packagingRecipeId?: string
  /** Пользователь вручную правил вес рулона */
  weightManual: boolean
  color: string
  labelNote: string
  logoNote: string
  cellSize: string
}

type LoadingState = {
  draftId: string | null
  containerId: string
  payloadT: string
  palletPlaces: string
  counterpartyId: string
  customer: string
  orderNo: string
  date: string
  orderPlacedDate: string
  clientDueDate: string
  plannedProductionDate: string
  actualShipDate: string
  region: string
  logistics: string
  orderNotes: string
  salesOrderId: string
  salesLineId: string
  lines: UiLine[]
}

type ProductOption = {
  key: string
  label: string
  name: string
  itemId?: string
  finishedProductId?: string
}

type Props = {
  warehouse: WarehouseStore
  warehouseId: string
  counterparties: Counterparty[]
  finishedProducts: FinishedProduct[]
  packagingRecipes: PackagingRecipe[]
  keeperId?: string
  keeperName?: string
  onUpsertCounterparty: (c: Counterparty) => void
  onOpenCounterparties?: () => void
  onUpsertItem: (item: WarehouseItem) => void
  onUpsertFinishedProduct: (fp: FinishedProduct) => void
  onUpsertLoadingShipment: (
    input: import('@/lib/warehouse/loadingShipments').UpsertLoadingShipmentInput,
  ) => string
  onPostLoadingShipment: (
    shipmentId: string,
    args?: { keeperId?: string; keeperName?: string },
  ) => import('@/lib/warehouse/loadingShipments').PostLoadingShipmentResult
  onRemoveLoadingShipment: (shipmentId: string) => void
  salesOrders?: SalesOrder[]
  onOpenSalesOrder?: (orderId: string) => void
  pendingOpenShipmentId?: string | null
  onPendingOpenConsumed?: () => void
}

function emptyUiLine(): UiLine {
  return {
    id: crypto.randomUUID(),
    productKey: '',
    name: '',
    note: '',
    rollLengthM: '',
    grammageGsm: '',
    rollWidthM: '',
    rolls: '',
    weightPerRollKg: '',
    areaPerRollM2: '',
    rollsPerBox: '',
    topRolls: '',
    rollsPerPallet: '',
    palletLayers: '',
    boxLayers: '',
    palletTareKg: '',
    boxes: '',
    boxTareKg: '',
    palletPlaces: '',
    weightManual: false,
    color: '',
    labelNote: '',
    logoNote: '',
    cellSize: '',
  }
}

function shipmentLineToUiLine(l: LoadingShipmentLine): UiLine {
  return {
    id: l.id,
    productKey: l.finishedProductId
      ? `fp:${l.finishedProductId}`
      : l.itemId
        ? `wi:${l.itemId}`
        : '',
    itemId: l.itemId,
    finishedProductId: l.finishedProductId,
    name: l.name,
    note: l.note,
    rollLengthM: l.rollLengthM ? String(l.rollLengthM) : '',
    grammageGsm: l.grammageGsm ? String(l.grammageGsm) : '',
    rollWidthM: l.rollWidthM ? String(l.rollWidthM) : '',
    rolls: l.rolls ? String(l.rolls) : '',
    weightPerRollKg: l.weightPerRollKg ? String(l.weightPerRollKg) : '',
    areaPerRollM2: l.areaPerRollM2 ? String(l.areaPerRollM2) : '',
    rollsPerBox: l.rollsPerBox ? String(l.rollsPerBox) : '',
    topRolls: l.topRolls ? String(l.topRolls) : '',
    rollsPerPallet: l.rollsPerPallet ? String(l.rollsPerPallet) : '',
    palletLayers: l.palletLayers ? String(l.palletLayers) : '',
    boxLayers: l.boxLayers ? String(l.boxLayers) : '',
    palletTareKg: l.palletTareKg ? String(l.palletTareKg) : '',
    boxes: l.boxes ? String(l.boxes) : '',
    boxTareKg: l.boxTareKg ? String(l.boxTareKg) : '',
    palletPlaces: l.palletPlaces ? String(l.palletPlaces) : '',
    weightManual: false,
    color: l.color ?? '',
    labelNote: l.labelNote ?? '',
    logoNote: l.logoNote ?? '',
    cellSize: l.cellSize ?? '',
  }
}

function defaultState(): LoadingState {
  const fura = LOADING_CONTAINERS[0]!
  return {
    draftId: null,
    containerId: fura.id,
    payloadT: String(fura.payloadKg / 1000),
    palletPlaces: String(fura.palletPlaces),
    counterpartyId: '',
    customer: '',
    orderNo: '',
    date: new Date().toISOString().slice(0, 10),
    orderPlacedDate: '',
    clientDueDate: '',
    plannedProductionDate: '',
    actualShipDate: '',
    region: '',
    logistics: '',
    orderNotes: '',
    salesOrderId: '',
    salesLineId: '',
    lines: [emptyUiLine()],
  }
}

function toLine(u: UiLine): LoadingLine {
  return {
    id: u.id,
    name: u.name,
    note: u.note,
    rollLengthM: parseNum(u.rollLengthM),
    grammageGsm: parseNum(u.grammageGsm),
    rollWidthM: parseNum(u.rollWidthM),
    rolls: parseNum(u.rolls),
    weightPerRollKg: parseNum(u.weightPerRollKg),
    areaPerRollM2: parseNum(u.areaPerRollM2),
    rollsPerBox: parseNum(u.rollsPerBox),
    topRolls: parseNum(u.topRolls),
    rollsPerPallet: parseNum(u.rollsPerPallet),
    palletLayers: parseNum(u.palletLayers),
    boxLayers: parseNum(u.boxLayers),
    palletTareKg: parseNum(u.palletTareKg),
    boxes: parseNum(u.boxes),
    boxTareKg: parseNum(u.boxTareKg),
    palletPlaces: parseNum(u.palletPlaces),
  }
}

function shipmentToState(s: LoadingShipment): LoadingState {
  return inputToState(
    {
      date: s.date,
      warehouseId: s.warehouseId,
      containerId: s.containerId,
      payloadKg: s.payloadKg,
      palletPlacesLimit: s.palletPlacesLimit,
      counterpartyId: s.counterpartyId,
      counterpartyName: s.counterpartyName,
      orderNo: s.orderNo,
      orderPlacedDate: s.orderPlacedDate,
      clientDueDate: s.clientDueDate,
      plannedProductionDate: s.plannedProductionDate,
      actualShipDate: s.actualShipDate,
      region: s.region,
      logistics: s.logistics,
      orderNotes: s.orderNotes,
      salesOrderId: s.salesOrderId,
      salesLineId: s.salesLineId,
      lines: s.lines,
    },
    s.status === 'draft' ? s.id : null,
  )
}

function inputToState(
  input: import('@/lib/warehouse/loadingShipments').UpsertLoadingShipmentInput,
  draftId: string | null,
): LoadingState {
  return {
    draftId,
    containerId: input.containerId,
    payloadT: String(input.payloadKg / 1000),
    palletPlaces: String(input.palletPlacesLimit),
    counterpartyId: input.counterpartyId ?? '',
    customer: input.counterpartyName,
    orderNo: input.orderNo,
    date: input.date,
    orderPlacedDate: input.orderPlacedDate ?? '',
    clientDueDate: input.clientDueDate ?? '',
    plannedProductionDate: input.plannedProductionDate ?? '',
    actualShipDate: input.actualShipDate ?? '',
    region: input.region ?? '',
    logistics: input.logistics ?? '',
    orderNotes: input.orderNotes ?? '',
    salesOrderId: input.salesOrderId ?? '',
    salesLineId: input.salesLineId ?? '',
    lines: input.lines.length ? input.lines.map(shipmentLineToUiLine) : [emptyUiLine()],
  }
}

function buildProductOptions(
  finishedProducts: FinishedProduct[],
  warehouse: WarehouseStore,
): ProductOption[] {
  const options: ProductOption[] = []
  const seen = new Set<string>()

  for (const fp of finishedProducts.filter((p) => p.active)) {
    options.push({
      key: `fp:${fp.id}`,
      label: `${fp.code} · ${fp.name}`,
      name: fp.name,
      finishedProductId: fp.id,
      itemId: fp.warehouseItemId,
    })
    if (fp.warehouseItemId) seen.add(fp.warehouseItemId)
  }

  for (const item of filterFinishedProductItems(
    warehouse.items,
    warehouse.categories,
    undefined,
    warehouse.locations,
  )) {
    if (seen.has(item.id)) continue
    options.push({
      key: `wi:${item.id}`,
      label: `${item.internalCode} · ${item.name}`,
      name: item.name,
      itemId: item.id,
    })
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, 'ru'))
}

export function WarehouseLoadingTab({
  warehouse,
  warehouseId,
  counterparties,
  finishedProducts,
  packagingRecipes,
  keeperId,
  keeperName,
  onUpsertCounterparty,
  onOpenCounterparties,
  onUpsertItem,
  onUpsertFinishedProduct,
  onUpsertLoadingShipment,
  onPostLoadingShipment,
  onRemoveLoadingShipment,
  salesOrders = [],
  onOpenSalesOrder,
  pendingOpenShipmentId,
  onPendingOpenConsumed,
}: Props) {
  const { t, tf, locale } = useI18n()
  const { confirm } = useConfirm()
  const [view, setView] = useState<'form' | 'journal'>('form')
  const [state, setState] = useState<LoadingState>(() => defaultState())
  const salesOrderLink = useMemo(
    () =>
      state.salesOrderId
        ? resolveSalesOrderLink(
            { salesOrderId: state.salesOrderId, salesLineId: state.salesLineId || undefined },
            salesOrders,
          )
        : null,
    [state.salesOrderId, state.salesLineId, salesOrders],
  )
  const [preview, setPreview] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [weightPrompt, setWeightPrompt] = useState<{
    lineId: string
    missing: MissingWeight[]
    opt: ProductOption
  } | null>(null)
  const [quickProduct, setQuickProduct] = useState<{
    lineId: string
    fp: FinishedProduct
    opt: ProductOption
  } | null>(null)
  const [pickProductLineId, setPickProductLineId] = useState<string | null>(null)
  const [pickCounterpartyOpen, setPickCounterpartyOpen] = useState(false)

  const whId = warehouseId || warehouse.locations[0]?.id || ''
  const loadingCustomers = useMemo(
    () => counterpartyOptionsForLoading(counterparties),
    [counterparties],
  )
  const customerOptions = useMemo(
    () =>
      loadingCustomers.map((c) => ({
        value: c.id,
        label: counterpartyOptionLabel(c, t),
      })),
    [loadingCustomers, t],
  )
  const selectedCounterparty = useMemo(
    () => counterparties.find((c) => c.id === state.counterpartyId),
    [counterparties, state.counterpartyId],
  )
  const productOptions = useMemo(
    () => buildProductOptions(finishedProducts, warehouse),
    [finishedProducts, warehouse],
  )
  const shipments = useMemo(() => listLoadingShipments(warehouse), [warehouse])

  const lines = useMemo(() => state.lines.map(toLine), [state.lines])
  const payloadKg = parseNum(state.payloadT) * 1000
  const palletPlacesLimit = parseNum(state.palletPlaces)
  const totals = useMemo(() => computeLoadingTotals(lines), [lines])
  const balance = useMemo(
    () => computeLoadingBalance(totals, payloadKg, palletPlacesLimit),
    [totals, payloadKg, palletPlacesLimit],
  )

  function patch(p: Partial<LoadingState>) {
    setState((s) => ({ ...s, ...p }))
  }

  function patchLine(id: string, p: Partial<UiLine>) {
    setState((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.id === id ? { ...l, ...p } : l)),
    }))
  }

  function resolveFp(opt: ProductOption): FinishedProduct | undefined {
    if (opt.finishedProductId) {
      return finishedProducts.find((p) => p.id === opt.finishedProductId)
    }
    return findFinishedProductForItem(finishedProducts, opt.itemId)
  }

  function profileOptsFromLine(line: UiLine, opt: ProductOption, packagingRecipeId?: string) {
    const fp = resolveFp(opt)
    return {
      finishedProduct: fp,
      warehouseItemId: opt.itemId,
      packagingRecipes,
      packagingRecipeId: packagingRecipeId ?? line.packagingRecipeId,
      locale: (locale === 'ka' ? 'ka' : 'ru') as 'ru' | 'ka',
      rollLengthM: parseNum(line.rollLengthM) || undefined,
      grammageGsm: parseNum(line.grammageGsm) || undefined,
      rollWidthM: parseNum(line.rollWidthM) || undefined,
      manualWeightKg: line.weightManual ? parseNum(line.weightPerRollKg) : undefined,
      rollsPerBox: parseNum(line.rollsPerBox) || undefined,
      topRolls: parseNum(line.topRolls) || undefined,
    }
  }

  function packagingPatch(line: UiLine, rolls: number, recipeId?: string): Partial<UiLine> {
    const recipe = packagingRecipes.find((r) => r.id === (recipeId ?? line.packagingRecipeId))
    const counts = resolvePackagingCounts(
      rolls,
      recipe,
      {
        rollsPerBox: parseNum(line.rollsPerBox) || undefined,
        topRolls: parseNum(line.topRolls) || undefined,
        palletLayers: parseNum(line.palletLayers) || undefined,
        boxLayers: parseNum(line.boxLayers) || undefined,
      },
      locale === 'ka' ? 'ka' : 'ru',
    )
    return {
      rollsPerBox: counts.rollsPerBox > 0 ? String(counts.rollsPerBox) : line.rollsPerBox,
      topRolls: counts.topRolls > 0 ? String(counts.topRolls) : line.topRolls,
      rollsPerPallet: counts.rollsPerPallet > 0 ? String(counts.rollsPerPallet) : '',
      palletLayers: counts.palletLayers > 0 ? String(counts.palletLayers) : '',
      boxLayers: counts.boxLayers > 0 ? String(counts.boxLayers) : '',
      note: counts.stackNote || line.note,
      boxes: counts.boxes > 0 ? String(counts.boxes) : '',
      palletPlaces: counts.palletPlaces > 0 ? String(counts.palletPlaces) : '',
    }
  }

  function applyProfileToLine(lineId: string, opt: ProductOption, packagingRecipeId?: string) {
    const line = state.lines.find((l) => l.id === lineId)
    const profile = resolveLoadingLineProfile(
      warehouse,
      profileOptsFromLine(line ?? emptyUiLine(), opt, packagingRecipeId),
    )
    const rolls = parseNum(line?.rolls ?? '')
    const pack = packagingPatch(line ?? emptyUiLine(), rolls, profile.packagingRecipeId)

    patchLine(lineId, {
      productKey: opt.key,
      itemId: opt.itemId ?? profile.productItemId,
      finishedProductId: opt.finishedProductId ?? profile.finishedProductId,
      name: opt.name,
      rollLengthM: profile.rollLengthM > 0 ? String(profile.rollLengthM) : '',
      grammageGsm: profile.grammageGsm > 0 ? String(profile.grammageGsm) : '',
      rollWidthM: profile.rollWidthM > 0 ? String(profile.rollWidthM) : '',
      weightPerRollKg: profile.weightPerRollKg > 0 ? String(profile.weightPerRollKg) : '',
      areaPerRollM2: profile.areaPerRollM2 > 0 ? String(profile.areaPerRollM2) : '',
      palletTareKg: profile.palletTareKg > 0 ? String(profile.palletTareKg) : '',
      boxTareKg: profile.boxTareKg > 0 ? String(profile.boxTareKg) : '',
      packagingRecipeId: profile.packagingRecipeId,
      weightManual: profile.weightSource === 'manual',
      ...pack,
    })
    return profile
  }

  function onRollParamsChange(lineId: string, patch: Partial<UiLine>) {
    setState((s) => {
      const prev = s.lines.find((l) => l.id === lineId)
      if (!prev) return s
      const merged = { ...prev, ...patch }
      const opt = productOptions.find((o) => o.key === merged.productKey) ?? optFromKey(merged.productKey)
      const weightFromNom =
        opt?.itemId != null
          ? warehouse.items.find((i) => i.id === opt.itemId)?.weightKg ?? 0
          : 0
      const metrics = resolveRollMetrics({
        rollLengthM: parseNum(merged.rollLengthM),
        rollWidthM: parseNum(merged.rollWidthM),
        grammageGsm: parseNum(merged.grammageGsm),
        weightFromNomenclatureKg: weightFromNom,
        manualWeightKg: merged.weightManual ? parseNum(merged.weightPerRollKg) : undefined,
      })
      const rolls = parseNum(merged.rolls)
      const pack = packagingPatch(merged, rolls)
      let nextWeight = merged.weightPerRollKg
      let nextArea = merged.areaPerRollM2
      let weightManual = merged.weightManual
      if (!weightManual && patch.weightPerRollKg === undefined) {
        nextWeight = metrics.weightPerRollKg > 0 ? String(metrics.weightPerRollKg) : ''
        nextArea = metrics.areaPerRollM2 > 0 ? String(metrics.areaPerRollM2) : ''
      } else if (patch.weightPerRollKg !== undefined) {
        weightManual = true
        if (parseNum(merged.weightPerRollKg) > 0 && parseNum(merged.grammageGsm) > 0) {
          const area =
            (parseNum(merged.weightPerRollKg) * 1000) / parseNum(merged.grammageGsm)
          nextArea = area > 0 ? String(Math.round(area * 100) / 100) : merged.areaPerRollM2
        }
      }
      return {
        ...s,
        lines: s.lines.map((l) =>
          l.id === lineId
            ? {
                ...merged,
                ...pack,
                weightPerRollKg: nextWeight,
                areaPerRollM2: nextArea,
                weightManual,
              }
            : l,
        ),
      }
    })
  }

  function optFromKey(key: string): ProductOption | undefined {
    if (key.startsWith('fp:')) {
      const fp = finishedProducts.find((p) => p.id === key.slice(3))
      if (!fp) return undefined
      return {
        key,
        label: `${fp.code} · ${fp.name}`,
        name: fp.name,
        finishedProductId: fp.id,
        itemId: fp.warehouseItemId,
      }
    }
    if (key.startsWith('wi:')) {
      const itemId = key.slice(3)
      const item = warehouse.items.find((i) => i.id === itemId)
      return {
        key,
        label: item ? `${item.internalCode} · ${item.name}` : itemId,
        name: item?.name ?? '',
        itemId,
      }
    }
    return undefined
  }

  function pickProduct(lineId: string, key: string, synthetic?: ProductOption) {
    const opt = synthetic ?? productOptions.find((o) => o.key === key) ?? (key ? optFromKey(key) : undefined)
    if (!opt) {
      patchLine(lineId, { productKey: '', itemId: undefined, finishedProductId: undefined })
      return
    }
    const fp = resolveFp(opt)
    if (fp && !fp.warehouseItemId) {
      patchLine(lineId, {
        productKey: key,
        finishedProductId: fp.id,
        name: fp.name,
      })
      setQuickProduct({ lineId, fp, opt })
      return
    }
    const profile = applyProfileToLine(lineId, opt)
    const needWeight = profile.missingWeights.filter((m) => m.itemId)
    if (needWeight.length > 0) {
      setWeightPrompt({ lineId, missing: needWeight, opt })
    }
  }

  function onRollsChange(lineId: string, raw: string) {
    onRollParamsChange(lineId, { rolls: raw })
  }

  function afterWeightsSaved(lineId: string, opt: ProductOption) {
    const line = state.lines.find((l) => l.id === lineId)
    applyProfileToLine(lineId, opt, line?.packagingRecipeId)
    setWeightPrompt(null)
  }

  function pickPackagingRecipe(lineId: string, recipeId: string) {
    const line = state.lines.find((l) => l.id === lineId)
    if (!line?.productKey) {
      setError(t('warehouse.loading.errPickProductFirst'))
      return
    }
    const opt = productOptions.find((o) => o.key === line.productKey)
    if (!opt) return

    if (!recipeId) {
      patchLine(lineId, { packagingRecipeId: undefined, note: '' })
      return
    }

    const fp = resolveFp(opt)
    if (fp && fp.defaultPackagingRecipeId !== recipeId) {
      onUpsertFinishedProduct({
        ...fp,
        defaultPackagingRecipeId: recipeId,
        updatedAt: new Date().toISOString(),
      })
    }

    const profile = applyProfileToLine(lineId, opt, recipeId)

    const needWeight = profile.missingWeights.filter((m) => m.itemId)
    if (needWeight.length > 0) {
      setWeightPrompt({ lineId, missing: needWeight, opt })
    }
  }

  useEffect(() => {
    if (!state.counterpartyId) return
    const cp = counterparties.find((c) => c.id === state.counterpartyId)
    if (!cp) return
    setState((s) => (s.customer === cp.name ? s : { ...s, customer: cp.name }))
  }, [counterparties, state.counterpartyId])

  function pickCounterparty(id: string) {
    const cp = loadingCustomers.find((c) => c.id === id) ?? counterparties.find((c) => c.id === id)
    patch({
      counterpartyId: id,
      customer: cp?.name ?? '',
    })
  }

  function buildInput() {
    return {
      id: state.draftId ?? undefined,
      date: state.date,
      warehouseId: whId,
      containerId: state.containerId,
      payloadKg,
      palletPlacesLimit,
      counterpartyId: state.counterpartyId || undefined,
      counterpartyName: state.customer,
      orderNo: state.orderNo,
      orderPlacedDate: state.orderPlacedDate || undefined,
      clientDueDate: state.clientDueDate || undefined,
      plannedProductionDate: state.plannedProductionDate || undefined,
      actualShipDate: state.actualShipDate || undefined,
      region: state.region || undefined,
      logistics: state.logistics || undefined,
      orderNotes: state.orderNotes || undefined,
      salesOrderId: state.salesOrderId || undefined,
      salesLineId: state.salesLineId || undefined,
      keeperId,
      keeperName,
      lines: state.lines.map((u) => {
        const l = toLine(u)
        return {
          id: u.id,
          itemId: u.itemId,
          finishedProductId: u.finishedProductId,
          name: l.name,
          note: l.note,
          rollLengthM: l.rollLengthM,
          grammageGsm: l.grammageGsm,
          rollWidthM: l.rollWidthM,
          rolls: l.rolls,
          weightPerRollKg: l.weightPerRollKg,
          areaPerRollM2: l.areaPerRollM2,
          rollsPerBox: l.rollsPerBox,
          topRolls: l.topRolls,
          rollsPerPallet: l.rollsPerPallet,
          palletLayers: l.palletLayers,
          boxLayers: l.boxLayers,
          palletTareKg: l.palletTareKg,
          boxes: l.boxes,
          boxTareKg: l.boxTareKg,
          palletPlaces: l.palletPlaces,
          color: u.color.trim() || undefined,
          labelNote: u.labelNote.trim() || undefined,
          logoNote: u.logoNote.trim() || undefined,
          cellSize: u.cellSize.trim() || undefined,
        }
      }),
    }
  }

  function createFromPreset(_presetId: 'a2line-portugal-2026-05') {
    setError(null)
    let cp = findA2LineCounterparty(counterparties)
    if (!cp) {
      cp = buildA2LineCounterparty(counterparties)
      onUpsertCounterparty(cp)
    }

    const docs = buildA2LinePortugalMay2026Documents(whId).map((input) => ({
      ...input,
      counterpartyId: cp!.id,
      counterpartyName: cp!.name,
    }))

    let firstId = ''
    for (const input of docs) {
      const id = onUpsertLoadingShipment(input)
      if (!firstId) firstId = id
    }

    const first = docs[0]
    if (first) {
      setState(inputToState({ ...first, counterpartyId: cp.id, counterpartyName: cp.name }, firstId))
    }
    setReadOnly(false)
    setView('journal')
    setNotice(tf('warehouse.loading.presetCreatedMany', { count: String(docs.length) }))
  }

  function saveDraft() {
    setError(null)
    const id = onUpsertLoadingShipment(buildInput())
    setState((s) => ({ ...s, draftId: id }))
    setNotice(t('warehouse.loading.savedDraft'))
  }

  async function postShipment() {
    setError(null)
    const id = onUpsertLoadingShipment(buildInput())
    setState((s) => ({ ...s, draftId: id }))
    const res = onPostLoadingShipment(id, { keeperId, keeperName })
    if (!res.ok) {
      setError(t(res.error ?? 'warehouse.loading.errGeneric'))
      return
    }
    setNotice(tf('warehouse.loading.postedOk', { number: res.number }))
    setState(defaultState())
    setReadOnly(false)
    setView('journal')
  }

  async function clearAll() {
    if (!(await confirm({ message: t('warehouse.loading.clearConfirm'), danger: true }))) return
    if (state.draftId) onRemoveLoadingShipment(state.draftId)
    setState(defaultState())
    setReadOnly(false)
  }

  function openDraft(s: LoadingShipment) {
    setState(shipmentToState(s))
    setReadOnly(s.status === 'posted')
    setView('form')
  }

  useEffect(() => {
    if (!pendingOpenShipmentId) return
    const shipments = listLoadingShipments(warehouse)
    const shipment = shipments.find((s) => s.id === pendingOpenShipmentId)
    if (shipment) openDraft(shipment)
    onPendingOpenConsumed?.()
  }, [pendingOpenShipmentId])

  function newForm() {
    setState(defaultState())
    setReadOnly(false)
    setView('form')
  }

  function combineSelected(selected: LoadingShipment[]) {
    setError(null)
    const input = buildCombinedLoadingShipmentInput(selected, { warehouseId: whId, keeperId, keeperName })
    if (!input) {
      setError(t('warehouse.loading.combineNeedTwo'))
      return
    }
    const id = onUpsertLoadingShipment(input)
    setState(inputToState(input, id))
    setReadOnly(false)
    setView('form')
    setNotice(tf('warehouse.loading.combinedOk', { count: String(input.lines.length) }))
  }

  function openCombinedPreview(selected: LoadingShipment[]) {
    setError(null)
    const input = buildCombinedLoadingShipmentInput(selected, { warehouseId: whId, keeperId, keeperName })
    if (!input) {
      setError(t('warehouse.loading.combineNeedTwo'))
      return
    }
    setState(inputToState(input, null))
    setReadOnly(false)
    setView('form')
    setNotice(t('warehouse.loading.combinePreviewNotice'))
  }

  function changeContainer(id: string) {
    const preset = LOADING_CONTAINERS.find((c) => c.id === id)
    if (!preset || preset.id === 'custom') {
      patch({ containerId: id })
      return
    }
    patch({
      containerId: id,
      payloadT: String(preset.payloadKg / 1000),
      palletPlaces: String(preset.palletPlaces),
    })
  }

  const containerName = t(
    LOADING_CONTAINERS.find((c) => c.id === state.containerId)?.nameKey ??
      'warehouse.loading.container.custom',
  )

  const printMeta: LoadingPrintMeta = {
    customer: state.customer,
    orderNo: state.orderNo,
    date: state.date,
    containerName,
  }

  const balanceLabel = (left: number, unit: string) => {
    if (left > 0) return `${t('warehouse.loading.left')} ${formatInt(left)} ${unit}`
    if (left < 0) return `${t('warehouse.loading.over')} ${formatInt(-left)} ${unit}`
    return t('warehouse.loading.exact')
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t('warehouse.loading.heading')}</h2>
          <p className="mt-0.5 text-sm text-stone-500">{t('warehouse.loading.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              view === 'form' ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
            }`}
            onClick={() => setView('form')}
          >
            {t('warehouse.loading.tabForm')}
          </button>
          <button
            type="button"
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
              view === 'journal' ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
            }`}
            onClick={() => setView('journal')}
          >
            {t('warehouse.loading.tabJournal')} ({shipments.length})
          </button>
        </div>
      </div>

      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <FormNotice type="error" message={error} onDismiss={() => setError(null)} />}
      {salesOrderLink && view === 'form' && (
        <SalesOrderLinkBanner
          link={salesOrderLink}
          onOpen={onOpenSalesOrder}
        />
      )}

      {view === 'journal' ? (
        <LoadingJournal
          shipments={shipments}
          salesOrders={salesOrders}
          onOpenSalesOrder={onOpenSalesOrder}
          onOpen={openDraft}
          onNew={newForm}
          onCombine={combineSelected}
          onCombinePreview={openCombinedPreview}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!readOnly && (
              <>
                <Button variant="secondary" size="sm" onClick={() => createFromPreset('a2line-portugal-2026-05')}>
                  {t('warehouse.loading.presetA2line')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void clearAll()}>
                  {t('warehouse.loading.clear')}
                </Button>
                <Button variant="secondary" size="sm" onClick={saveDraft}>
                  {t('warehouse.loading.saveDraft')}
                </Button>
                <Button variant="primary" size="sm" onClick={() => void postShipment()}>
                  {t('warehouse.loading.post')}
                </Button>
              </>
            )}
            <Button variant="primary" size="sm" onClick={() => setPreview(true)}>
              {t('warehouse.loading.print')}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.loading.transport')}
              <select
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={state.containerId}
                disabled={readOnly}
                onChange={(e) => changeContainer(e.target.value)}
              >
                {LOADING_CONTAINERS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.nameKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.loading.payload')}
              <input
                inputMode="decimal"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"
                value={state.payloadT}
                disabled={readOnly}
                onChange={(e) => patch({ payloadT: e.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.loading.places')}
              <input
                inputMode="numeric"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm tabular-nums"
                value={state.palletPlaces}
                disabled={readOnly}
                onChange={(e) => patch({ palletPlaces: e.target.value })}
              />
            </label>
            <DirectoryFieldPicker
              label={t('warehouse.loading.customer')}
              hint={t('warehouse.loading.customerHint')}
              value={state.counterpartyId}
              placeholder={t('warehouse.loading.pickCustomer')}
              disabled={readOnly}
              options={customerOptions}
              onChange={pickCounterparty}
              onAdd={() => setPickCounterpartyOpen(true)}
            >
              {selectedCounterparty && (
                <span className="mt-1 block text-[10px] text-teal-700">
                  {t(counterpartyRoleLabelKey(selectedCounterparty.role))}
                </span>
              )}
              {!readOnly && loadingCustomers.length === 0 && (
                <button
                  type="button"
                  className="mt-1 text-[10px] font-semibold text-teal-800 underline"
                  onClick={() => setPickCounterpartyOpen(true)}
                >
                  {t('warehouse.loading.addCustomer')}
                </button>
              )}
            </DirectoryFieldPicker>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.loading.orderNo')}
              <input
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={state.orderNo}
                disabled={readOnly}
                onChange={(e) => patch({ orderNo: e.target.value })}
              />
            </label>
            <label className="block text-xs font-semibold text-stone-500">
              {t('warehouse.loading.date')}
              <input
                type="date"
                className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
                value={state.date}
                disabled={readOnly}
                onChange={(e) => patch({ date: e.target.value })}
              />
            </label>
          </div>

          <details className="rounded-sm border border-grid bg-stone-50/80 px-4 py-3">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-stone-600">
              {t('warehouse.loading.orderMeta')}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.orderPlacedDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.orderPlacedDate}
                  disabled={readOnly}
                  onChange={(e) => patch({ orderPlacedDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.clientDueDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.clientDueDate}
                  disabled={readOnly}
                  onChange={(e) => patch({ clientDueDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.plannedProductionDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.plannedProductionDate}
                  disabled={readOnly}
                  onChange={(e) => patch({ plannedProductionDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.actualShipDate')}
                <input
                  type="date"
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.actualShipDate}
                  disabled={readOnly}
                  onChange={(e) => patch({ actualShipDate: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.region')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.region}
                  disabled={readOnly}
                  onChange={(e) => patch({ region: e.target.value })}
                />
              </label>
              <label className="block text-xs font-semibold text-stone-500">
                {t('warehouse.loading.logistics')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.logistics}
                  disabled={readOnly}
                  onChange={(e) => patch({ logistics: e.target.value })}
                />
              </label>
              <label className="col-span-full block text-xs font-semibold text-stone-500 sm:col-span-2 lg:col-span-4">
                {t('warehouse.loading.orderNotes')}
                <input
                  className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                  value={state.orderNotes}
                  disabled={readOnly}
                  onChange={(e) => patch({ orderNotes: e.target.value })}
                />
              </label>
            </div>
          </details>

          <div className="overflow-x-auto rounded-sm border border-grid bg-white">
            {productOptions.length === 0 && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {t('warehouse.loading.noProductsHint')}{' '}
                <button
                  type="button"
                  className="font-semibold text-teal-800 underline"
                  onClick={() => setPickProductLineId(state.lines[0]?.id ?? '')}
                >
                  {t('warehouse.loading.addProduct')}
                </button>
              </div>
            )}
            <table className="min-w-[1400px] w-full text-sm">
              <thead>
                <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                  <th className="w-8 px-2 py-2">#</th>
                  <th className="px-2 py-2 text-left">{t('warehouse.loading.col.name')}</th>
                  <th className="px-2 py-2 text-left">{t('warehouse.loading.col.note')}</th>
                  <th className="px-2 py-2 text-left">{t('warehouse.loading.col.color')}</th>
                  <th className="px-2 py-2 text-left">{t('warehouse.loading.col.label')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rollLength')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.grammage')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rollWidth')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rolls')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rollWeight')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.area')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rollsPerBox')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.topRolls')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.rollsPerPallet')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.palletTare')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.boxes')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.boxTare')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.palletPlaces')}</th>
                  <th className="px-2 py-2 text-right">{t('warehouse.loading.col.gross')}</th>
                  <th className="w-8 px-1 py-2" />
                </tr>
              </thead>
              <tbody>
                {state.lines.map((u, idx) => {
                  const r = computeLoadingLine(toLine(u))
                  return (
                    <tr key={u.id} className="border-t border-grid/60">
                      <td className="px-2 py-1.5 text-center text-stone-400 tabular-nums">{idx + 1}</td>
                      <td className="px-1 py-1">
                        <div className="flex items-start gap-1">
                          <select
                            className="min-w-0 flex-1 rounded border border-grid px-2 py-1.5 text-sm"
                            value={u.productKey}
                            disabled={readOnly}
                            onChange={(e) => pickProduct(u.id, e.target.value)}
                          >
                            <option value="">{t('warehouse.loading.pickProduct')}</option>
                            {productOptions.map((o) => (
                              <option key={o.key} value={o.key}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {!readOnly && (
                            <button
                              type="button"
                              title={t('warehouse.loading.addProduct')}
                              className="shrink-0 rounded border border-teal-700 px-2 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-50"
                              onClick={() => setPickProductLineId(u.id)}
                            >
                              +
                            </button>
                          )}
                        </div>
                        {u.packagingRecipeId && (
                          <span className="mt-1 block text-[10px] leading-tight text-teal-700">
                            {packagingRecipes.find((r) => r.id === u.packagingRecipeId)?.name}
                          </span>
                        )}
                        {u.name && !u.productKey && (
                          <span className="mt-1 block truncate text-xs text-stone-500">{u.name}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <select
                          className="mb-1 w-40 max-w-full rounded border border-grid px-2 py-1.5 text-sm"
                          value={u.packagingRecipeId ?? ''}
                          disabled={readOnly || !u.productKey}
                          onChange={(e) => pickPackagingRecipe(u.id, e.target.value)}
                        >
                          <option value="">{t('warehouse.loading.pickPackaging')}</option>
                          {packagingRecipes
                            .filter((r) => r.active)
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.code} · {r.name}
                              </option>
                            ))}
                        </select>
                        <input
                          className="w-40 rounded border border-grid px-2 py-1 text-xs text-stone-600"
                          placeholder={t('warehouse.loading.col.note')}
                          value={u.note}
                          disabled={readOnly}
                          onChange={(e) => patchLine(u.id, { note: e.target.value })}
                        />
                        {!readOnly && packagingRecipes.filter((r) => r.active).length === 0 && (
                          <p className="mt-1 text-[10px] text-amber-700">
                            {t('warehouse.loading.noPackagingHint')}
                          </p>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <input
                          className="w-20 rounded border border-grid px-2 py-1 text-xs"
                          value={u.color}
                          disabled={readOnly}
                          onChange={(e) => patchLine(u.id, { color: e.target.value })}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          className="min-w-[140px] w-48 rounded border border-grid px-2 py-1 text-xs"
                          value={u.labelNote}
                          disabled={readOnly}
                          onChange={(e) => patchLine(u.id, { labelNote: e.target.value })}
                        />
                      </td>
                      {(
                        [
                          ['rollLengthM', u.rollLengthM, 'product'],
                          ['grammageGsm', u.grammageGsm, 'product'],
                          ['rollWidthM', u.rollWidthM, 'product'],
                          ['rolls', u.rolls, 'qty'],
                          ['weightPerRollKg', u.weightPerRollKg, 'weight'],
                          ['areaPerRollM2', u.areaPerRollM2, 'calc'],
                          ['rollsPerBox', u.rollsPerBox, 'pack'],
                          ['topRolls', u.topRolls, 'pack'],
                          ['rollsPerPallet', u.rollsPerPallet, 'calc'],
                          ['palletTareKg', u.palletTareKg, 'tare'],
                          ['boxes', u.boxes, 'calc'],
                          ['boxTareKg', u.boxTareKg, 'tare'],
                          ['palletPlaces', u.palletPlaces, 'calc'],
                        ] as [keyof UiLine, string, string][]
                      ).map(([field, value, kind]) => (
                        <td key={field} className="px-1 py-1">
                          <input
                            inputMode="decimal"
                            title={
                              kind === 'weight'
                                ? t('warehouse.loading.weightHint')
                                : kind === 'tare'
                                  ? t('warehouse.loading.fromPackaging')
                                  : kind === 'calc'
                                    ? t('warehouse.loading.autoCalc')
                                    : undefined
                            }
                            readOnly={readOnly || kind === 'calc'}
                            className={`w-[4.5rem] rounded border border-grid px-1.5 py-1.5 text-right text-sm tabular-nums ${
                              kind === 'calc' ? 'bg-stone-50 text-stone-500' : ''
                            } ${
                              (kind === 'weight' || kind === 'tare' || kind === 'pack') && value
                                ? 'bg-teal-50/60'
                                : ''
                            }`}
                            value={value}
                            disabled={readOnly}
                            onChange={(e) => {
                              const raw = e.target.value
                              if (field === 'rolls') {
                                onRollsChange(u.id, raw)
                                return
                              }
                              const paramFields: (keyof UiLine)[] = [
                                'rollLengthM',
                                'grammageGsm',
                                'rollWidthM',
                                'weightPerRollKg',
                                'rollsPerBox',
                                'topRolls',
                              ]
                              if (paramFields.includes(field)) {
                                onRollParamsChange(u.id, { [field]: raw })
                              } else {
                                patchLine(u.id, { [field]: raw })
                              }
                            }}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right tabular-nums text-stone-600">
                        {formatTons(r.grossKg)}
                      </td>
                      <td className="px-1 py-1.5 text-center">
                        {!readOnly && (
                          <button
                            type="button"
                            className="text-stone-400 hover:text-red-600"
                            onClick={() =>
                              setState((s) => {
                                const next = s.lines.filter((l) => l.id !== u.id)
                                return { ...s, lines: next.length ? next : [emptyUiLine()] }
                              })
                            }
                          >
                            <CloseIcon size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!readOnly && (
            <button
              type="button"
              className="rounded-sm border border-dashed border-grid px-3 py-2 text-sm text-stone-600 hover:bg-stone-50"
              onClick={() => setState((s) => ({ ...s, lines: [...s.lines, emptyUiLine()] }))}
            >
              + {t('warehouse.loading.addLine')}
            </button>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-sm border border-grid bg-white p-4">
              <dl className="space-y-1.5 text-sm">
                <SummaryRow label={t('warehouse.loading.sum.rolls')} value={formatInt(totals.rolls)} />
                <SummaryRow
                  label={t('warehouse.loading.sum.linearMeters')}
                  value={`${formatInt(totals.linearMeters)} ${t('warehouse.loading.unitMp')}`}
                />
                <SummaryRow label={t('warehouse.loading.sum.area')} value={`${formatInt(totals.areaM2)} м²`} />
                <SummaryRow label={t('warehouse.loading.sum.boxes')} value={formatInt(totals.boxes)} />
                <SummaryRow label={t('warehouse.loading.sum.pallets')} value={formatInt(totals.pallets)} />
                <SummaryRow
                  label={t('warehouse.loading.sum.places')}
                  value={`${formatInt(totals.palletPlaces)} / ${formatInt(palletPlacesLimit)}`}
                  danger={balance.placesOver}
                />
              </dl>
            </div>
            <div className="rounded-sm border border-grid bg-white p-4">
              <dl className="space-y-1.5 text-sm">
                <SummaryRow
                  label={t('warehouse.loading.sum.net')}
                  value={`${formatKg(totals.netKg)} кг / ${formatTons(totals.netKg)} т`}
                />
                <SummaryRow
                  label={t('warehouse.loading.sum.gross')}
                  value={`${formatKg(totals.grossKg)} кг / ${formatTons(totals.grossKg)} т`}
                />
                <SummaryRow
                  label={t('warehouse.loading.sum.weightBalance')}
                  value={balanceLabel(balance.weightLeftKg, 'кг')}
                  danger={balance.weightOver}
                />
                <SummaryRow
                  label={t('warehouse.loading.sum.placesBalance')}
                  value={balanceLabel(balance.placesLeft, t('warehouse.loading.places').toLowerCase())}
                  danger={balance.placesOver}
                />
                <SummaryRow
                  label={t('warehouse.loading.sum.load')}
                  value={`${balance.weightLoadPct.toFixed(1).replace('.', ',')}%`}
                  danger={balance.weightOver}
                />
              </dl>
            </div>
          </div>
        </>
      )}

      {pickCounterpartyOpen && (
        <LoadingPickCounterpartyModal
          counterparties={counterparties}
          purposeFilter="loading"
          onPick={pickCounterparty}
          onUpsertCounterparty={onUpsertCounterparty}
          onOpenDirectory={onOpenCounterparties}
          onClose={() => setPickCounterpartyOpen(false)}
        />
      )}

      {pickProductLineId && (
        <LoadingPickProductModal
          options={productOptions}
          finishedProducts={finishedProducts}
          warehouse={warehouse}
          onPick={(key, synthetic) => pickProduct(pickProductLineId, key, synthetic)}
          onUpsertFinishedProduct={onUpsertFinishedProduct}
          onUpsertItem={onUpsertItem}
          onClose={() => setPickProductLineId(null)}
        />
      )}

      {weightPrompt && (
        <LoadingWeightPromptModal
          missing={weightPrompt.missing}
          items={warehouse.items}
          onSaveItem={onUpsertItem}
          onClose={() => setWeightPrompt(null)}
          onSaved={() => afterWeightsSaved(weightPrompt.lineId, weightPrompt.opt)}
        />
      )}

      {quickProduct && (
        <LoadingQuickProductModal
          finishedProduct={quickProduct.fp}
          warehouse={warehouse}
          onSaveItem={onUpsertItem}
          onLinkProduct={onUpsertFinishedProduct}
          onClose={() => setQuickProduct(null)}
          onCreated={(itemId) => {
            const opt: ProductOption = {
              ...quickProduct.opt,
              itemId,
              key: `wi:${itemId}`,
            }
            setQuickProduct(null)
            pickProduct(quickProduct.lineId, opt.key)
          }}
        />
      )}

      {preview && (
        <LoadingPrintPreview
          meta={printMeta}
          payloadKg={payloadKg}
          palletPlaces={palletPlacesLimit}
          lines={lines}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  )
}

function SalesOrderLinkBanner({
  link,
  onOpen,
}: {
  link: SalesOrderLinkInfo
  onOpen?: (orderId: string) => void
}) {
  const { t, tf } = useI18n()
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
      <span className="text-xs font-semibold uppercase text-sky-700">
        {t('warehouse.loading.fromSalesOrder')}
      </span>
      <SalesOrderLinkCell link={link} onOpen={onOpen} />
      {link.lineName && (
        <span className="text-xs text-sky-800">
          {tf('warehouse.loading.salesLine', { name: link.lineName })}
        </span>
      )}
    </div>
  )
}

function SalesOrderLinkCell({
  link,
  onOpen,
}: {
  link: SalesOrderLinkInfo | null
  onOpen?: (orderId: string) => void
}) {
  const { t } = useI18n()
  if (!link) return <span className="text-stone-400">—</span>
  if (onOpen) {
    return (
      <button
        type="button"
        className="font-mono text-xs font-bold text-teal-800 underline hover:text-teal-950"
        title={t('warehouse.loading.openSalesOrder')}
        onClick={(e) => {
          e.stopPropagation()
          onOpen(link.orderId)
        }}
      >
        {link.orderNumber}
      </button>
    )
  }
  return <span className="font-mono text-xs font-bold text-teal-800">{link.orderNumber}</span>
}

function LoadingJournal({
  shipments,
  salesOrders,
  onOpenSalesOrder,
  onOpen,
  onNew,
  onCombine,
  onCombinePreview,
}: {
  shipments: LoadingShipment[]
  salesOrders: SalesOrder[]
  onOpenSalesOrder?: (orderId: string) => void
  onOpen: (s: LoadingShipment) => void
  onNew: () => void
  onCombine: (selected: LoadingShipment[]) => void
  onCombinePreview: (selected: LoadingShipment[]) => void
}) {
  const { t, tf } = useI18n()
  const [filter, setFilter] = useState<'all' | 'draft' | 'posted'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  const filtered = useMemo(() => {
    if (filter === 'draft') return shipments.filter((s) => s.status === 'draft')
    if (filter === 'posted') return shipments.filter((s) => s.status === 'posted')
    return shipments
  }, [filter, shipments])

  const selectable = useMemo(
    () => filtered.filter((s) => s.status === 'draft'),
    [filtered],
  )

  const selected = useMemo(
    () => shipments.filter((s) => selectedIds.has(s.id)),
    [shipments, selectedIds],
  )

  const selectionTotals = useMemo(() => sumLoadingShipments(selected), [selected])

  const allSelectableChecked =
    selectable.length > 0 && selectable.every((s) => selectedIds.has(s.id))

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allSelectableChecked) {
      setSelectedIds(new Set())
      return
    }
    setSelectedIds(new Set(selectable.map((s) => s.id)))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(['all', 'draft', 'posted'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`rounded-sm px-3 py-1.5 text-xs font-semibold ${
                filter === f ? 'bg-accent text-white' : 'bg-stone-100 text-stone-600'
              }`}
              onClick={() => {
                setFilter(f)
                setSelectedIds(new Set())
              }}
            >
              {t(
                f === 'all'
                  ? 'warehouse.loading.archiveFilterAll'
                  : f === 'draft'
                    ? 'warehouse.loading.archiveFilterDraft'
                    : 'warehouse.loading.archiveFilterPosted',
              )}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={onNew}>
          {t('warehouse.loading.newForm')}
        </Button>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-teal-200 bg-teal-50/80 px-4 py-3">
          <div className="text-sm text-teal-950">
            <span className="font-semibold">
              {tf('warehouse.loading.selectionCount', { count: String(selected.length) })}
            </span>
            <span className="ml-3 tabular-nums text-teal-800">
              {formatInt(selectionTotals.rolls)} {t('warehouse.loading.col.rolls').toLowerCase()} ·{' '}
              {formatTons(selectionTotals.grossKg)} · {formatInt(selectionTotals.palletPlaces)}{' '}
              {t('warehouse.loading.places').toLowerCase()}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelectedIds(new Set())}>
              {t('warehouse.loading.clearSelection')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={selected.length < 2}
              onClick={() => onCombinePreview(selected)}
            >
              {t('warehouse.loading.combinePreview')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={selected.length < 2}
              onClick={() => onCombine(selected)}
            >
              {t('warehouse.loading.combineSelected')}
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-stone-500">{t('warehouse.loading.journalEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-grid bg-white">
          <table className="min-w-[1000px] w-full text-sm">
            <thead>
              <tr className="bg-stone-50 text-xs uppercase text-stone-500">
                <th className="w-10 px-2 py-2">
                  <input
                    type="checkbox"
                    className="rounded border-grid"
                    checked={allSelectableChecked}
                    disabled={selectable.length === 0}
                    title={t('warehouse.loading.archiveSelectAll')}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.date')}</th>
                <th className="px-3 py-2 text-left">№</th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.customer')}</th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.col.salesOrder')}</th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.region')}</th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.clientDueDate')}</th>
                <th className="px-3 py-2 text-left">{t('warehouse.loading.logistics')}</th>
                <th className="px-3 py-2 text-right">{t('warehouse.loading.sum.rolls')}</th>
                <th className="px-3 py-2 text-right">{t('warehouse.loading.sum.gross')}</th>
                <th className="px-3 py-2 text-right">{t('warehouse.loading.sum.places')}</th>
                <th className="px-3 py-2 text-center">{t('warehouse.loading.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const canSelect = s.status === 'draft'
                const checked = selectedIds.has(s.id)
                const orderLink = resolveSalesOrderLink(s, salesOrders)
                return (
                  <tr
                    key={s.id}
                    className={`border-t border-grid/60 hover:bg-stone-50 ${checked ? 'bg-teal-50/40' : ''}`}
                  >
                    <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-grid"
                        checked={checked}
                        disabled={!canSelect}
                        onChange={() => canSelect && toggleOne(s.id)}
                      />
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-stone-600"
                      onClick={() => onOpen(s)}
                    >
                      {s.date}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 font-mono text-xs font-bold"
                      onClick={() => onOpen(s)}
                    >
                      {s.number}
                    </td>
                    <td className="cursor-pointer px-3 py-2.5" onClick={() => onOpen(s)}>
                      <span className="font-medium">{s.counterpartyName || '—'}</span>
                      {s.orderNo && !orderLink && (
                        <span className="ml-1 text-xs font-semibold text-stone-600">· {s.orderNo}</span>
                      )}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5"
                      onClick={() => orderLink && onOpenSalesOrder?.(orderLink.orderId)}
                    >
                      <SalesOrderLinkCell link={orderLink} onOpen={onOpenSalesOrder} />
                      {orderLink?.lineName && (
                        <div className="truncate text-[10px] text-stone-500">{orderLink.lineName}</div>
                      )}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-stone-600"
                      onClick={() => onOpen(s)}
                    >
                      {s.region || '—'}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-stone-600"
                      onClick={() => onOpen(s)}
                    >
                      {s.clientDueDate || '—'}
                    </td>
                    <td
                      className="max-w-[160px] cursor-pointer truncate px-3 py-2.5 text-xs text-stone-500"
                      title={s.logistics}
                      onClick={() => onOpen(s)}
                    >
                      {s.logistics || '—'}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-right tabular-nums"
                      onClick={() => onOpen(s)}
                    >
                      {formatInt(s.totalsRolls)}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-right tabular-nums"
                      onClick={() => onOpen(s)}
                    >
                      {formatTons(s.totalsGrossKg)}
                    </td>
                    <td
                      className="cursor-pointer px-3 py-2.5 text-right tabular-nums"
                      onClick={() => onOpen(s)}
                    >
                      {formatInt(s.totalsPalletPlaces)}
                    </td>
                    <td className="cursor-pointer px-3 py-2.5 text-center" onClick={() => onOpen(s)}>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          s.status === 'posted'
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {t(
                          s.status === 'posted'
                            ? 'warehouse.loading.statusPosted'
                            : 'warehouse.loading.statusDraft',
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SummaryRow({
  label,
  value,
  danger,
}: {
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className={`font-semibold tabular-nums ${danger ? 'text-red-600' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  )
}

function LoadingPrintPreview({
  meta,
  payloadKg,
  palletPlaces,
  lines,
  onClose,
}: {
  meta: LoadingPrintMeta
  payloadKg: number
  palletPlaces: number
  lines: LoadingLine[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const printRef = useRef<HTMLDivElement>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('print-preview-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('print-preview-open')
      resetPrintFit(printRef.current)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      fitPrintPages(printRef.current, { shrinkOnly: true, portrait: true })
    })
    return () => cancelAnimationFrame(id)
  }, [lines, meta, payloadKg, palletPlaces])

  function handlePrint() {
    fitPrintPages(printRef.current, { shrinkOnly: true, portrait: true })
    requestAnimationFrame(() => window.print())
  }

  async function handlePdf() {
    if (!printRef.current) return
    setPdfBusy(true)
    try {
      fitPrintPages(printRef.current, { shrinkOnly: true, portrait: true })
      await exportPrintAreaToPdf(printRef.current, `pogruzka_${meta.date || 'gp'}.pdf`, {
        orientation: 'portrait',
      })
    } finally {
      setPdfBusy(false)
    }
  }

  return createPortal(
    <div className="print-modal-root fixed inset-0 z-[100] flex flex-col bg-stone-900/60">
      <div className="print-modal-toolbar no-print flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-700 bg-stone-900 px-4 py-3 text-white">
        <h2 className="text-lg font-bold">{t('print.preview')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
            disabled={pdfBusy}
            onClick={() => void handlePdf()}
          >
            {t('print.exportPdf')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-white px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100"
            onClick={handlePrint}
          >
            {t('print.printBtn')}
          </button>
          <button
            type="button"
            className="rounded-sm border border-stone-500 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            onClick={onClose}
          >
            {t('print.close')}
          </button>
        </div>
      </div>
      <div className="print-modal-body">
        <div ref={printRef} id="print-area" className="print-area">
          <WarehouseLoadingPrintSheet
            meta={meta}
            payloadKg={payloadKg}
            palletPlaces={palletPlaces}
            lines={lines}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { CloseIcon } from '@/components/ui/icons'
import { DirectoryFieldPicker } from '@/components/ui/DirectoryFieldPicker'
import { LoadingPickCounterpartyModal } from '@/components/warehouse/LoadingPickCounterpartyModal'
import { NomenclaturePicker } from '@/components/warehouse/NomenclaturePicker'
import { WarehousePickModal, type PickApplyRow } from '@/components/warehouse/WarehousePickModal'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import {
  buildIssuePrintModel,
  buildReceiptPrintModel,
  type IssuePrintModel,
  type ReceiptPrintModel,
  type WarehousePrintMeta,
} from '@/lib/warehouse/printDocument'
import { WarehouseInvoiceLoader } from '@/components/warehouse/WarehouseInvoiceLoader'
import { WarehouseIssuePrintPreview } from '@/components/warehouse/WarehouseIssuePrintPreview'
import { WarehouseReceiptPrintPreview } from '@/components/warehouse/WarehouseReceiptPrintPreview'
import { isInvoiceAlreadyPosted } from '@/lib/warehouse/documents'
import {
  counterpartyOptionLabel,
  counterpartyOptionsForPurpose,
  counterpartyRoleLabelKey,
  matchCounterpartyId,
  type CounterpartyPickFilter,
  validateWarehouseDocumentInput,
} from '@/lib/warehouse/documentValidation'
import { nextDocumentNumber } from '@/lib/warehouse/docNumbering'
import { filterItemsForDocumentPicker } from '@/lib/warehouse/locationKindFilter'
import { isWarehousePeriodClosed } from '@/lib/warehouse/periodClose'
import { WRITEOFF_REASONS } from '@/lib/warehouse/writeoffReasons'
import {
  computeAllBalances,
  formatIssueShortages,
  formatQty,
  itemStockValue,
  toBaseQty,
  validateIssueLines,
} from '@/lib/warehouse/stock'
import { unitLabel } from '@/lib/warehouse/units'
import type { Counterparty } from '@/lib/counterparties/types'
import type { ProductionRequest } from '@/lib/production/types'
import type {
  ItemBalance,
  WarehouseDocument,
  WarehouseDocumentPurpose,
  WriteoffReasonId,
  WarehouseStore,
} from '@/lib/warehouse/types'
import type { PostDocumentResult, SaveDraftInput } from '@/lib/warehouse/documents'

const RECEIPT_PURPOSES: WarehouseDocumentPurpose[] = ['purchase', 'return', 'other']
const ISSUE_PURPOSES: WarehouseDocumentPurpose[] = [
  'production_issue',
  'writeoff',
  'return',
  'transfer',
  'other',
]

function defaultPurpose(type: 'receipt' | 'issue'): WarehouseDocumentPurpose {
  return type === 'receipt' ? 'purchase' : 'production_issue'
}

function purposesForType(type: 'receipt' | 'issue'): WarehouseDocumentPurpose[] {
  return type === 'receipt' ? RECEIPT_PURPOSES : ISSUE_PURPOSES
}

export type DocLineRow = {
  key: string
  itemId: string | null
  quantity: string
  /** Единица ввода (если отличается от базовой единицы позиции) */
  unit?: string
  /** Цена за единицу — только для прихода */
  unitPrice?: string
  /** Номер партии — только для прихода */
  batchNo?: string
  /** Срок годности (YYYY-MM-DD) — только для прихода */
  expiryDate?: string
}

type Props = {
  warehouse: WarehouseStore
  categoryNames: Map<string, string>
  balances: Map<string, ItemBalance>
  brigades: string[]
  warehouseId: string
  variant?: 'page' | 'modal'
  printMeta?: WarehousePrintMeta
  initialType?: 'receipt' | 'issue'
  initialPickSearch?: string
  initialPickOpen?: boolean
  onPost: (doc: Omit<WarehouseDocument, 'id' | 'createdAt'>) => PostDocumentResult
  /** Сохранить черновик (без движений). Если не задан — кнопки черновика нет. */
  onSaveDraft?: (doc: SaveDraftInput) => PostDocumentResult
  onPostTransfer?: (
    doc: Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'docRole' | 'transferPairId'> & {
      targetWarehouseId: string
    },
  ) => PostDocumentResult
  onMergeInvoiceRegistry: (registry: import('@/lib/warehouse/types').GeorgianInvoice[]) => void
  onCancel?: () => void
  allowNegativeStock?: boolean
  counterparties?: Counterparty[]
  onUpsertCounterparty?: (c: Counterparty) => void
  onOpenCounterparties?: () => void
  productionRequests?: ProductionRequest[]
  keeperId?: string
  keeperName?: string
  /** Редактирование / просмотр существующего документа (не inventory). */
  existingDocument?: WarehouseDocument | null
  readOnly?: boolean
}

export type WarehouseDocumentEditorHandle = {
  isDirty: () => boolean
  saveDraft: () => boolean
}

function newLine(): DocLineRow {
  return { key: crypto.randomUUID(), itemId: null, quantity: '' }
}

function linesFromDocument(doc: WarehouseDocument): DocLineRow[] {
  if (!doc.lines.length) return [newLine()]
  return doc.lines.map((l) => ({
    key: crypto.randomUUID(),
    itemId: l.itemId,
    quantity: String(l.quantity),
    unit: l.inputUnit,
    unitPrice: l.unitPrice != null ? String(l.unitPrice) : undefined,
    batchNo: l.batchNo,
    expiryDate: l.expiryDate,
  }))
}

function stateFromDocument(doc: WarehouseDocument) {
  return {
    type: (doc.type === 'issue' ? 'issue' : 'receipt') as 'receipt' | 'issue',
    docWarehouseId: doc.warehouseId,
    targetWarehouseId: doc.targetWarehouseId ?? '',
    purpose: doc.purpose ?? defaultPurpose(doc.type === 'issue' ? 'issue' : 'receipt'),
    date: doc.date,
    number: doc.number,
    numberTouched: true,
    counterpartyId: doc.counterpartyId ?? '',
    contractId: doc.contractId ?? '',
    counterparty: doc.counterparty ?? '',
    brigade: doc.brigade ?? '',
    productionRequestId: doc.productionRequestId ?? '',
    writeoffReason: (doc.writeoffReason ?? '') as WriteoffReasonId | '',
    comment: doc.comment ?? '',
    invoiceKey: doc.invoiceKey,
    sellerTin: doc.sellerTin,
    lines: linesFromDocument(doc),
  }
}

export const WarehouseDocumentEditor = forwardRef<WarehouseDocumentEditorHandle, Props>(
  function WarehouseDocumentEditor(
{
  warehouse,
  categoryNames,
  balances,
  brigades,
  warehouseId,
  variant = 'page',
  printMeta,
  initialType = 'receipt',
  initialPickSearch,
  initialPickOpen = false,
  onPost,
  onSaveDraft,
  onPostTransfer,
  onMergeInvoiceRegistry,
  onCancel,
  allowNegativeStock = false,
  counterparties = [],
  onUpsertCounterparty,
  onOpenCounterparties,
  productionRequests = [],
  keeperId,
  keeperName,
  existingDocument = null,
  readOnly = false,
}: Props,
ref,
) {
  const { t, locale } = useI18n()
  const { confirm } = useConfirm()
  const defaultWhId = warehouseId || warehouse.locations[0]?.id || ''
  const seeded = existingDocument ? stateFromDocument(existingDocument) : null

  const [type, setType] = useState<'receipt' | 'issue'>(seeded?.type ?? initialType)
  const [docWarehouseId, setDocWarehouseId] = useState(seeded?.docWarehouseId ?? defaultWhId)
  const [targetWarehouseId, setTargetWarehouseId] = useState(seeded?.targetWarehouseId ?? '')
  const [purpose, setPurpose] = useState<WarehouseDocumentPurpose>(
    () => seeded?.purpose ?? defaultPurpose(initialType),
  )
  const [date, setDate] = useState(seeded?.date ?? (() => new Date().toISOString().slice(0, 10)))
  const [number, setNumber] = useState(seeded?.number ?? '')
  const [numberTouched, setNumberTouched] = useState(seeded?.numberTouched ?? false)
  const [counterpartyId, setCounterpartyId] = useState(seeded?.counterpartyId ?? '')
  const [contractId, setContractId] = useState(seeded?.contractId ?? '')
  const [counterparty, setCounterparty] = useState(seeded?.counterparty ?? '')
  const [brigade, setBrigade] = useState(seeded?.brigade ?? '')
  const [productionRequestId, setProductionRequestId] = useState(seeded?.productionRequestId ?? '')
  const [writeoffReason, setWriteoffReason] = useState<WriteoffReasonId | ''>(seeded?.writeoffReason ?? '')
  const [comment, setComment] = useState(seeded?.comment ?? '')
  const [invoiceKey, setInvoiceKey] = useState<string | undefined>(seeded?.invoiceKey)
  const [sellerTin, setSellerTin] = useState<string | undefined>(seeded?.sellerTin)
  const [lines, setLines] = useState<DocLineRow[]>(() => seeded?.lines ?? [newLine()])
  const [pickOpen, setPickOpen] = useState(initialPickOpen)
  const [formError, setFormError] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const [receiptPrintPreview, setReceiptPrintPreview] = useState<ReceiptPrintModel | null>(null)
  const [issuePrintPreview, setIssuePrintPreview] = useState<IssuePrintModel | null>(null)
  const [pickCounterpartyOpen, setPickCounterpartyOpen] = useState(false)

  const qtyRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const activeItems = useMemo(() => warehouse.items.filter((i) => i.active), [warehouse.items])
  const supplierOptions = useMemo(
    () => counterpartyOptionsForPurpose(counterparties, 'purchase'),
    [counterparties],
  )
  const returnCounterpartyOptions = useMemo(
    () => counterpartyOptionsForPurpose(counterparties, 'return'),
    [counterparties],
  )
  const counterpartyOptions = useMemo(() => {
    if (purpose === 'purchase') return supplierOptions
    if (purpose === 'return') return returnCounterpartyOptions
    return []
  }, [purpose, supplierOptions, returnCounterpartyOptions])
  const counterpartyPickerFilter: CounterpartyPickFilter | null =
    purpose === 'purchase' ? 'purchase' : purpose === 'return' ? 'return' : null
  const counterpartyFieldOptions = useMemo(
    () =>
      counterpartyOptions.map((c) => ({
        value: c.id,
        label: counterpartyOptionLabel(c, t),
      })),
    [counterpartyOptions, t],
  )
  const openProductionRequests = useMemo(
    () => productionRequests.filter((r) => r.status === 'draft' || r.status === 'saved'),
    [productionRequests],
  )
  const docBalances = useMemo(
    () => computeAllBalances(warehouse, docWarehouseId || undefined),
    [warehouse, docWarehouseId],
  )
  const sortedLocations = useMemo(
    () => [...warehouse.locations].sort((a, b) => a.sortOrder - b.sortOrder),
    [warehouse.locations],
  )
  const docLocation = useMemo(
    () => sortedLocations.find((l) => l.id === docWarehouseId),
    [sortedLocations, docWarehouseId],
  )
  const pickerItems = useMemo(
    () => filterItemsForDocumentPicker(activeItems, warehouse.categories, docWarehouseId, docLocation),
    [activeItems, warehouse.categories, docWarehouseId, docLocation],
  )
  const selectedCounterparty = useMemo(
    () => counterparties.find((c) => c.id === counterpartyId),
    [counterparties, counterpartyId],
  )
  const contractOptions = selectedCounterparty?.contracts ?? []
  const periodClosed = isWarehousePeriodClosed(warehouse.closedMonths, date)

  useEffect(() => {
    setDocWarehouseId(defaultWhId)
  }, [defaultWhId])

  useEffect(() => {
    if (initialPickOpen) setPickOpen(true)
  }, [initialPickOpen])

  useEffect(() => {
    if (numberTouched) return
    setNumber(nextDocumentNumber(warehouse.documents, type, date))
  }, [type, date, warehouse.documents, numberTouched])

  function updateLine(key: string, patch: Partial<DocLineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickItem(rowKey: string, itemId: string | null) {
    if (!itemId) {
      updateLine(rowKey, { itemId: null })
      return
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === itemId && l.key !== rowKey)
      if (existing) {
        return prev
          .filter((l) => l.key !== rowKey)
          .map((l) =>
            l.key === existing.key
              ? {
                  ...l,
                  quantity: l.quantity || '1',
                }
              : l,
          )
      }
      return prev.map((l) => (l.key === rowKey ? { ...l, itemId, unit: undefined } : l))
    })
  }

  function mergePickedRows(rows: PickApplyRow[]) {
    setLines((prev) => {
      let next = prev.filter((l) => l.itemId)
      for (const row of rows) {
        const idx = next.findIndex((l) => l.itemId === row.itemId)
        if (idx >= 0) {
          const cur = Number(next[idx]!.quantity.replace(',', '.')) || 0
          next = next.map((l, i) =>
            i === idx ? { ...l, quantity: String(cur + row.quantity) } : l,
          )
        } else {
          next = [
            ...next,
            { key: crypto.randomUUID(), itemId: row.itemId, quantity: String(row.quantity) },
          ]
        }
      }
      return next.length ? next : [newLine()]
    })
  }

  function addLine(focus = true) {
    const row = newLine()
    setLines((prev) => [...prev, row])
    if (focus) {
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(`[data-line="${row.key}"] input`)
        el?.focus()
      })
    }
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length <= 1 ? [newLine()] : prev.filter((l) => l.key !== key)))
  }

  function focusQty(key: string) {
    qtyRefs.current.get(key)?.focus()
    qtyRefs.current.get(key)?.select()
  }

  function resetForm() {
    setCounterpartyId('')
    setContractId('')
    setCounterparty('')
    setBrigade('')
    setProductionRequestId('')
    setWriteoffReason('')
    setTargetWarehouseId('')
    setComment('')
    setInvoiceKey(undefined)
    setSellerTin(undefined)
    setLines([newLine()])
    setNumberTouched(false)
    setNumber(nextDocumentNumber(warehouse.documents, type, date))
  }

  function handlePurposeChange(next: WarehouseDocumentPurpose) {
    setPurpose(next)
    setCounterpartyId('')
    setContractId('')
    setCounterparty('')
    setWriteoffReason('')
  }

  function handleTypeChange(nextType: 'receipt' | 'issue') {
    setType(nextType)
    if (!purposesForType(nextType).includes(purpose)) {
      handlePurposeChange(defaultPurpose(nextType))
    }
  }

  function handleCounterpartyPick(id: string) {
    setCounterpartyId(id)
    setContractId('')
    const cp = counterpartyOptions.find((c) => c.id === id)
    setCounterparty(cp?.name ?? '')
  }

  function handleProductionRequestPick(id: string) {
    setProductionRequestId(id)
    if (!id) return
    const req = openProductionRequests.find((r) => r.id === id)
    if (!req) return
    if (req.brigadeName) setBrigade(req.brigadeName)
    if (purpose === 'production_issue' && req.rawMaterialItemId) {
      const qty = req.rawRollQty && req.rawRollQty > 0 ? req.rawRollQty : 1
      setLines([
        { key: crypto.randomUUID(), itemId: req.rawMaterialItemId, quantity: String(qty) },
      ])
    }
  }

  function buildDocBase(): Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'lines'> {
    const contract = contractOptions.find((c) => c.id === contractId)
    return {
      number: number.trim(),
      date,
      warehouseId: docWarehouseId,
      purpose,
      counterparty: counterparty.trim() || undefined,
      counterpartyId: counterpartyId || undefined,
      contractId: contractId || undefined,
      contractNumber: contract?.number,
      brigade: purpose === 'production_issue' && brigade ? brigade : undefined,
      productionRequestId: productionRequestId || undefined,
      writeoffReason: purpose === 'writeoff' && writeoffReason ? writeoffReason : undefined,
      keeperId,
      keeperName,
      comment: comment.trim() || undefined,
      invoiceKey: type === 'receipt' && purpose === 'purchase' ? invoiceKey : undefined,
      sellerTin: type === 'receipt' && purpose === 'purchase' ? sellerTin : undefined,
      targetWarehouseId: purpose === 'transfer' ? targetWarehouseId || undefined : undefined,
    }
  }

  function showPostError(result: PostDocumentResult) {
    if (result.ok) return false
    setFormError(t(result.error))
    return true
  }

  function handleInvoiceLoad(result: import('@/components/warehouse/WarehouseInvoiceLoader').InvoiceLoadResult) {
    setNumber(result.number)
    setNumberTouched(true)
    setDate(result.date)
    setPurpose('purchase')
    const matchedId = matchCounterpartyId(counterparties, result.counterparty, result.sellerTin)
    setCounterpartyId(matchedId ?? '')
    setCounterparty(
      matchedId
        ? (counterparties.find((c) => c.id === matchedId)?.name ?? result.counterparty)
        : result.counterparty,
    )
    setInvoiceKey(result.invoiceKey)
    setSellerTin(result.sellerTin)
    setLines(
      result.lines.length
        ? result.lines.map((l) => ({
            key: crypto.randomUUID(),
            itemId: l.itemId,
            quantity: String(l.quantity),
          }))
        : [newLine()],
    )
    if (result.unmatched.length) {
      setComment((c) => {
        const note = `${t('warehouse.invoice.unmatchedNote')}: ${result.unmatched.join('; ')}`
        return c ? `${c}\n${note}` : note
      })
    }
  }

  async function postDocument() {
    if (readOnly) return
    const itemUnitMap = new Map(activeItems.map((i) => [i.id, i.unit]))
    const parsed = lines
      .map((l) => {
        const baseUnit = l.itemId ? itemUnitMap.get(l.itemId) : undefined
        const inputUnit = l.unit && l.unit !== baseUnit ? l.unit : undefined
        return {
          itemId: l.itemId!,
          quantity: Number(l.quantity.replace(',', '.')),
          inputUnit,
          ...(type === 'receipt'
            ? {
                unitPrice: l.unitPrice ? Number(l.unitPrice.replace(',', '.')) || undefined : undefined,
                batchNo: l.batchNo?.trim() || undefined,
                expiryDate: l.expiryDate || undefined,
              }
            : {}),
        }
      })
      .filter((l) => l.itemId && l.quantity > 0)

    const draft =
      purpose === 'transfer'
        ? { ...buildDocBase(), type: 'issue' as const, lines: parsed }
        : { ...buildDocBase(), type, lines: parsed }

    const validation = validateWarehouseDocumentInput(warehouse, draft)
    if (!validation.ok) {
      const firstKey = Object.values(validation.errors)[0] ?? 'warehouse.doc.errGeneric'
      setFormError(t(firstKey))
      return
    }

    if (purpose === 'transfer') {
      if (!targetWarehouseId) {
        setFormError(t('warehouse.doc.errTargetWarehouse'))
        return
      }
      if (targetWarehouseId === docWarehouseId) {
        setFormError(t('warehouse.doc.errSameWarehouse'))
        return
      }
      if (!onPostTransfer) {
        setFormError(t('warehouse.doc.errTransferUnsupported'))
        return
      }
      const itemMap = new Map(activeItems.map((i) => [i.id, i]))
      const baseLines = parsed.map((l) => {
        const item = itemMap.get(l.itemId)
        return {
          itemId: l.itemId,
          quantity: item ? toBaseQty(item, l.quantity, l.inputUnit) : l.quantity,
        }
      })
      const validationStock = validateIssueLines(activeItems, docBalances, baseLines)
      if (!validationStock.ok) {
        const detail = formatIssueShortages(validationStock.shortages)
        if (!allowNegativeStock) {
          setFormError(`${t('warehouse.issue.overdraftBlocked')}\n\n${detail}`)
          return
        }
        if (!(await confirm({ message: `${t('warehouse.issue.overdraftConfirm')}\n\n${detail}`, danger: true }))) return
      }
      setFormError(null)
      const result = onPostTransfer({ ...buildDocBase(), lines: parsed, targetWarehouseId })
      if (showPostError(result)) return
      resetForm()
      return
    }

    if (type === 'receipt' && isInvoiceAlreadyPosted(warehouse, invoiceKey)) {
      setFormError(t('warehouse.invoice.alreadyPosted'))
      return
    }

    if (purpose === 'purchase' && !counterpartyId && !counterparty.trim()) {
      setFormError(t('warehouse.doc.errCounterpartyPick'))
      return
    }

    if (purpose === 'return' && !counterpartyId && !counterparty.trim()) {
      setFormError(t('warehouse.doc.errReturnCounterparty'))
      return
    }

    if (type === 'issue') {
      const itemMap = new Map(activeItems.map((i) => [i.id, i]))
      const baseLines = parsed.map((l) => {
        const item = itemMap.get(l.itemId)
        return {
          itemId: l.itemId,
          quantity: item ? toBaseQty(item, l.quantity, l.inputUnit) : l.quantity,
        }
      })
      const validation = validateIssueLines(activeItems, docBalances, baseLines)
      if (!validation.ok) {
        const detail = formatIssueShortages(validation.shortages)
        if (!allowNegativeStock) {
          setFormError(`${t('warehouse.issue.overdraftBlocked')}\n\n${detail}`)
          return
        }
        if (!(await confirm({ message: `${t('warehouse.issue.overdraftConfirm')}\n\n${detail}`, danger: true }))) return
      }
    }

    setFormError(null)
    const result = onPost({
      type,
      ...buildDocBase(),
      lines: parsed,
    })
    if (showPostError(result)) return
    resetForm()
  }

  function saveDraft() {
    if (!onSaveDraft || readOnly) return false
    const itemUnitMap = new Map(activeItems.map((i) => [i.id, i.unit]))
    const parsed = lines
      .filter((l) => l.itemId)
      .map((l) => {
        const baseUnit = l.itemId ? itemUnitMap.get(l.itemId) : undefined
        const inputUnit = l.unit && l.unit !== baseUnit ? l.unit : undefined
        return {
          itemId: l.itemId!,
          quantity: Number(l.quantity.replace(',', '.')) || 0,
          inputUnit,
          ...(type === 'receipt'
            ? {
                unitPrice: l.unitPrice ? Number(l.unitPrice.replace(',', '.')) || undefined : undefined,
                batchNo: l.batchNo?.trim() || undefined,
                expiryDate: l.expiryDate || undefined,
              }
            : {}),
        }
      })
    const result = onSaveDraft({
      id: existingDocument?.id,
      type,
      ...buildDocBase(),
      lines: parsed,
    })
    if (showPostError(result)) return false
    setFormError(null)
    if (!existingDocument) resetForm()
    return true
  }

  const dirtyBaseline = useMemo(() => {
    if (!seeded) return null
    return JSON.stringify({
      type: seeded.type,
      docWarehouseId: seeded.docWarehouseId,
      targetWarehouseId: seeded.targetWarehouseId,
      purpose: seeded.purpose,
      date: seeded.date,
      number: seeded.number,
      counterpartyId: seeded.counterpartyId,
      contractId: seeded.contractId,
      counterparty: seeded.counterparty,
      brigade: seeded.brigade,
      productionRequestId: seeded.productionRequestId,
      writeoffReason: seeded.writeoffReason,
      comment: seeded.comment,
      invoiceKey: seeded.invoiceKey,
      sellerTin: seeded.sellerTin,
      lines: seeded.lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
      })),
    })
  }, [existingDocument?.id])

  const isDirty = useCallback(() => {
    if (readOnly) return false
    if (dirtyBaseline) {
      const current = JSON.stringify({
        type,
        docWarehouseId,
        targetWarehouseId,
        purpose,
        date,
        number,
        counterpartyId,
        contractId,
        counterparty,
        brigade,
        productionRequestId,
        writeoffReason,
        comment,
        invoiceKey,
        sellerTin,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          batchNo: l.batchNo,
          expiryDate: l.expiryDate,
        })),
      })
      return current !== dirtyBaseline
    }
    if (numberTouched) return true
    if (comment.trim() || brigade.trim() || counterparty.trim()) return true
    if (counterpartyId || contractId || productionRequestId || invoiceKey) return true
    if (writeoffReason || targetWarehouseId) return true
    if (type !== initialType) return true
    if (purpose !== defaultPurpose(initialType)) return true
    if (lines.some((l) => l.itemId && l.quantity.trim())) return true
    return false
  }, [
    brigade,
    comment,
    contractId,
    counterparty,
    counterpartyId,
    date,
    dirtyBaseline,
    docWarehouseId,
    initialType,
    invoiceKey,
    lines,
    number,
    numberTouched,
    productionRequestId,
    purpose,
    readOnly,
    sellerTin,
    targetWarehouseId,
    type,
    writeoffReason,
  ])

  useImperativeHandle(
    ref,
    () => ({
      isDirty,
      saveDraft,
    }),
    [isDirty, saveDraft],
  )

  function printDraft() {
    if (!printMeta) return
    const parsed = lines
      .map((l) => ({
        itemId: l.itemId!,
        quantity: Number(l.quantity.replace(',', '.')),
      }))
      .filter((l) => l.itemId && l.quantity > 0)

    if (!number.trim()) {
      setPrintError(t('warehouse.print.errNoNumber'))
      return
    }
    if (!parsed.length) {
      setPrintError(t('warehouse.print.errNoLines'))
      return
    }
    setPrintError(null)
    const base = { ...buildDocBase(), lines: parsed }
    if (type === 'receipt') {
      setReceiptPrintPreview(
        buildReceiptPrintModel(warehouse, base, printMeta, {
          productionRequests,
          counterparties,
        }),
      )
      return
    }
    setIssuePrintPreview(
      buildIssuePrintModel(warehouse, base, printMeta, { productionRequests, counterparties }),
    )
  }

  let totalSum = 0
  for (const line of lines) {
    if (!line.itemId) continue
    const item = activeItems.find((i) => i.id === line.itemId)
    const q = Number(line.quantity.replace(',', '.'))
    if (item && q > 0) {
      const linePrice =
        type === 'receipt' && line.unitPrice
          ? Number(line.unitPrice.replace(',', '.')) || 0
          : undefined
      totalSum +=
        linePrice != null ? q * linePrice : itemStockValue(item, toBaseQty(item, q, line.unit))
    }
  }

  const shell = variant === 'modal' ? 'space-y-4' : 'rounded-sm border border-grid bg-white shadow-sm'

  return (
    <div className={shell}>
      <div className={`${variant === 'page' ? 'border-b border-grid px-4 py-3' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-sm border border-grid p-0.5">
            {(['receipt', 'issue'] as const).map((id) => (
              <button
                key={id}
                type="button"
                disabled={readOnly}
                className={`rounded-sm px-4 py-1.5 text-sm font-semibold ${
                  type === id
                    ? id === 'receipt'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-red-600 text-white'
                    : 'text-stone-600 hover:bg-stone-50'
                }`}
                onClick={() => handleTypeChange(id)}
              >
                {id === 'receipt' ? t('warehouse.receipt') : t('warehouse.issue')}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={readOnly}
            className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
            onClick={() => setPickOpen(true)}
          >
            {t('warehouse.pick.button')}
          </button>
          <span className="text-xs text-stone-400">{t('warehouse.picker.hint')}</span>
        </div>
      </div>

      {type === 'receipt' && purpose === 'purchase' && !readOnly && (
        <div className={variant === 'page' ? 'border-b border-grid px-4 py-3' : 'pb-2'}>
          <WarehouseInvoiceLoader
            warehouse={warehouse}
            items={pickerItems}
            onLoad={handleInvoiceLoad}
            onRegistryUpdate={onMergeInvoiceRegistry}
          />
        </div>
      )}

      {formError && (
        <div className={variant === 'page' ? 'px-4' : ''}>
          <FormNotice type="error" message={formError} onDismiss={() => setFormError(null)} />
        </div>
      )}

      {readOnly && (
        <div className={variant === 'page' ? 'px-4' : ''}>
          <FormNotice type="info" message={t('warehouse.doc.readOnlyPosted')} />
        </div>
      )}

      <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 m-0">

      {printError && (
        <div className={variant === 'page' ? 'px-4' : ''}>
          <FormNotice type="error" message={printError} onDismiss={() => setPrintError(null)} />
        </div>
      )}

      <div className={`grid gap-3 ${variant === 'page' ? 'border-b border-grid px-4 py-3 sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-2'}`}>
        <label className="block text-xs font-semibold text-stone-500">
          {t('warehouse.doc.number')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 font-mono text-sm font-medium"
            value={number}
            readOnly={!numberTouched}
            onChange={(e) => {
              setNumberTouched(true)
              setNumber(e.target.value)
            }}
          />
          <span className="mt-1 block text-[10px] text-stone-400">{t('warehouse.doc.numberAuto')}</span>
        </label>
        <label className="block text-xs font-semibold text-stone-500">
          {t('warehouse.date')}
          <input
            type="date"
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {periodClosed ? (
            <span className="mt-1 block text-[10px] font-medium text-red-600">
              {t('warehouse.doc.periodClosedHint')}
            </span>
          ) : null}
        </label>
        <label className="block text-xs font-semibold text-stone-500">
          {t('warehouse.location')} *
          <select
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={docWarehouseId}
            onChange={(e) => setDocWarehouseId(e.target.value)}
          >
            {sortedLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.kind ? ` · ${t(`warehouse.locationKind.${l.kind}`)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-stone-500">
          {t('warehouse.doc.purpose')}
          <select
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={purpose}
            onChange={(e) => handlePurposeChange(e.target.value as WarehouseDocumentPurpose)}
          >
            {purposesForType(type).map((p) => (
              <option key={p} value={p}>
                {t(`warehouse.doc.purpose.${p}`)}
              </option>
            ))}
          </select>
        </label>

        {(purpose === 'purchase' || purpose === 'return') && (
          <DirectoryFieldPicker
            label={`${t('warehouse.doc.counterparty')} *`}
            hint={t('warehouse.doc.counterpartyHint')}
            value={counterpartyId}
            placeholder={t('warehouse.doc.pickCounterparty')}
            options={counterpartyFieldOptions}
            onChange={handleCounterpartyPick}
            onAdd={() => {
              if (onUpsertCounterparty) setPickCounterpartyOpen(true)
              else onOpenCounterparties?.()
            }}
          >
            {selectedCounterparty && (
              <span className="mt-1 block text-[10px] text-teal-700">
                {t(counterpartyRoleLabelKey(selectedCounterparty.role))}
              </span>
            )}
            {counterparty && !counterpartyId && (
              <span className="mt-1 block text-[10px] text-amber-700">
                {counterparty} ({t('warehouse.doc.counterpartyFromInvoice')})
              </span>
            )}
            {counterpartyFieldOptions.length === 0 && (
              <button
                type="button"
                className="mt-1 text-[10px] font-semibold text-teal-800 underline"
                onClick={() =>
                  onUpsertCounterparty ? setPickCounterpartyOpen(true) : onOpenCounterparties?.()
                }
              >
                {t('warehouse.doc.addCounterparty')}
              </button>
            )}
          </DirectoryFieldPicker>
        )}

        {purpose === 'purchase' && contractOptions.length > 0 ? (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.contract')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
            >
              <option value="">{t('warehouse.doc.pickContract')}</option>
              {contractOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}
                  {c.subject ? ` · ${c.subject}` : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {purpose === 'writeoff' && (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.writeoffReason')} *
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={writeoffReason}
              onChange={(e) => setWriteoffReason(e.target.value as WriteoffReasonId)}
              required
            >
              <option value="">{t('warehouse.doc.pickWriteoffReason')}</option>
              {WRITEOFF_REASONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {t(r.labelKey)}
                </option>
              ))}
            </select>
          </label>
        )}

        {purpose === 'production_issue' && brigades.length > 0 ? (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.brigade')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={brigade}
              onChange={(e) => setBrigade(e.target.value)}
            >
              <option value="">—</option>
              {brigades.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {purpose === 'production_issue' && openProductionRequests.length > 0 ? (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.productionRequest')}
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={productionRequestId}
              onChange={(e) => handleProductionRequestPick(e.target.value)}
            >
              <option value="">—</option>
              {openProductionRequests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.date} · {r.brigadeName} ·{' '}
                  {r.lineId === 'pack' ? t('nav.production') : `L${r.lineId}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {purpose === 'transfer' ? (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.targetWarehouse')} *
            <select
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              value={targetWarehouseId}
              onChange={(e) => setTargetWarehouseId(e.target.value)}
            >
              <option value="">—</option>
              {sortedLocations
                .filter((l) => l.id !== docWarehouseId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.kind ? ` · ${t(`warehouse.locationKind.${l.kind}`)}` : ''}
                  </option>
                ))}
            </select>
          </label>
        ) : null}

        {keeperName ? (
          <label className="block text-xs font-semibold text-stone-500">
            {t('warehouse.doc.keeper')}
            <input
              className="mt-1 w-full rounded-sm border border-grid bg-stone-50 px-3 py-2 text-sm"
              value={keeperName}
              readOnly
            />
          </label>
        ) : null}

        <label className={`block text-xs font-semibold text-stone-500 ${variant === 'page' ? 'lg:col-span-2' : ''}`}>
          {t('warehouse.comment')}
          <input
            className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
      </div>

      <div className={variant === 'page' ? 'overflow-x-auto' : ''}>
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-grid bg-stone-50 text-left text-[11px] uppercase tracking-wide text-stone-500">
              <th className="w-10 px-2 py-2 text-center">№</th>
              <th className="min-w-[16rem] px-2 py-2">{t('warehouse.col.name')}</th>
              <th className="w-28 px-2 py-2">{t('warehouse.col.category')}</th>
              <th className="w-14 px-2 py-2">{t('warehouse.col.unit')}</th>
              <th className="w-24 px-2 py-2 text-right">{t('warehouse.col.available')}</th>
              <th className="w-28 px-2 py-2 text-right">{t('warehouse.quantity')}</th>
              <th className="w-24 px-2 py-2 text-right">{t('warehouse.col.sum')}</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const item = line.itemId
                ? activeItems.find((i) => i.id === line.itemId)
                : undefined
              const bal = line.itemId ? balances.get(line.itemId) : undefined
              const qty = Number(line.quantity.replace(',', '.'))
              const selectedUnit = line.unit ?? item?.unit
              const altUnits = item?.unitConversions?.length ? item.unitConversions : undefined
              const isAltUnit = !!item && !!selectedUnit && selectedUnit !== item.unit
              const baseQty = item ? toBaseQty(item, qty, line.unit) : qty
              const linePrice =
                type === 'receipt' && line.unitPrice
                  ? Number(line.unitPrice.replace(',', '.')) || 0
                  : undefined
              const sum =
                qty > 0
                  ? linePrice != null
                    ? qty * linePrice
                    : item
                      ? itemStockValue(item, baseQty)
                      : 0
                  : 0

              return (
                <Fragment key={line.key}>
                <tr className="border-b border-grid/60 align-top" data-line={line.key}>
                  <td className="px-2 py-2 text-center text-stone-400 tabular-nums">{idx + 1}</td>
                  <td className="px-2 py-1.5">
                    <NomenclaturePicker
                      items={pickerItems}
                      categoryNames={categoryNames}
                      balances={balances}
                      warehouseId={docWarehouseId}
                      value={line.itemId}
                      autoFocus={idx === lines.length - 1 && !line.itemId}
                      onChange={(id) => pickItem(line.key, id)}
                      onConfirmQty={() => focusQty(line.key)}
                    />
                  </td>
                  <td className="px-2 py-2 text-xs text-stone-500">
                    {item ? categoryNames.get(item.categoryId) ?? '—' : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-stone-500">
                    {item && altUnits ? (
                      <select
                        className="w-full rounded border border-grid px-1 py-1 text-xs"
                        value={selectedUnit}
                        onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                      >
                        <option value={item.unit}>{unitLabel(item.unit, locale)}</option>
                        {altUnits.map((c) => (
                          <option key={c.unit} value={c.unit}>
                            {unitLabel(c.unit, locale)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      unitLabel(item?.unit, locale) || '—'
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                    {item ? formatQty(bal?.available ?? 0) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      ref={(el) => {
                        if (el) qtyRefs.current.set(line.key, el)
                        else qtyRefs.current.delete(line.key)
                      }}
                      type="text"
                      inputMode="decimal"
                      disabled={!line.itemId}
                      className="w-full rounded border border-grid px-2 py-1.5 text-right text-sm tabular-nums disabled:bg-stone-50"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          if (idx === lines.length - 1) addLine(true)
                          else {
                            const next = lines[idx + 1]
                            if (next) {
                              document
                                .querySelector<HTMLInputElement>(`[data-line="${next.key}"] input`)
                                ?.focus()
                            }
                          }
                        }
                      }}
                    />
                    {isAltUnit && qty > 0 && item && (
                      <p className="mt-0.5 text-right text-[10px] text-teal-700">
                        = {formatQty(baseQty)} {unitLabel(item.unit, locale)}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-stone-600">
                    {sum ? `${formatQty(sum)} ₾` : '—'}
                  </td>
                  <td className="px-1 py-2 text-center">
                    <button
                      type="button"
                      className="text-stone-400 hover:text-red-600"
                      title={t('warehouse.doc.removeLine')}
                      onClick={() => removeLine(line.key)}
                    >
                      <CloseIcon size={14} />
                    </button>
                  </td>
                </tr>
                {type === 'receipt' && line.itemId && (
                  <tr className="border-b border-grid/60 bg-stone-50/40">
                    <td />
                    <td colSpan={7} className="px-2 pb-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
                        <label className="flex items-center gap-1">
                          {t('warehouse.doc.unitPrice')}
                          <input
                            type="text"
                            inputMode="decimal"
                            className="w-24 rounded border border-grid px-2 py-1 text-right tabular-nums"
                            value={line.unitPrice ?? ''}
                            onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          {t('warehouse.doc.batchNo')}
                          <input
                            type="text"
                            className="w-28 rounded border border-grid px-2 py-1"
                            value={line.batchNo ?? ''}
                            onChange={(e) => updateLine(line.key, { batchNo: e.target.value })}
                          />
                        </label>
                        <label className="flex items-center gap-1">
                          {t('warehouse.doc.expiryDate')}
                          <input
                            type="date"
                            className="rounded border border-grid px-2 py-1"
                            value={line.expiryDate ?? ''}
                            onChange={(e) => updateLine(line.key, { expiryDate: e.target.value })}
                          />
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      </fieldset>

      <div
        className={`flex flex-wrap items-center justify-between gap-3 ${
          variant === 'page' ? 'border-t border-grid px-4 py-3' : 'pt-2'
        }`}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-sm border border-teal-600 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
            onClick={() => setPickOpen(true)}
          >
            {t('warehouse.pick.button')}
          </button>
          <button
            type="button"
            className="btn-add-outline px-3 py-2 text-sm"
            onClick={() => addLine(true)}
          >
            + {t('warehouse.doc.addLine')}
          </button>
          {totalSum > 0 && (
            <span className="self-center text-sm text-stone-500">
              {t('warehouse.doc.total')}: <strong className="tabular-nums">{formatQty(totalSum)} ₾</strong>
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {printMeta && (
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm font-medium hover:bg-stone-50"
              onClick={printDraft}
            >
              {t('warehouse.print.previewBtn')}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm"
              onClick={onCancel}
            >
              {t('common.cancel')}
            </button>
          )}
          {onSaveDraft && purpose !== 'transfer' && !readOnly && (
            <button
              type="button"
              className="rounded-sm border border-teal-600 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50"
              onClick={saveDraft}
            >
              {t('warehouse.doc.saveDraft')}
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              className="rounded-sm bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              onClick={postDocument}
            >
              {t('warehouse.doc.post')}
            </button>
          )}
        </div>
      </div>

      <WarehousePickModal
        open={pickOpen}
        items={pickerItems}
        categories={warehouse.categories}
        categoryNames={categoryNames}
        balances={balances}
        warehouseId={docWarehouseId}
        docType={type}
        initialSearch={initialPickSearch}
        allowNegativeStock={allowNegativeStock}
        onClose={() => setPickOpen(false)}
        onApply={mergePickedRows}
      />

      {pickCounterpartyOpen && onUpsertCounterparty && counterpartyPickerFilter && (
        <LoadingPickCounterpartyModal
          counterparties={counterparties}
          purposeFilter={counterpartyPickerFilter}
          onPick={handleCounterpartyPick}
          onUpsertCounterparty={onUpsertCounterparty}
          onOpenDirectory={onOpenCounterparties}
          onClose={() => setPickCounterpartyOpen(false)}
        />
      )}

      {receiptPrintPreview && (
        <WarehouseReceiptPrintPreview
          model={receiptPrintPreview}
          onClose={() => setReceiptPrintPreview(null)}
        />
      )}
      {issuePrintPreview && (
        <WarehouseIssuePrintPreview
          model={issuePrintPreview}
          onClose={() => setIssuePrintPreview(null)}
        />
      )}
    </div>
  )
})

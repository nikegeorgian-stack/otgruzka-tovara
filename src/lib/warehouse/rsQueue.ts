import type { WarehouseDocument, WarehouseStore } from './types'

export type RsQueueKind =
  | 'invoice_unposted'
  | 'receipt_no_rs'
  | 'not_exported'
  | 'production_docs'
  | 'loading_docs'

export type RsQueueRow = {
  id: string
  kind: RsQueueKind
  document?: WarehouseDocument
  invoiceKey?: string
  sellerTin?: string
  sellerName?: string
  date?: string
  label: string
}

/**
 * Очереди для бухгалтера / RS.ge без ломки keeper/loading:
 * — инвойсы в реестре без проведённого прихода
 * — приходы без ключа RS
 * — проведённые доки без exportedAt
 * — производственные и отгрузочные документы
 */
export function buildRsQueues(store: WarehouseStore): RsQueueRow[] {
  const rows: RsQueueRow[] = []
  const docs = store.documents ?? []
  const postedReceiptKeys = new Set(
    docs
      .filter((d) => d.type === 'receipt' && (d.status ?? 'posted') === 'posted' && d.invoiceKey)
      .map((d) => (d.invoiceKey ?? '').trim().toUpperCase())
      .filter(Boolean),
  )

  for (const inv of store.invoiceRegistry ?? []) {
    const key = (inv.key || '').trim().toUpperCase()
    if (!key || postedReceiptKeys.has(key)) continue
    rows.push({
      id: `inv:${inv.id}`,
      kind: 'invoice_unposted',
      invoiceKey: inv.key,
      sellerTin: inv.sellerTin,
      sellerName: inv.sellerName,
      date: inv.date,
      label: `RS ${inv.key}${inv.sellerName ? ` · ${inv.sellerName}` : ''}`,
    })
  }

  for (const d of docs) {
    if ((d.status ?? 'posted') !== 'posted') continue
    if (d.type === 'receipt' && !d.invoiceKey?.trim() && d.purpose === 'purchase') {
      rows.push({
        id: `nors:${d.id}`,
        kind: 'receipt_no_rs',
        document: d,
        date: d.date,
        label: `${d.number} · приход без RS`,
      })
    }
    if (!d.exportedAt) {
      const relevant =
        Boolean(d.invoiceKey) ||
        d.purpose === 'purchase' ||
        Boolean(d.productionRequestId) ||
        Boolean(d.batchRunId) ||
        Boolean(d.loadingShipmentId) ||
        d.docRole === 'batch_issue' ||
        d.docRole === 'batch_receipt' ||
        d.docRole === 'production_issue' ||
        d.docRole === 'production_receipt' ||
        d.docRole === 'loading_issue'
      if (relevant) {
        rows.push({
          id: `exp:${d.id}`,
          kind: 'not_exported',
          document: d,
          date: d.date,
          label: `${d.number} · не выгружен`,
        })
      }
    }
    if (
      d.productionRequestId ||
      d.batchRunId ||
      d.docRole === 'batch_issue' ||
      d.docRole === 'batch_receipt' ||
      d.docRole === 'production_issue' ||
      d.docRole === 'production_receipt'
    ) {
      rows.push({
        id: `prod:${d.id}`,
        kind: 'production_docs',
        document: d,
        date: d.date,
        label: `${d.number} · производство`,
      })
    }
    if (d.loadingShipmentId || d.docRole === 'loading_issue') {
      rows.push({
        id: `load:${d.id}`,
        kind: 'loading_docs',
        document: d,
        date: d.date,
        label: `${d.number} · отгрузка`,
      })
    }
  }

  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function markWarehouseDocsExported(
  store: WarehouseStore,
  documentIds: string[],
  actor?: { id?: string; name?: string },
): WarehouseStore {
  const set = new Set(documentIds)
  const at = new Date().toISOString()
  return {
    ...store,
    documents: store.documents.map((d) =>
      set.has(d.id)
        ? {
            ...d,
            exportedAt: at,
            exportedBy: actor?.id,
            exportedByName: actor?.name,
          }
        : d,
    ),
  }
}

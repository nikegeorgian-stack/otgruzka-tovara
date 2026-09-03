import { appendWarehouseAudit } from '@/lib/warehouse/audit'
import { enrichDocumentCounterparty } from '@/lib/warehouse/documentValidation'
import {
  recordItemArchiveHistory,
  upsertWarehouseItemInStore,
} from '@/lib/warehouse/itemHistory'
import {
  postWarehouseDocument,
  postWarehouseTransfer,
  cancelWarehouseDocument,
  saveWarehouseDocumentDraft,
  postExistingWarehouseDocument,
  unpostWarehouseDocument,
  removeWarehouseDraftDocument,
  postInventoryRevision,
  postOpeningBalances,
  runInventoryCount,
  type PostDocumentResult,
  type CancelDocumentResult,
  type UnpostDocumentResult,
  type SaveDraftInput,
} from '@/lib/warehouse/documents'
import {
  postOpeningInventory,
  saveOpeningInventoryDraft,
  openingInventorySourceKey,
  type OpeningInventoryDraftInput,
} from '@/lib/warehouse/openingInventory'
import { warehouseTransactionGroupId } from '@/lib/cloud/transactionGroups'
import {
  acquireWarehouseDocumentLock as acquireDocLockInStore,
  releaseWarehouseDocumentLock as releaseDocLockInStore,
} from '@/lib/warehouse/documentLock'
import {
  adjustDailyIssueLine,
  openOrResumeDailyIssue,
  postDailyIssueSession,
  setDailyIssueComment,
} from '@/lib/warehouse/dailyIssue'
import {
  createWarehouseItemRequest,
  resolveWarehouseItemRequest,
  type CreateItemRequestInput,
} from '@/lib/warehouse/itemRequests'
import {
  cancelKeeperReplenishment,
  createKeeperReplenishment,
  createReplenishmentFromDeficit,
  receiveKeeperReplenishment,
  submitKeeperReplenishment,
  updateKeeperReplenishment,
  type CreateReplenishmentInput,
  type ReceiveReplenishmentLine,
} from '@/lib/warehouse/keeperReplenishment'
import {
  postLoadingShipment,
  removeLoadingShipment,
  upsertLoadingShipment,
  type UpsertLoadingShipmentInput,
} from '@/lib/warehouse/loadingShipments'
import { markWarehouseDocsExported } from '@/lib/warehouse/rsQueue'
import {
  createWarehouseItemRenameRequest,
  resolveWarehouseItemRenameRequest,
  type CreateItemRenameRequestInput,
} from '@/lib/warehouse/itemRenameRequests'
import { mergeInvoiceRegistry } from '@/lib/warehouse/georgianInvoice'
import { importWarehouseFromExcel } from '@/lib/warehouse/importExport'
import { toggleClosedMonth } from '@/lib/warehouse/periodClose'
import { toBaseQty } from '@/lib/warehouse/stock'
import type {
  StockMovement,
  WarehouseCategory,
  WarehouseDocument,
  WarehouseItem,
  WarehouseLocation,
  WarehouseStore,
} from '@/lib/warehouse/types'
import { patchWarehouse, type StoreSliceDeps } from '../storeApi'
import { actorFromGetter, recordSliceExplicitDelete } from '@/lib/cloud/explicitDeleteHelper'
import { syncSalesOrderLoadingInStore, markSalesOrderShippedIfFullyLoaded } from '@/lib/sales/loadingLink'

export function createWarehouseSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  function actorRoleId(): string | undefined {
    const actor = getActor?.()
    if (!actor?.id) return undefined
    return getStore().access.users.find((u) => u.id === actor.id)?.roleId
  }

  return {
    upsertWarehouseItem(item: WarehouseItem) {
      const roleId = actorRoleId()
      const actor = getActor?.()
      patchWarehouse(setStore, (w) => {
        const exists = w.items.some((i) => i.id === item.id)
        const before = w.items.find((i) => i.id === item.id)
        let next = upsertWarehouseItemInStore(w, item, roleId)
        const saved = next.items.find((i) => i.id === item.id)
        const techChanged = (before?.technicalName ?? '') !== (saved?.technicalName ?? '')
        const techDetail = techChanged
          ? ` · тех.название: «${before?.technicalName?.trim() || '—'}» → «${saved?.technicalName?.trim() || '—'}»`
          : ''
        next = appendWarehouseAudit(next, {
          action: 'item_change',
          detail: exists
            ? `Изменено: ${saved?.name ?? item.name} (${saved?.internalCode ?? ''})${techDetail}`
            : `Добавлено: ${saved?.name ?? item.name} (${saved?.internalCode ?? ''})${techDetail}`,
          itemId: item.id,
          actorId: actor?.id,
          actorName: actor?.name,
        })
        return next
      })
    },

    archiveWarehouseItem(id: string, archived: boolean) {
      patchWarehouse(setStore, (w) => {
        const item = w.items.find((i) => i.id === id)
        if (!item) return w
        let next: WarehouseStore = {
          ...w,
          items: w.items.map((i) => (i.id === id ? { ...i, active: !archived } : i)),
        }
        next = recordItemArchiveHistory(next, id, item.name, archived)
        next = appendWarehouseAudit(next, {
          action: 'item_archive',
          detail: archived ? `В архив: ${item.name}` : `Из архива: ${item.name}`,
          itemId: id,
        })
        return next
      })
    },

    removeWarehouseItem(id: string): boolean {
      let removed = false
      patchWarehouse(setStore, (w) => {
        const hasMovements = w.movements.some((m) => m.itemId === id)
        const inDocuments = w.documents.some((d) => d.lines.some((l) => l.itemId === id))
        if (hasMovements || inDocuments) return w
        removed = true
        return {
          ...w,
          items: w.items.filter((i) => i.id !== id),
        }
      })
      if (removed) {
        recordSliceExplicitDelete('warehouse.items', id, actorFromGetter(getActor))
      }
      return removed
    },

    upsertWarehouseCategory(cat: WarehouseCategory) {
      patchWarehouse(setStore, (w) => {
        const exists = w.categories.some((c) => c.id === cat.id)
        return {
          ...w,
          categories: exists
            ? w.categories.map((c) => (c.id === cat.id ? cat : c))
            : [...w.categories, cat],
        }
      })
    },

    upsertWarehouseLocation(loc: WarehouseLocation) {
      patchWarehouse(setStore, (w) => {
        const exists = w.locations.some((l) => l.id === loc.id)
        return {
          ...w,
          locations: exists
            ? w.locations.map((l) => (l.id === loc.id ? loc : l))
            : [...w.locations, loc],
        }
      })
    },

    removeWarehouseCategory(id: string): boolean {
      let removed = false
      patchWarehouse(setStore, (w) => {
        if (w.items.some((i) => i.categoryId === id)) return w
        removed = true
        return { ...w, categories: w.categories.filter((c) => c.id !== id) }
      })
      if (removed) recordSliceExplicitDelete('warehouse.categories', id, actorFromGetter(getActor))
      return removed
    },

    removeWarehouseLocation(id: string): boolean {
      let removed = false
      patchWarehouse(setStore, (w) => {
        const used =
          w.items.some((i) => i.warehouseId === id) ||
          w.movements.some((m) => m.warehouseId === id) ||
          w.documents.some((d) => d.warehouseId === id || d.targetWarehouseId === id)
        if (used) return w
        removed = true
        return { ...w, locations: w.locations.filter((l) => l.id !== id) }
      })
      if (removed) recordSliceExplicitDelete('warehouse.locations', id, actorFromGetter(getActor))
      return removed
    },

    addStockMovement(movement: Omit<StockMovement, 'id' | 'createdAt'>) {
      // PHASE W1/W3 — all stock effects require WarehouseDocument.
      // Legacy bare reserve/unreserve movements remain readable; new bare API is fail-closed.
      if (!movement.documentId) {
        return
      }
      patchWarehouse(setStore, (w) => {
        const item = w.items.find((i) => i.id === movement.itemId)
        const qty = item
          ? toBaseQty(item, movement.quantity, movement.inputUnit)
          : movement.quantity
        let next: WarehouseStore = {
          ...w,
          movements: [
            ...w.movements,
            {
              ...movement,
              quantity: qty,
              warehouseId:
                movement.warehouseId || item?.warehouseId || w.locations[0]?.id || '',
              id: crypto.randomUUID(),
              createdAt: new Date().toISOString(),
            },
          ],
        }
        next = appendWarehouseAudit(next, {
          action: 'movement_add',
          detail: `${movement.type} · ${item?.name ?? movement.itemId} · ${qty}`,
          itemId: movement.itemId,
        })
        return next
      })
    },

    deleteStockMovement(id: string): boolean {
      let deleted = false
      patchWarehouse(setStore, (w) => {
        const m = w.movements.find((x) => x.id === id)
        // Never delete document-linked (posted) movements — use storno.
        if (!m || m.documentId) return w
        deleted = true
        let next: WarehouseStore = {
          ...w,
          movements: w.movements.filter((x) => x.id !== id),
        }
        next = appendWarehouseAudit(next, {
          action: 'movement_delete',
          detail: `Удалена операция ${m.type}`,
          itemId: m.itemId,
        })
        return next
      })
      if (deleted) {
        recordSliceExplicitDelete('warehouse.movements', id, actorFromGetter(getActor))
      }
      return deleted
    },

    postWarehouseDoc(doc: Omit<WarehouseDocument, 'id' | 'createdAt'>): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'unknown' }
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      patchWarehouse(setStore, (w) => {
        const out = postWarehouseDocument(w, enriched)
        result = out.result
        return out.store
      })
      return result
    },

    saveWarehouseDocDraft(
      doc: SaveDraftInput,
      actor?: { actorId?: string; actorName?: string },
    ): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'unknown' }
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      patchWarehouse(setStore, (w) => {
        const out = saveWarehouseDocumentDraft(w, enriched, actor)
        result = out.result
        return out.store
      })
      return result
    },

    postExistingWarehouseDoc(
      documentId: string,
      actor?: { actorId?: string; actorName?: string },
    ): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'unknown' }
      patchWarehouse(setStore, (w) => {
        const out = postExistingWarehouseDocument(w, documentId, actor)
        result = out.result
        return out.store
      })
      return result
    },

    unpostWarehouseDoc(
      documentId: string,
      actor?: { actorId?: string; actorName?: string },
    ): UnpostDocumentResult {
      let result: UnpostDocumentResult = { ok: false, error: 'unknown' }
      patchWarehouse(setStore, (w) => {
        const out = unpostWarehouseDocument(w, documentId, actor)
        result = out.result
        return out.store
      })
      return result
    },

    removeWarehouseDraft(
      documentId: string,
      actor?: { actorId?: string; actorName?: string },
    ): UnpostDocumentResult {
      let result: UnpostDocumentResult = { ok: false, error: 'unknown' }
      patchWarehouse(setStore, (w) => {
        const out = removeWarehouseDraftDocument(w, documentId, actor)
        result = out.result
        return out.store
      })
      if (result.ok) {
        recordSliceExplicitDelete('warehouse.documents', documentId, {
          actorId: actor?.actorId ?? getActor?.()?.id,
          actorName: actor?.actorName ?? getActor?.()?.name,
        })
      }
      return result
    },

    acquireWarehouseDocumentLock(
      documentId: string,
      actor: { actorId: string; actorName?: string },
    ): { ok: boolean; error?: string; lockedByName?: string } {
      let result: { ok: boolean; error?: string; lockedByName?: string } = { ok: false, error: 'unknown' }
      patchWarehouse(setStore, (w) => {
        const out = acquireDocLockInStore(w, documentId, actor)
        result = out.result.ok
          ? { ok: true }
          : { ok: false, error: out.result.error, lockedByName: out.result.lockedByName }
        return out.store
      })
      return result
    },

    releaseWarehouseDocumentLock(documentId: string, actorId?: string) {
      patchWarehouse(setStore, (w) => releaseDocLockInStore(w, documentId, actorId))
    },

    postWarehouseTransfer(
      doc: Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'docRole' | 'transferPairId'> & {
        targetWarehouseId: string
      },
    ): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'unknown' }
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      const sessionRev = `${enriched.date ?? ''}:${enriched.number ?? ''}:${enriched.warehouseId}:${enriched.targetWarehouseId}`
      const groupId = warehouseTransactionGroupId({
        kind: 'warehouse_transfer',
        sourceId: `${enriched.warehouseId}→${enriched.targetWarehouseId}:${enriched.number ?? 'xfer'}`,
        revision: sessionRev,
      })
      patchWarehouse(
        setStore,
        (w) => {
          const out = postWarehouseTransfer(w, enriched)
          result = out.result
          return out.store
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'warehouse_transfer',
          transactionGroupLabel: 'Перемещение между складами',
        },
      )
      return result
    },

    cancelWarehouseDocument(
      documentId: string,
      args?: { cancelledBy?: string; cancelledByName?: string; reason?: string },
    ): CancelDocumentResult {
      let result: CancelDocumentResult = { ok: false, error: 'unknown' }
      const existing = getStore().warehouse.documents.find((d) => d.id === documentId)
      const pairId = existing?.transferPairId
      const groupId = warehouseTransactionGroupId({
        kind: pairId ? 'cancel_transfer_pair' : 'document_cancel',
        sourceId: pairId ?? documentId,
        revision: 'cancel',
      })
      const groupMeta = {
        origin: 'user' as const,
        atomic: true as const,
        transactionGroupId: groupId,
        transactionGroupKind: pairId ? 'cancel_transfer_pair' : 'document_cancel',
        transactionGroupLabel: pairId
          ? 'Отмена пары перемещения'
          : 'Сторно складского документа',
      }
      patchWarehouse(
        setStore,
        (w) => {
          const out = cancelWarehouseDocument(w, documentId, {
            ...(args ?? {}),
            transactionGroupId: groupId,
          })
          result = out.result
          return out.store
        },
        groupMeta,
      )
      return result
    },

    mergeWarehouseInvoiceRegistry(registry: import('@/lib/warehouse/types').GeorgianInvoice[]) {
      patchWarehouse(setStore, (w) => ({
        ...w,
        invoiceRegistry: mergeInvoiceRegistry(w.invoiceRegistry, registry),
      }))
    },

    runWarehouseInventory(args: Parameters<typeof runInventoryCount>[1]) {
      patchWarehouse(setStore, (w) => runInventoryCount(w, args))
    },

    postWarehouseInventoryRevision(args: Parameters<typeof postInventoryRevision>[1]) {
      let result = { applied: 0, skipped: 0, unchanged: 0 }
      patchWarehouse(setStore, (w) => {
        const out = postInventoryRevision(w, args)
        result = out.result
        return out.store
      })
      return result
    },

    postWarehouseOpeningBalances(args: Parameters<typeof postOpeningBalances>[1]) {
      let result = { applied: 0, skipped: 0 }
      patchWarehouse(setStore, (w) => {
        const out = postOpeningBalances(w, args)
        result = out.result
        return out.store
      })
      return result
    },

    saveOpeningInventoryDraft(
      input: OpeningInventoryDraftInput,
      actor?: { actorId?: string; actorName?: string },
    ): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'warehouse.doc.errGeneric' }
      patchWarehouse(setStore, (w) => {
        const out = saveOpeningInventoryDraft(w, input, actor)
        result = out.result
        return out.store
      })
      return result
    },

    postOpeningInventory(
      input: OpeningInventoryDraftInput & { documentId?: string },
      actor?: { actorId?: string; actorName?: string },
    ): PostDocumentResult {
      let result: PostDocumentResult = { ok: false, error: 'warehouse.doc.errGeneric' }
      const groupId = warehouseTransactionGroupId({
        kind: 'opening_inventory',
        sourceId: input.warehouseId,
        revision: openingInventorySourceKey(input.warehouseId),
      })
      patchWarehouse(
        setStore,
        (w) => {
          const out = postOpeningInventory(w, input, actor)
          result = out.result
          return out.store
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'opening_inventory',
          transactionGroupLabel: 'Начальные остатки (инвентаризация)',
        },
      )
      return result
    },

    async importWarehouseExcel(file: File, warehouseId?: string) {
      const imported = await importWarehouseFromExcel(
        file,
        getStore().warehouse,
        warehouseId,
      )
      if (imported.result.draftsCreated > 0) {
        setStore((s) => ({ ...s, warehouse: imported.store }))
      }
      return imported.result
    },

    setWarehouseStore(warehouse: WarehouseStore) {
      setStore((s) => ({ ...s, warehouse }))
    },

    setWarehouseMonthClosed(month: string, closed: boolean) {
      patchWarehouse(setStore, (w) => ({
        ...w,
        closedMonths: toggleClosedMonth(w.closedMonths, month, closed),
      }))
    },

    openDailyIssueSession(args: Parameters<typeof openOrResumeDailyIssue>[1]) {
      let sessionId = ''
      patchWarehouse(setStore, (w) => {
        const out = openOrResumeDailyIssue(w, args)
        sessionId = out.session.id
        return out.store
      })
      return sessionId
    },

    adjustDailyIssueLine(sessionId: string, itemId: string, delta: number) {
      patchWarehouse(setStore, (w) => adjustDailyIssueLine(w, sessionId, itemId, delta))
    },

    setDailyIssueComment(sessionId: string, comment: string) {
      patchWarehouse(setStore, (w) => setDailyIssueComment(w, sessionId, comment))
    },

    postDailyIssueSession(
      sessionId: string,
      options?: { allowNegativeStock?: boolean },
    ) {
      let result: ReturnType<typeof postDailyIssueSession>['result'] = {
        ok: false,
        reason: 'not_found',
      }
      patchWarehouse(setStore, (w) => {
        const out = postDailyIssueSession(w, sessionId, options)
        result = out.result
        return out.store
      })
      return result
    },

    createWarehouseItemRequest(input: CreateItemRequestInput) {
      patchWarehouse(setStore, (w) => createWarehouseItemRequest(w, input))
    },

    resolveWarehouseItemRequest(
      requestId: string,
      status: 'fulfilled' | 'rejected',
      opts?: { fulfilledItemId?: string; keeperNote?: string; keeperName?: string },
    ) {
      patchWarehouse(setStore, (w) => resolveWarehouseItemRequest(w, requestId, status, opts))
    },

    createWarehouseItemRenameRequest(input: CreateItemRenameRequestInput) {
      let result = { ok: false as boolean, error: 'unknown' as string | undefined }
      patchWarehouse(setStore, (w) => {
        const r = createWarehouseItemRenameRequest(w, input)
        result = { ok: r.ok, error: r.error }
        return r.store
      })
      return result
    },

    resolveWarehouseItemRenameRequest(
      requestId: string,
      status: 'accepted' | 'rejected',
      opts?: { keeperNote?: string; keeperId?: string; keeperName?: string },
    ) {
      patchWarehouse(setStore, (w) => resolveWarehouseItemRenameRequest(w, requestId, status, opts))
    },

    createKeeperReplenishment(input: CreateReplenishmentInput) {
      let requestId = ''
      patchWarehouse(setStore, (w) => {
        const out = createKeeperReplenishment(w, input)
        requestId = out.request.id
        return out.store
      })
      return requestId
    },

    createReplenishmentFromDeficit(input: Omit<CreateReplenishmentInput, 'lines'>) {
      let requestId: string | null = null
      patchWarehouse(setStore, (w) => {
        const out = createReplenishmentFromDeficit(w, input)
        requestId = out.request?.id ?? null
        return out.store
      })
      return requestId
    },

    updateKeeperReplenishment(
      requestId: string,
      patch: Parameters<typeof updateKeeperReplenishment>[2],
    ) {
      patchWarehouse(setStore, (w) => updateKeeperReplenishment(w, requestId, patch))
    },

    submitKeeperReplenishment(requestId: string) {
      patchWarehouse(setStore, (w) => submitKeeperReplenishment(w, requestId))
    },

    cancelKeeperReplenishment(requestId: string) {
      patchWarehouse(setStore, (w) => cancelKeeperReplenishment(w, requestId))
    },

    receiveKeeperReplenishment(
      requestId: string,
      lines: ReceiveReplenishmentLine[],
      args?: { date?: string; keeperId?: string; keeperName?: string },
    ) {
      let result: ReturnType<typeof receiveKeeperReplenishment>['result'] = {
        ok: false,
        error: 'warehouse.replenishment.errNotFound',
      }
      patchWarehouse(setStore, (w) => {
        const out = receiveKeeperReplenishment(w, requestId, lines, args ?? {})
        result = out.result
        return out.store
      })
      return result
    },

    upsertLoadingShipment(input: UpsertLoadingShipmentInput) {
      let shipmentId = ''
      setStore((s) => {
        const out = upsertLoadingShipment(s.warehouse, input)
        shipmentId = out.shipment.id
        let next = { ...s, warehouse: out.store }
        if (input.salesOrderId) {
          next = syncSalesOrderLoadingInStore(next, input.salesOrderId)
        }
        return next
      })
      return shipmentId
    },

    postLoadingShipment(
      shipmentId: string,
      args?: { keeperId?: string; keeperName?: string },
    ) {
      let result: ReturnType<typeof postLoadingShipment>['result'] = {
        ok: false,
        error: 'warehouse.loading.errNotFound',
      }
      setStore((s) => {
        const out = postLoadingShipment(s.warehouse, shipmentId, args)
        result = out.result
        if (!out.result.ok) return s
        let next = { ...s, warehouse: out.store }
        const shipment = out.store.loadingShipments?.find((x) => x.id === shipmentId)
        if (shipment?.salesOrderId) {
          next = syncSalesOrderLoadingInStore(next, shipment.salesOrderId)
          next = markSalesOrderShippedIfFullyLoaded(next, shipment.salesOrderId)
        }
        return next
      })
      return result
    },

    removeLoadingShipment(shipmentId: string) {
      const before = getStore().warehouse.loadingShipments ?? []
      const existed = before.some((s) => s.id === shipmentId && s.status !== 'posted')
      patchWarehouse(setStore, (w) => removeLoadingShipment(w, shipmentId))
      if (existed) {
        recordSliceExplicitDelete('warehouse.loadingShipments', shipmentId, actorFromGetter(getActor))
      }
    },

    markWarehouseDocsExported(
      documentIds: string[],
      actor?: { id?: string; name?: string },
    ) {
      if (!documentIds.length) return
      patchWarehouse(setStore, (w) => markWarehouseDocsExported(w, documentIds, actor))
    },
  }
}

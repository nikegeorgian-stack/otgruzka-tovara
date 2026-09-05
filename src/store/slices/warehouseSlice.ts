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
  transferProductionMaterials,
  returnProductionMaterials,
  type HandoffResult,
  type ProductionMaterialReturnInput,
  type ProductionMaterialTransferInput,
} from '@/lib/warehouse/productionMaterialHandoff'
import { upsertProductionLineBinding } from '@/lib/warehouse/productionLineLocationConfig'
import type { ProductionLineLocationBinding } from '@/lib/warehouse/types'
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
  resolveLoadingShipmentLotUsages,
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
import { applyShipmentToLot, reverseShipmentOnLot } from '@/lib/production/shipmentGate'
import {
  g1PostWarehouseDocument,
  isG1WebAuthoritativePath,
  mirrorAuthoritativeWarehousePost,
  resolveAuthoritativeWarehouseOverlay,
} from '@/lib/warehouse/g1ServerClient'
import {
  g2WarehouseCommand,
  isG2WebAuthoritativePath,
  mirrorG2WarehouseAck,
} from '@/lib/warehouse/g2ServerClient'

export function cancelWarehouseDocumentGroupKind(
  documentId: string,
  existing?: WarehouseDocument | null,
  loadingShipmentPostedDocumentId?: string | null,
): 'finished_goods_shipment_cancel' | 'cancel_transfer_pair' | 'document_cancel' {
  if (loadingShipmentPostedDocumentId === documentId) return 'finished_goods_shipment_cancel'
  if (existing?.transferPairId) return 'cancel_transfer_pair'
  return 'document_cancel'
}

export function createWarehouseSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  function actorRoleId(): string | undefined {
    const actor = getActor?.()
    if (!actor?.id) return undefined
    return getStore().access.users.find((u) => u.id === actor.id)?.roleId
  }

  return {
    async upsertWarehouseItem(item: WarehouseItem) {
      const { isG5MasterDataActive } = await import('@/lib/planner/g5Activation')
      if (isG5MasterDataActive(getStore())) {
        const { isG5WebPath, g5MasterdataItemUpsert, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const conf = await g5MasterdataItemUpsert({
            idempotencyKey: `g5-item-${item.id}-${Date.now()}`,
            command: {
              id: item.id,
              code: item.internalCode,
              name: item.name,
              unit: item.unit,
              active: item.active !== false,
            },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

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

    async archiveWarehouseItem(id: string, archived: boolean) {
      const { isG5MasterDataActive } = await import('@/lib/planner/g5Activation')
      if (isG5MasterDataActive(getStore()) && archived) {
        const { isG5WebPath, g5MasterdataItemArchive, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const conf = await g5MasterdataItemArchive({
            idempotencyKey: `g5-item-archive-${id}-${Date.now()}`,
            command: { id },
          })
          if (!conf.ok) {
            throw new Error(conf.error || conf.message || 'g5.error.use_g5_gateway')
          }
          setStore((s) => mirrorG5Ack(s, conf.data), { origin: 'system' })
          return
        }
      }

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
      // Web cloud path: sync local post is LEGACY / not authoritative for G1.
      // Use postWarehouseDocAuthoritative() for server-trusted stock.
      if (isG1WebAuthoritativePath()) {
        return {
          ok: false,
          error: 'warehouse.g1.errUseAuthoritativePost',
        }
      }
      let result: PostDocumentResult = { ok: false, error: 'unknown' }
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      patchWarehouse(setStore, (w) => {
        const out = postWarehouseDocument(w, enriched)
        result = out.result
        return out.store
      })
      return result
    },

    /**
     * PHASE G1 — server-authoritative document post (web).
     * Local/offline desktop continues to use postWarehouseDoc.
     */
    async postWarehouseDocAuthoritative(
      doc: Omit<WarehouseDocument, 'id' | 'createdAt'> & { idempotencyKey: string },
    ): Promise<PostDocumentResult & { criticalRevision?: number; source?: string }> {
      // Desktop / local: keep offline domain post (not G1 cloud path).
      if (!isG1WebAuthoritativePath()) {
        let result: PostDocumentResult = { ok: false, error: 'unknown' }
        const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
        patchWarehouse(setStore, (w) => {
          const out = postWarehouseDocument(w, enriched)
          result = out.result
          return out.store
        })
        return result
      }
      // PHASE G5.1 — purchase receipts go through G5 once procurement is active.
      {
        const { isG5ProcurementActive } = await import('@/lib/planner/g5Activation')
        if (doc.purpose === 'purchase' && isG5ProcurementActive(getStore())) {
          return { ok: false, error: 'g5.error.use_g5_gateway' }
        }
      }
      if (doc.type !== 'receipt' && doc.type !== 'issue') {
        return { ok: false, error: 'warehouse.g1.errUnsupportedType' }
      }
      const server = await g1PostWarehouseDocument({
        idempotencyKey: doc.idempotencyKey,
        command: {
          type: doc.type,
          warehouseId: doc.warehouseId,
          date: doc.date,
          number: doc.number,
          lines: doc.lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            lineId: line.lineId,
            itemNameSnapshot: line.itemNameSnapshot,
            itemCodeSnapshot: line.itemCodeSnapshot,
            unitSnapshot: line.unitSnapshot,
            inputUnit: line.inputUnit,
          })),
          purpose: doc.purpose,
          docRole: doc.docRole,
        },
      })
      if (!server.ok) {
        return { ok: false, error: server.error || 'warehouse.g1.errServer' }
      }
      patchWarehouse(
        setStore,
        (w) => mirrorAuthoritativeWarehousePost(w, server.data.warehouse),
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: warehouseTransactionGroupId({
            kind: 'warehouse_transfer',
            sourceId: server.data.documentId,
            revision: String(server.data.criticalRevision ?? 1),
          }),
          transactionGroupKind: 'warehouse_transfer',
          transactionGroupLabel: 'G1 authoritative post',
        },
      )
      return {
        ok: true,
        documentId: server.data.documentId,
        idempotent: server.data.idempotent,
        criticalRevision: server.data.criticalRevision,
        source: 'fst_critical_store',
      }
    },

    /** Overlay authoritative warehouse from G1 critical store after reload. */
    applyAuthoritativeWarehouseOverlay(input: {
      criticalWarehouse: WarehouseStore
      criticalRevision: number
    }) {
      patchWarehouse(setStore, (w) => {
        const out = resolveAuthoritativeWarehouseOverlay({
          legacyWarehouse: w,
          criticalWarehouse: input.criticalWarehouse,
          criticalRevision: input.criticalRevision,
        })
        return out.warehouse
      })
    },

    async saveWarehouseDocDraft(
      doc: SaveDraftInput,
      actor?: { actorId?: string; actorName?: string },
    ): Promise<PostDocumentResult> {
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      if (!isG2WebAuthoritativePath()) {
        let result: PostDocumentResult = { ok: false, error: 'unknown' }
        patchWarehouse(setStore, (w) => {
          const out = saveWarehouseDocumentDraft(w, enriched, actor)
          result = out.result
          return out.store
        })
        return result
      }
      const idempotencyKey =
        typeof enriched.idempotencyKey === 'string' && enriched.idempotencyKey.trim()
          ? `g2-draft-${enriched.idempotencyKey.trim()}`
          : `g2-draft-${enriched.id ?? crypto.randomUUID()}-${enriched.revision ?? 0}`
      const server = await g2WarehouseCommand({
        idempotencyKey,
        commandType: 'warehouse.draft.save',
        command: {
          documentId: enriched.id,
          type: enriched.type,
          warehouseId: enriched.warehouseId,
          date: enriched.date,
          lines: enriched.lines,
          purpose: enriched.purpose,
          docRole: enriched.docRole,
          comment: enriched.comment,
          targetWarehouseId: enriched.targetWarehouseId,
          clientDraftKey: enriched.idempotencyKey,
        },
      })
      if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return { ok: true, documentId: String(server.data.documentId ?? '') }
    },

    async postExistingWarehouseDoc(
      documentId: string,
      _actor?: { actorId?: string; actorName?: string },
    ): Promise<PostDocumentResult> {
      if (!isG2WebAuthoritativePath()) {
        let result: PostDocumentResult = { ok: false, error: 'unknown' }
        patchWarehouse(setStore, (w) => {
          const out = postExistingWarehouseDocument(w, documentId, _actor)
          result = out.result
          return out.store
        })
        return result
      }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-post-existing-${documentId}`,
        commandType: 'warehouse.document.postExisting',
        command: { documentId },
      })
      if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return {
        ok: true,
        documentId: String(server.data.documentId ?? documentId),
        idempotent: server.data.idempotent,
      }
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

    async removeWarehouseDraft(
      documentId: string,
      actor?: { actorId?: string; actorName?: string },
    ): Promise<UnpostDocumentResult> {
      if (!isG2WebAuthoritativePath()) {
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
      }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-draft-del-${documentId}`,
        commandType: 'warehouse.draft.delete',
        command: { documentId },
      })
      if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      recordSliceExplicitDelete('warehouse.documents', documentId, {
        actorId: actor?.actorId ?? getActor?.()?.id,
        actorName: actor?.actorName ?? getActor?.()?.name,
      })
      return { ok: true }
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

    async postWarehouseTransfer(
      doc: Omit<WarehouseDocument, 'id' | 'createdAt' | 'type' | 'docRole' | 'transferPairId'> & {
        targetWarehouseId: string
      },
    ): Promise<PostDocumentResult> {
      const enriched = enrichDocumentCounterparty(doc, getStore().counterparties.items)
      if (!isG2WebAuthoritativePath()) {
        let result: PostDocumentResult = { ok: false, error: 'unknown' }
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
      }
      const idempotencyKey =
        typeof enriched.idempotencyKey === 'string' && enriched.idempotencyKey.trim()
          ? enriched.idempotencyKey.trim()
          : `g2-xfer-${crypto.randomUUID()}`
      const server = await g2WarehouseCommand({
        idempotencyKey,
        commandType: 'warehouse.transfer.post',
        command: {
          warehouseId: enriched.warehouseId,
          targetWarehouseId: enriched.targetWarehouseId,
          date: enriched.date,
          lines: enriched.lines,
          comment: enriched.comment,
          purpose: enriched.purpose ?? 'transfer',
        },
      })
      if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse), {
        origin: 'user',
        atomic: true,
        transactionGroupId: warehouseTransactionGroupId({
          kind: 'warehouse_transfer',
          sourceId: String(server.data.documentId ?? 'xfer'),
          revision: String(server.data.criticalRevision ?? 1),
        }),
        transactionGroupKind: 'warehouse_transfer',
        transactionGroupLabel: 'G2 authoritative transfer',
      })
      return {
        ok: true,
        documentId: String(server.data.documentId ?? ''),
        idempotent: server.data.idempotent,
      }
    },

    async transferProductionOrderMaterials(
      input: ProductionMaterialTransferInput,
    ): Promise<HandoffResult> {
      const { isG3WebAuthoritativePath, g3ProductionCommand, mirrorG3Ack, isG3ProductionDomainActive } =
        await import('@/lib/production/g3ServerClient')
      if (
        isG3WebAuthoritativePath() &&
        isG3ProductionDomainActive(
          // production may not be on warehouse slice store — read via getStore if available
          (typeof getStore === 'function'
            ? (getStore() as { production?: Record<string, unknown> }).production
            : undefined) as Record<string, unknown>,
        )
      ) {
        const server = await g3ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'production.material.issueToLine',
          command: {
            orderId: input.productionOrder.id,
            lineId: input.productionOrder.lineId,
            rawWarehouseId: input.rawWarehouseId,
            overReserveReason: input.overReserveReason,
            reason: input.overReserveReason || input.comment,
            lines: input.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate,
            })),
          },
        })
        if (!server.ok) return { ok: false, error: server.error || server.message }
        patchWarehouse(
          setStore,
          (w) => {
            const mirrored = mirrorG3Ack(w, {}, {
              warehouse: server.data.warehouse,
              production: server.data.production,
              criticalRevision: server.data.criticalRevision,
            })
            return mirrored.warehouse
          },
          {
            origin: 'user',
            atomic: true,
            transactionGroupId: warehouseTransactionGroupId({
              kind: 'production_material_transfer',
              sourceId: input.productionOrder.id,
              revision: String(server.data.criticalRevision ?? 1),
            }),
            transactionGroupKind: 'production_material_transfer',
            transactionGroupLabel: 'G3 issue to line',
          },
        )
        return {
          ok: true,
          documentIds: (server.data as { documentIds?: string[] }).documentIds,
          idempotent: server.data.idempotent,
        }
      }

      let result: HandoffResult = { ok: false, error: 'unknown' }
      const kind = input.overReserveReason?.trim()
        ? 'production_over_reserve_issue'
        : 'production_material_transfer'
      const groupId =
        input.transactionGroupId ??
        warehouseTransactionGroupId({
          kind,
          sourceId: input.productionOrder.id,
          revision: input.idempotencyKey,
        })
      patchWarehouse(
        setStore,
        (w) => {
          const out = transferProductionMaterials(w, {
            ...input,
            transactionGroupId: groupId,
          })
          result = out.result
          return out.store
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: kind,
          transactionGroupLabel: input.overReserveReason?.trim()
            ? 'Выдача в производство сверх резерва'
            : 'Передача материалов в производство',
        },
      )
      return result
    },

    async returnProductionOrderMaterials(input: ProductionMaterialReturnInput): Promise<HandoffResult> {
      const { isG3WebAuthoritativePath, g3ProductionCommand, mirrorG3Ack, isG3ProductionDomainActive } =
        await import('@/lib/production/g3ServerClient')
      if (
        isG3WebAuthoritativePath() &&
        isG3ProductionDomainActive(
          // production may not be on warehouse slice store — read via getStore if available
          (typeof getStore === 'function'
            ? (getStore() as { production?: Record<string, unknown> }).production
            : undefined) as Record<string, unknown>,
        )
      ) {
        const server = await g3ProductionCommand({
          idempotencyKey: input.idempotencyKey,
          commandType: 'production.material.returnFromLine',
          command: {
            orderId: input.productionOrder.id,
            lineId: input.productionOrder.lineId,
            rawWarehouseId: input.rawWarehouseId,
            reason: input.returnReason,
            lines: input.lines.map((l) => ({
              itemId: l.itemId,
              quantity: l.quantity,
              batchNo: l.batchNo,
              expiryDate: l.expiryDate,
            })),
          },
        })
        if (!server.ok) return { ok: false, error: server.error || server.message }
        patchWarehouse(
          setStore,
          (w) => {
            const mirrored = mirrorG3Ack(w, {}, {
              warehouse: server.data.warehouse,
              production: server.data.production,
              criticalRevision: server.data.criticalRevision,
            })
            return mirrored.warehouse
          },
          {
            origin: 'user',
            atomic: true,
            transactionGroupId: warehouseTransactionGroupId({
              kind: 'production_material_return',
              sourceId: input.productionOrder.id,
              revision: String(server.data.criticalRevision ?? 1),
            }),
            transactionGroupKind: 'production_material_return',
            transactionGroupLabel: 'G3 return from line',
          },
        )
        return {
          ok: true,
          documentIds: (server.data as { documentIds?: string[] }).documentIds,
          idempotent: server.data.idempotent,
        }
      }

      let result: HandoffResult = { ok: false, error: 'unknown' }
      const groupId =
        input.transactionGroupId ??
        warehouseTransactionGroupId({
          kind: 'production_material_return',
          sourceId: input.productionOrder.id,
          revision: input.idempotencyKey,
        })
      patchWarehouse(
        setStore,
        (w) => {
          const out = returnProductionMaterials(w, {
            ...input,
            transactionGroupId: groupId,
          })
          result = out.result
          return out.store
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'production_material_return',
          transactionGroupLabel: 'Возврат материалов из производства',
        },
      )
      return result
    },

    upsertProductionLineLocationBinding(
      binding: Omit<ProductionLineLocationBinding, 'id'> & { id?: string },
    ) {
      patchWarehouse(setStore, (w) => upsertProductionLineBinding(w, binding))
    },

    async cancelWarehouseDocument(
      documentId: string,
      args?: { cancelledBy?: string; cancelledByName?: string; reason?: string },
    ): Promise<CancelDocumentResult> {
      const currentForG4 = getStore()
      const loadingShipmentForG4 = currentForG4.warehouse.loadingShipments?.find((shipment) => {
        if (shipment.postedDocumentId === documentId) return true
        const docIds = (shipment as { documentIds?: string[] }).documentIds
        return Array.isArray(docIds) && docIds.includes(documentId)
      })
      if (loadingShipmentForG4) {
        const { isG5SalesPlanningActive } = await import('@/lib/planner/g5Activation')
        if (isG5SalesPlanningActive(currentForG4)) {
          const { isG5WebPath, g5SalesShipmentCancel, mirrorG5Ack } = await import(
            '@/lib/planner/g5ServerClient'
          )
          if (isG5WebPath()) {
            const reason = args?.reason?.trim()
            if (!reason) return { ok: false, error: 'warehouse.doc.errCancelReasonRequired' }
            const server = await g5SalesShipmentCancel({
              idempotencyKey: `g5-ship-cancel-${loadingShipmentForG4.id}`,
              command: {
                shipmentId: loadingShipmentForG4.id,
                reason,
                cancellationReason: reason,
              },
            })
            if (!server.ok) return { ok: false, error: server.error || server.message }
            setStore((s) => mirrorG5Ack(s, server.data), { origin: 'system' })
            const reversalIds = Array.isArray(
              (server.data as { reversalDocumentIds?: string[] }).reversalDocumentIds,
            )
              ? ((server.data as { reversalDocumentIds?: string[] }).reversalDocumentIds as string[])
              : []
            return { ok: true, reversalIds }
          }
        }
        const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
          await import('@/lib/production/g4ServerClient')
        if (
          isG4WebAuthoritativePath() &&
          isG4PackagingQcActive(currentForG4.production as unknown as Record<string, unknown>)
        ) {
          const reason = args?.reason?.trim()
          if (!reason) return { ok: false, error: 'warehouse.doc.errCancelReasonRequired' }
          const server = await g4ProductionCommand({
            idempotencyKey: `g4-ship-cancel-${loadingShipmentForG4.id}`,
            commandType: 'shipment.cancel',
            command: {
              shipmentId: loadingShipmentForG4.id,
              reason,
              cancellationReason: reason,
            },
          })
          if (!server.ok) return { ok: false, error: server.error || server.message }
          setStore((s) => {
            const mirrored = mirrorG4Ack(
              s.warehouse,
              s.production as unknown as Record<string, unknown>,
              {
                warehouse: server.data.warehouse,
                production: server.data.production,
                criticalRevision: server.data.criticalRevision,
                packagingQcActive: server.data.packagingQcActive ?? true,
                productionActive: server.data.productionActive,
              },
            )
            let next = {
              ...s,
              warehouse: mirrored.warehouse,
              production: {
                ...s.production,
                ...(mirrored.production as typeof s.production),
              },
            }
            if (loadingShipmentForG4.salesOrderId) {
              next = syncSalesOrderLoadingInStore(next, loadingShipmentForG4.salesOrderId)
            }
            return next
          })
          const reversalIds = Array.isArray(
            (server.data as { reversalDocumentIds?: string[]; reversalIds?: string[] }).reversalDocumentIds,
          )
            ? ((server.data as { reversalDocumentIds?: string[] }).reversalDocumentIds as string[])
            : Array.isArray((server.data as { reversalIds?: string[] }).reversalIds)
              ? ((server.data as { reversalIds?: string[] }).reversalIds as string[])
              : []
          return { ok: true, reversalIds }
        }
      }

      if (isG2WebAuthoritativePath()) {
        const reason = args?.reason?.trim()
        if (!reason) return { ok: false, error: 'warehouse.doc.errCancelReasonRequired' }
        const server = await g2WarehouseCommand({
          idempotencyKey: `g2-cancel-${documentId}`,
          commandType: 'warehouse.document.cancel',
          command: { documentId, reason },
        })
        if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
        patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
        const reversalIds = Array.isArray((server.data as { reversalIds?: string[] }).reversalIds)
          ? ((server.data as { reversalIds?: string[] }).reversalIds as string[])
          : []
        return { ok: true, reversalIds }
      }
      let result: CancelDocumentResult = { ok: false, error: 'unknown' }
      const current = getStore()
      const existing = current.warehouse.documents.find((d) => d.id === documentId)
      const loadingShipment = current.warehouse.loadingShipments?.find(
        (shipment) => shipment.postedDocumentId === documentId,
      )
      const pairId = existing?.transferPairId
      const groupKind = cancelWarehouseDocumentGroupKind(
        documentId,
        existing,
        loadingShipment?.postedDocumentId,
      )
      const groupId = warehouseTransactionGroupId({
        kind: groupKind,
        sourceId: groupKind === 'cancel_transfer_pair' ? pairId ?? documentId : documentId,
        revision: 'cancel',
      })
      const groupMeta = {
        origin: 'user' as const,
        atomic: true as const,
        transactionGroupId: groupId,
        transactionGroupKind: groupKind,
        transactionGroupLabel:
          groupKind === 'finished_goods_shipment_cancel'
            ? 'Сторно отгрузки ГП'
            : groupKind === 'cancel_transfer_pair'
              ? 'Отмена пары перемещения'
              : 'Сторно складского документа',
      }
      setStore((s) => {
        const out = cancelWarehouseDocument(s.warehouse, documentId, {
          ...(args ?? {}),
          transactionGroupId: groupId,
        })
        result = out.result
        if (!out.result.ok) return s

        let next = { ...s, warehouse: out.store }
        if (loadingShipment) {
          const usages = resolveLoadingShipmentLotUsages(
            loadingShipment.lines,
            next.production.finishedGoodsLots ?? [],
          )
          if (!usages.ok) {
            result = { ok: false, error: usages.error }
            return s
          }

          const lotsById = new Map(
            (next.production.finishedGoodsLots ?? []).map((lot) => [lot.id, lot]),
          )
          for (const usage of usages.usages) {
            const lot = lotsById.get(usage.lotId)
            if (!lot) continue
            lotsById.set(usage.lotId, reverseShipmentOnLot(lot, usage.quantity))
          }

          next = {
            ...next,
            production: {
              ...next.production,
              finishedGoodsLots: [...lotsById.values()],
            },
            warehouse: {
              ...next.warehouse,
              loadingShipments: (next.warehouse.loadingShipments ?? []).map((shipment) =>
                shipment.id === loadingShipment.id
                  ? {
                      ...shipment,
                      status: 'draft',
                      postedAt: undefined,
                      postedDocumentId: undefined,
                    }
                  : shipment,
              ),
            },
          }

          if (loadingShipment.salesOrderId) {
            next = syncSalesOrderLoadingInStore(next, loadingShipment.salesOrderId)
          }
        }

        return next
      }, groupMeta)
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

    async postWarehouseInventoryRevision(args: Parameters<typeof postInventoryRevision>[1]) {
      if (!isG2WebAuthoritativePath()) {
        let result = { applied: 0, skipped: 0, unchanged: 0 }
        patchWarehouse(setStore, (w) => {
          const out = postInventoryRevision(w, args)
          result = out.result
          return out.store
        })
        return result
      }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-inv-${args.warehouseId}-${args.date}-${crypto.randomUUID()}`,
        commandType: 'warehouse.inventory.post',
        command: {
          warehouseId: args.warehouseId,
          date: args.date,
          comment: args.comment,
          lines: args.lines.map((l) => ({ itemId: l.itemId, counted: l.counted })),
        },
      })
      if (!server.ok) {
        return {
          applied: 0,
          skipped: args.lines.length,
          unchanged: 0,
          error: server.error || 'warehouse.g2.errServer',
        }
      }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      const applied = Number((server.data as { applied?: number }).applied ?? 0)
      return { applied, skipped: 0, unchanged: Math.max(0, args.lines.length - applied) }
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

    async postOpeningInventory(
      input: OpeningInventoryDraftInput & { documentId?: string },
      actor?: { actorId?: string; actorName?: string },
    ): Promise<PostDocumentResult> {
      if (!isG2WebAuthoritativePath()) {
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
      }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-opening-${input.warehouseId}`,
        commandType: 'warehouse.opening.post',
        command: {
          warehouseId: input.warehouseId,
          date: input.date,
          lines: input.lines.map((l) => ({
            itemId: l.itemId,
            quantity: l.countedQty,
            inputUnit: l.inputUnit,
          })),
          documentId: input.documentId,
        },
      })
      if (!server.ok) return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return { ok: true, documentId: String(server.data.documentId ?? '') }
    },

    async importWarehouseExcel(file: File, warehouseId?: string) {
      const imported = await importWarehouseFromExcel(
        file,
        getStore().warehouse,
        warehouseId,
      )
      if (!isG2WebAuthoritativePath()) {
        if (imported.result.draftsCreated > 0) {
          setStore((s) => ({ ...s, warehouse: imported.store }))
        }
        return imported.result
      }
      // Server path: send only draft receipts; never post movements from Excel.
      const draftReceipts = (imported.store.documents ?? [])
        .filter((d) => d.status === 'draft' && d.type === 'receipt')
        .filter((d) => !(getStore().warehouse.documents ?? []).some((x) => x.id === d.id))
      if (draftReceipts.length === 0) return imported.result
      const whId = warehouseId || draftReceipts[0]?.warehouseId
      if (!whId) return imported.result
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-excel-${file.name}-${file.size}-${file.lastModified}`,
        commandType: 'warehouse.excel.importDrafts',
        command: {
          warehouseId: whId,
          date: draftReceipts[0]?.date,
          receipts: draftReceipts.map((d) => ({
            lines: d.lines,
            comment: d.comment ?? `excel:${file.name}`,
          })),
        },
      })
      if (!server.ok) {
        return {
          ...imported.result,
          draftsCreated: 0,
          error: server.error || 'warehouse.g2.errServer',
        }
      }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return {
        ...imported.result,
        draftsCreated: Number((server.data as { count?: number }).count ?? draftReceipts.length),
      }
    },

    setWarehouseStore(warehouse: WarehouseStore) {
      setStore((s) => ({ ...s, warehouse }))
    },

    async setWarehouseMonthClosed(month: string, closed: boolean, reason?: string) {
      if (!isG2WebAuthoritativePath()) {
        patchWarehouse(setStore, (w) => ({
          ...w,
          closedMonths: toggleClosedMonth(w.closedMonths, month, closed),
        }))
        return { ok: true as const }
      }
      if (closed) {
        const server = await g2WarehouseCommand({
          idempotencyKey: `g2-period-close-${month}`,
          commandType: 'warehouse.period.close',
          command: { month },
        })
        if (!server.ok) return { ok: false as const, error: server.error }
        patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
        return { ok: true as const }
      }
      const reopenReason = String(reason ?? '').trim()
      if (!reopenReason) return { ok: false as const, error: 'reopen_reason_required' }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-period-reopen-${month}-${reopenReason.slice(0, 24)}`,
        commandType: 'warehouse.period.reopen',
        command: { month, reason: reopenReason },
      })
      if (!server.ok) return { ok: false as const, error: server.error }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return { ok: true as const }
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

    async postDailyIssueSession(
      sessionId: string,
      options?: { allowNegativeStock?: boolean },
    ) {
      if (!isG2WebAuthoritativePath()) {
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
      }
      const session = getStore().warehouse.dailyIssueSessions?.find((s) => s.id === sessionId)
      if (!session) return { ok: false as const, reason: 'not_found' as const }
      const lines = (session.lines ?? [])
        .filter((l) => Number(l.quantity) > 0)
        .map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.quantity),
          lineId: crypto.randomUUID(),
        }))
      if (lines.length === 0) return { ok: false as const, reason: 'empty' as const }
      const server = await g2WarehouseCommand({
        idempotencyKey: `g2-daily-${sessionId}`,
        commandType: 'warehouse.dailyIssue.post',
        command: {
          sessionId,
          warehouseId: session.warehouseId,
          date: session.date,
          lines,
        },
      })
      if (!server.ok) {
        return { ok: false as const, reason: 'stock' as const, detail: server.error }
      }
      patchWarehouse(setStore, (w) => mirrorG2WarehouseAck(w, server.data.warehouse))
      return {
        ok: true as const,
        documentId: String(server.data.documentId ?? ''),
        documentNumber: String((server.data as { number?: string }).number ?? ''),
      }
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

    async postLoadingShipment(
      shipmentId: string,
      args?: { keeperId?: string; keeperName?: string },
    ) {
      const storeNow = getStore()
      const { isG5SalesPlanningActive } = await import('@/lib/planner/g5Activation')
      if (isG5SalesPlanningActive(storeNow)) {
        const { isG5WebPath, g5SalesShipmentPost, mirrorG5Ack } = await import(
          '@/lib/planner/g5ServerClient'
        )
        if (isG5WebPath()) {
          const shipment = storeNow.warehouse.loadingShipments?.find((s) => s.id === shipmentId)
          if (!shipment) {
            return { ok: false as const, error: 'warehouse.loading.errNotFound' }
          }
          const lots = storeNow.production.finishedGoodsLots ?? []
          const usages = resolveLoadingShipmentLotUsages(shipment.lines, lots)
          if (!usages.ok) return { ok: false as const, error: usages.error }
          if (usages.usages.length === 0) {
            return { ok: false as const, error: 'warehouse.loading.errEmpty' }
          }
          let lastNumber = shipment.number
          for (const usage of usages.usages) {
            const lot = lots.find((l) => l.id === usage.lotId)
            if (!lot) return { ok: false as const, error: 'production.ship.errLotRequired' }
            const lineShipmentId =
              usages.usages.length === 1 ? shipmentId : `${shipmentId}::${usage.lineId}`
            const server = await g5SalesShipmentPost({
              idempotencyKey: `g5-ship-post-${lineShipmentId}`,
              command: {
                shipmentId: lineShipmentId,
                finishedProductId: lot.finishedProductId,
                finishedGoodsLotId: usage.lotId,
                lotId: usage.lotId,
                quantity: usage.quantity,
                warehouseId: shipment.warehouseId || lot.warehouseId,
                salesOrderId: shipment.salesOrderId,
                date: shipment.date,
                counterpartyId: shipment.counterpartyId,
                keeperId: args?.keeperId ?? shipment.keeperId,
                keeperName: args?.keeperName ?? shipment.keeperName,
              },
            })
            if (!server.ok) {
              return { ok: false as const, error: server.error || server.message }
            }
            setStore((s) => mirrorG5Ack(s, server.data), { origin: 'system' })
            lastNumber =
              (server.data as { number?: string }).number ??
              String((server.data as { shipmentId?: string }).shipmentId ?? lastNumber)
          }
          return { ok: true as const, number: lastNumber }
        }
      }

      const { isG4WebAuthoritativePath, g4ProductionCommand, mirrorG4Ack, isG4PackagingQcActive } =
        await import('@/lib/production/g4ServerClient')
      if (
        isG4WebAuthoritativePath() &&
        isG4PackagingQcActive(getStore().production as unknown as Record<string, unknown>)
      ) {
        const shipment = getStore().warehouse.loadingShipments?.find((s) => s.id === shipmentId)
        if (!shipment) {
          return { ok: false as const, error: 'warehouse.loading.errNotFound' }
        }
        const lots = getStore().production.finishedGoodsLots ?? []
        const usages = resolveLoadingShipmentLotUsages(shipment.lines, lots)
        if (!usages.ok) return { ok: false as const, error: usages.error }
        if (usages.usages.length === 0) {
          return { ok: false as const, error: 'warehouse.loading.errEmpty' }
        }

        let lastNumber = shipment.number
        for (const usage of usages.usages) {
          const lot = lots.find((l) => l.id === usage.lotId)
          if (!lot) return { ok: false as const, error: 'production.ship.errLotRequired' }
          const lineShipmentId =
            usages.usages.length === 1 ? shipmentId : `${shipmentId}::${usage.lineId}`
          const server = await g4ProductionCommand({
            idempotencyKey: `g4-ship-post-${lineShipmentId}`,
            commandType: 'shipment.post',
            command: {
              shipmentId: lineShipmentId,
              finishedProductId: lot.finishedProductId,
              finishedGoodsLotId: usage.lotId,
              lotId: usage.lotId,
              quantity: usage.quantity,
              warehouseId: shipment.warehouseId || lot.warehouseId,
              salesOrderId: shipment.salesOrderId,
              date: shipment.date,
              counterpartyId: shipment.counterpartyId,
              keeperId: args?.keeperId ?? shipment.keeperId,
              keeperName: args?.keeperName ?? shipment.keeperName,
            },
          })
          if (!server.ok) {
            return { ok: false as const, error: server.error || server.message }
          }
          setStore((s) => {
            const mirrored = mirrorG4Ack(
              s.warehouse,
              s.production as unknown as Record<string, unknown>,
              {
                warehouse: server.data.warehouse,
                production: server.data.production,
                criticalRevision: server.data.criticalRevision,
                packagingQcActive: server.data.packagingQcActive ?? true,
                productionActive: server.data.productionActive,
              },
            )
            let next = {
              ...s,
              warehouse: mirrored.warehouse,
              production: {
                ...s.production,
                ...(mirrored.production as typeof s.production),
              },
            }
            if (shipment.salesOrderId) {
              next = syncSalesOrderLoadingInStore(next, shipment.salesOrderId)
              next = markSalesOrderShippedIfFullyLoaded(next, shipment.salesOrderId)
            }
            return next
          })
          lastNumber =
            (server.data as { number?: string }).number ??
            server.data.shipmentId ??
            lastNumber
        }
        return { ok: true as const, number: lastNumber }
      }

      let result: ReturnType<typeof postLoadingShipment>['result'] = {
        ok: false,
        error: 'warehouse.loading.errNotFound',
      }
      const groupId = warehouseTransactionGroupId({
        kind: 'finished_goods_shipment',
        sourceId: shipmentId,
        revision: 'post',
      })
      setStore((s) => {
        const out = postLoadingShipment(
          s.warehouse,
          shipmentId,
          args,
          s.production.finishedGoodsLots ?? [],
        )
        result = out.result
        if (!out.result.ok) return s
        let next = { ...s, warehouse: out.store }
        if (out.result.lotUsages?.length) {
          const lotsById = new Map((next.production.finishedGoodsLots ?? []).map((lot) => [lot.id, lot]))
          for (const usage of out.result.lotUsages) {
            const lot = lotsById.get(usage.lotId)
            if (!lot) continue
            lotsById.set(usage.lotId, applyShipmentToLot(lot, usage.quantity))
          }
          next = {
            ...next,
            production: {
              ...next.production,
              finishedGoodsLots: [...lotsById.values()],
            },
          }
        }
        const shipment = out.store.loadingShipments?.find((x) => x.id === shipmentId)
        if (shipment?.salesOrderId) {
          next = syncSalesOrderLoadingInStore(next, shipment.salesOrderId)
          next = markSalesOrderShippedIfFullyLoaded(next, shipment.salesOrderId)
        }
        return next
      }, {
        origin: 'user',
        atomic: true,
        transactionGroupId: groupId,
        transactionGroupKind: 'finished_goods_shipment',
        transactionGroupLabel: 'Отгрузка готовой продукции',
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

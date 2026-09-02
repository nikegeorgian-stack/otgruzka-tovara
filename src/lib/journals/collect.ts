import type { AppStore } from '@/lib/types'
import { getFinance } from '@/lib/finance/calc'
import { documentLineTotal, listAdvanceDocuments } from '@/lib/finance/advanceDocuments'
import {
  accrualLineTotal,
  listAdvanceAccruals,
} from '@/lib/finance/advanceAccrual'
import {
  documentLineTotal as payoutLineTotal,
  listPayoutDocuments,
} from '@/lib/finance/payoutDocuments'
import { formatMixDate } from '@/lib/formulations/cubeLabel'
import type { PurchaseOrder, PurchaseOrderStatusChange } from '@/lib/procurement/types'
import { resolveCounterpartyDisplayName } from '@/lib/warehouse/documentValidation'
import { warehouseItemDisplayName } from '@/lib/warehouse/technicalName'
import {
  AUDIT_ACTION_LABEL,
  AUDIT_DOC_TYPE_KEY,
  classifyAuditEntry,
} from './classifyAudit'
import type {
  JournalCategory,
  JournalCategoryCounts,
  JournalLink,
  UnifiedJournalEntry,
} from './types'

function push(out: UnifiedJournalEntry[], entry: UnifiedJournalEntry) {
  out.push(entry)
}

function itemName(store: AppStore, itemId?: string): string {
  if (!itemId) return ''
  const item = store.warehouse.items.find((i) => i.id === itemId)
  return item ? warehouseItemDisplayName(item) : itemId.slice(0, 8)
}

function inventoryDocumentPreview(
  store: AppStore,
  document: AppStore['warehouse']['documents'][number],
): string {
  if (document.type !== 'inventory' || document.lines.length === 0) return ''
  const itemById = new Map(store.warehouse.items.map((item) => [item.id, item]))
  const preview = document.lines.slice(0, 3).map((line) => {
    const item = itemById.get(line.itemId)
    return `${item?.name ?? line.itemId}: ${line.quantity}${item?.unit ? ` ${item.unit}` : ''}`
  })
  const more =
    document.lines.length > preview.length ? `; +${document.lines.length - preview.length}` : ''
  return ` · ${preview.join('; ')}${more}`
}

function employeeName(store: AppStore, id?: string): string | undefined {
  if (!id) return undefined
  return store.employees.find((e) => e.id === id)?.fullName
}

/** Ссылка на приходный документ склада при приёмке заказа закупки */
function resolveProcurementReceiptLink(
  store: AppStore,
  order: PurchaseOrder,
  h: PurchaseOrderStatusChange,
): JournalLink | undefined {
  if (h.warehouseDocumentId) {
    const doc = store.warehouse.documents.find((d) => d.id === h.warehouseDocumentId)
    if (doc) return { kind: 'warehouse_document', documentId: doc.id }
  }
  const note = h.note ?? ''
  const m = note.match(/^Приход\s+(\S+)/)
  if (!m) return undefined
  const doc = store.warehouse.documents.find(
    (d) => d.number === m[1] && d.comment === order.orderNumber && d.type === 'receipt',
  )
  if (doc) return { kind: 'warehouse_document', documentId: doc.id }
  return undefined
}

const TIMESHEET_CATEGORIES: JournalCategory[] = [
  'timesheet',
  'finance',
  'hr',
  'access',
  'directories',
]

const MOVEMENT_TYPE: Record<string, string> = {
  receipt: 'Приход',
  issue: 'Расход',
  adjustment: 'Корректировка',
  reserve: 'Резерв',
  unreserve: 'Снятие резерва',
  inventory: 'Инвентаризация',
}

export function collectJournalEntries(
  store: AppStore,
  categories: JournalCategory[],
  opts?: {
    viewerUserId?: string
    viewerRoleId?: import('@/lib/access/types').AccessRoleId
    /** null/undefined = весь завод; массив = только эти бригады */
    viewerBrigades?: string[] | null
  },
): UnifiedJournalEntry[] {
  const allowed = new Set(categories)
  const out: UnifiedJournalEntry[] = []
  const locale = store.settings.locale

  if (TIMESHEET_CATEGORIES.some((c) => allowed.has(c))) {
    for (const e of store.auditLog) {
      const category = classifyAuditEntry(e)
      if (!allowed.has(category)) continue

      let link: UnifiedJournalEntry['link']
      if (e.month && (category === 'timesheet' || category === 'finance')) {
        link = { kind: 'month', month: e.month }
      } else if (e.employeeId && category === 'hr') {
        link = { kind: 'hr', employeeId: e.employeeId }
      } else if (
        e.action === 'meals_order' ||
        e.action === 'meals_accept' ||
        e.action === 'meals_unaccept' ||
        e.action === 'meals_catalog' ||
        e.action === 'meals_week' ||
        e.action === 'meals_advance'
      ) {
        link = { kind: 'meals' }
      } else if (
        e.action === 'directory_change' ||
        e.action === 'brigade_rename' ||
        e.action === 'counterparty_upsert' ||
        e.action === 'counterparty_remove' ||
        e.action === 'finished_product_upsert' ||
        e.action === 'finished_product_remove'
      ) {
        link = { kind: 'directories' }
      }

      push(out, {
        id: `audit-${category}-${e.id}`,
        category,
        at: e.at,
        title: AUDIT_ACTION_LABEL[e.action] ?? e.action,
        detail: e.detail,
        actor: e.byName ?? (e.by ? employeeName(store, e.by) : undefined),
        actorId: e.by,
        entryKind: 'event',
        refId: e.month ?? e.employeeId,
        docDate: e.dateKey ?? e.month ?? e.at.slice(0, 10),
        docNumber:
          e.action === 'month_close' || e.action === 'month_reopen' || e.action === 'bulk'
            ? e.month
            : undefined,
        docTypeKey: AUDIT_DOC_TYPE_KEY[category],
        docStatus: e.action,
        mode: 'view',
        link,
      })
    }

    if (allowed.has('timesheet') || allowed.has('access')) {
      const nameById = new Map(
        store.access.users.map((u) => [u.id, u.displayName] as const),
      )
      const category: JournalCategory = allowed.has('timesheet') ? 'timesheet' : 'access'
      for (const c of store.access.workshopMasterCoverages ?? []) {
        const cover = nameById.get(c.coverUserId) ?? c.coverUserId
        const absent = nameById.get(c.absentUserId) ?? c.absentUserId
        push(out, {
          id: `coverage-doc-${c.id}`,
          category,
          at: c.postedAt ?? c.endedAt ?? c.createdAt,
          title: c.number,
          detail: `${cover} ← ${absent} · ${c.fromDate}…${c.toDate} · ${c.brigades.join(', ')}`,
          actor: c.postedByName ?? c.createdByName,
          actorId: c.postedBy ?? c.createdBy,
          entryKind: 'document',
          refId: c.id,
          docDate: c.fromDate,
          docNumber: c.number,
          docTypeKey: 'coverage.docType',
          docStatus: c.status,
          mode: 'view',
          link: { kind: 'month', month: c.fromDate.slice(0, 7) },
        })
      }
      for (const d of store.nightShifts?.documents ?? []) {
        push(out, {
          id: `night-shift-doc-${d.id}`,
          category,
          at: d.postedAt ?? d.voidedAt ?? d.createdAt,
          title: d.number,
          detail: `${d.date} · ${d.employeeIds.length} чел.${
            d.note ? ` · ${d.note}` : ''
          }${
            d.reasons && Object.keys(d.reasons).length
              ? ` · ${Object.values(d.reasons).filter(Boolean).slice(0, 3).join('; ')}`
              : ''
          } · ${(d.brigades?.length ? d.brigades : d.groups).join(', ')}`,
          actor: d.postedByName ?? d.createdByName,
          actorId: d.postedBy ?? d.createdBy,
          entryKind: 'document',
          refId: d.id,
          docDate: d.date,
          docNumber: d.number,
          docTypeKey: 'nightShift.docType',
          docStatus: d.status,
          mode: d.status === 'draft' ? 'edit' : 'view',
          link: { kind: 'month', month: d.date.slice(0, 7) },
        })
      }
      for (const d of store.timesheetEntries?.documents ?? []) {
        if (d.status === 'draft') continue
        if (opts?.viewerRoleId === 'workshop_master' && opts.viewerUserId) {
          const isAuthor =
            d.createdBy === opts.viewerUserId || d.postedBy === opts.viewerUserId
          if (!isAuthor) {
            const scope = opts.viewerBrigades
            const marks = d.applied ?? d.changes
            const overlap =
              Array.isArray(scope) &&
              marks.some((m) => m.brigade && scope.includes(m.brigade))
            if (!overlap) continue
          }
        }
        const n = d.applied?.length ?? d.changes.length
        push(out, {
          id: `timesheet-entry-doc-${d.id}`,
          category,
          at: d.postedAt ?? d.voidedAt ?? d.createdAt,
          title: d.number,
          detail: `${d.month} · ${n} яч.${
            d.skipped ? ` · пропуск ${d.skipped}` : ''
          }${d.status === 'void' ? ' · аннулирован' : ''}`,
          actor: d.postedByName ?? d.createdByName,
          actorId: d.postedBy ?? d.createdBy,
          entryKind: 'document',
          refId: d.id,
          docDate: `${d.month}-01`,
          docNumber: d.number,
          docTypeKey: 'timesheetEntry.docType',
          docStatus: d.status,
          mode: 'view',
          link: {
            kind: 'timesheet_entry_document',
            documentId: d.id,
            month: d.month,
          },
        })
      }
    }

    if (allowed.has('finance')) {
      const fin = getFinance(store)
      for (const doc of listAdvanceDocuments(fin, { includeVoid: true })) {
        const total = documentLineTotal(doc.lines)
        push(out, {
          id: `fin-adv-doc-${doc.id}`,
          category: 'finance',
          at: doc.postedAt ?? doc.voidedAt ?? doc.readyAt ?? doc.at,
          title: doc.number,
          detail: `${doc.lines.length} чел. · ${total} ₾ · ${doc.method}${doc.status === 'void' ? ' · аннулирован' : ''}`,
          actor: doc.byName,
          actorId: doc.byId,
          entryKind: 'document',
          refId: doc.id,
          docDate: doc.date,
          docNumber: doc.number,
          docTypeKey: 'fin.advDoc.journalType',
          docStatus: doc.status,
          mode: doc.status === 'draft' ? 'edit' : 'view',
          link: {
            kind: 'finance_advance_document',
            documentId: doc.id,
            month: doc.month,
          },
        })
      }
      for (const doc of listPayoutDocuments(fin, { includeVoid: true })) {
        const total = payoutLineTotal(doc.lines)
        push(out, {
          id: `fin-pay-doc-${doc.id}`,
          category: 'finance',
          at: doc.postedAt ?? doc.voidedAt ?? doc.readyAt ?? doc.at,
          title: doc.number,
          detail: `${doc.lines.length} чел. · ${total} ₾ · ${doc.method}${doc.status === 'void' ? ' · аннулирован' : ''}`,
          actor: doc.byName,
          actorId: doc.byId,
          entryKind: 'document',
          refId: doc.id,
          docDate: doc.date,
          docNumber: doc.number,
          docTypeKey: 'fin.payout.journalType',
          docStatus: doc.status,
          mode: doc.status === 'draft' ? 'edit' : 'view',
          link: {
            kind: 'finance_payout_document',
            documentId: doc.id,
            month: doc.month,
          },
        })
      }
      for (const doc of listAdvanceAccruals(fin, { includeVoid: true })) {
        const total = accrualLineTotal(doc.lines)
        push(out, {
          id: `fin-accrual-${doc.id}`,
          category: 'finance',
          at: doc.postedAt ?? doc.voidedAt ?? doc.at,
          title: doc.number,
          detail: `${doc.lines.length} чел. · ${total} ₾${doc.status === 'void' ? ' · сторно' : ''}`,
          actor: doc.byName,
          actorId: doc.byId,
          entryKind: 'document',
          refId: doc.id,
          docDate: doc.at.slice(0, 10),
          docNumber: doc.number,
          docTypeKey: 'fin.accrual.journalType',
          docStatus: doc.status,
          mode: doc.status === 'draft' ? 'edit' : 'view',
          link: {
            kind: 'finance_accrual_document',
            documentId: doc.id,
            month: doc.month,
          },
        })
      }
    }
  }

  if (allowed.has('sales')) {
    for (const order of store.sales.orders) {
      push(out, {
        id: `so-doc-${order.id}`,
        category: 'sales',
        at: order.updatedAt || order.createdAt,
        title: order.orderNumber,
        detail: `${order.lines.length} поз.${order.dueDate ? ` · срок ${order.dueDate}` : ''}${order.note ? ` · ${order.note}` : ''}`,
        actor: undefined,
        entryKind: 'document',
        refId: order.id,
        docDate: order.orderDate,
        docNumber: order.orderNumber,
        docTypeKey: 'journals.docType.salesOrder',
        docStatus: order.status,
        counterpartyName: order.customer || undefined,
        mode: order.status === 'draft' ? 'edit' : 'view',
        link: { kind: 'sales_order', orderId: order.id },
      })
      for (const h of order.history) {
        push(out, {
          id: `so-${order.id}-${h.id}`,
          category: 'sales',
          at: h.at,
          title: order.orderNumber,
          detail: h.message,
          actor: order.customer || undefined,
          entryKind: 'event',
          refId: order.id,
          docDate: order.orderDate,
          docNumber: order.orderNumber,
          docTypeKey: 'journals.docType.salesOrder',
          docStatus: order.status,
          counterpartyName: order.customer || undefined,
          mode: order.status === 'draft' ? 'edit' : 'view',
          link: { kind: 'sales_order', orderId: order.id },
        })
      }
    }
  }

  if (allowed.has('production')) {
    for (const r of store.production.requests) {
      const at = r.savedAt ?? r.createdAt
      const foreman = r.foremanId ? employeeName(store, r.foremanId) : undefined
      const line =
        r.lineId === 'pack' ? 'Упаковка' : r.lineId === '2' ? 'Линия 2' : 'Линия 1'
      push(out, {
        id: `prod-${r.id}`,
        category: 'production',
        at,
        title: `Заявка · ${line}`,
        detail: `${r.date} · ${r.brigadeName}${r.plannerSourceNote ? ` · ${r.plannerSourceNote}` : ''} · ${r.status}`,
        actor: foreman,
        refId: r.id,
        docDate: r.date,
        docNumber: r.id.slice(0, 8),
        docStatus: r.status,
        mode: r.status === 'draft' ? 'edit' : 'view',
        link: { kind: 'production_request', requestId: r.id },
      })
    }

    for (const d of store.warehouse.documents) {
      if (!d.productionRequestId || (d.status ?? 'posted') === 'draft') continue
      push(out, {
        id: `prod-wh-d-${d.id}`,
        category: 'production',
        at: d.postedAt ?? d.createdAt,
        title: `Склад · ${d.number}`,
        detail: `Документ · ${d.lines.length} поз.${d.comment ? ` · ${d.comment}` : ''}`,
        actor: d.keeperName ?? d.postedByName,
        refId: d.productionRequestId,
        docDate: d.date,
        docNumber: d.number,
        docStatus: d.status ?? 'posted',
        mode: 'view',
        link: { kind: 'production_request', requestId: d.productionRequestId },
      })
    }

    for (const e of store.warehouse.auditLog) {
      if (e.action !== 'document_post' || !e.detail.includes('Производство')) continue
      let requestId = e.productionRequestId
      if (!requestId) {
        const m = e.detail.match(/Производство (\d{4}-\d{2}-\d{2}) линия (\S+)/)
        if (m) {
          const [, date, lineToken] = m
          const req = store.production.requests.find(
            (r) => r.date === date && String(r.lineId) === lineToken && r.status === 'posted',
          )
          requestId = req?.id
        }
      }
      push(out, {
        id: `prod-wh-a-${e.id}`,
        category: 'production',
        at: e.at,
        title: 'Проводка в склад',
        detail: e.detail,
        actor: e.actorName,
        refId: requestId,
        docDate: e.at.slice(0, 10),
        mode: 'view',
        link: requestId ? { kind: 'production_request', requestId } : undefined,
      })
    }
  }

  if (allowed.has('warehouse_audit')) {
    for (const e of store.warehouse.auditLog) {
      push(out, {
        id: `wh-a-${e.id}`,
        category: 'warehouse_audit',
        at: e.at,
        title: e.action,
        detail: e.detail,
        actor: e.actorName,
        entryKind: 'event',
        refId: e.itemId ?? e.productionRequestId ?? e.batchRunId,
      })
    }
  }

  if (allowed.has('warehouse_movements')) {
    for (const m of store.warehouse.movements) {
      push(out, {
        id: `wh-m-${m.id}`,
        category: 'warehouse_movements',
        at: m.createdAt,
        title: MOVEMENT_TYPE[m.type] ?? m.type,
        detail: `${itemName(store, m.itemId)} · ${m.quantity} · ${m.date}${m.comment ? ` · ${m.comment}` : ''}`,
        entryKind: 'event',
        refId: m.id,
        docDate: m.date,
        docNumber: m.documentNo,
        docTypeKey: 'journals.category.warehouse_movements',
        link: m.documentId
          ? { kind: 'warehouse_document', documentId: m.documentId }
          : undefined,
        mode: 'view',
      })
    }
  }

  if (allowed.has('warehouse_documents')) {
    const counterparties = store.counterparties?.items ?? []
    for (const d of store.warehouse.documents) {
      const status = d.status ?? 'posted'
      const typeKey =
        d.type === 'inventory'
          ? 'warehouse.doc.type.inventory'
          : d.type === 'receipt'
            ? 'warehouse.receipt'
            : 'warehouse.issue'
      const counterpartyName = resolveCounterpartyDisplayName(d, counterparties, '') || undefined
      push(out, {
        id: `wh-d-${d.id}`,
        category: 'warehouse_documents',
        at: d.postedAt ?? d.createdAt,
        title: d.number,
        detail: `${d.lines.length} поз.${inventoryDocumentPreview(store, d)}${counterpartyName ? ` · ${counterpartyName}` : ''}${d.comment ? ` · ${d.comment}` : ''}`,
        actor: d.keeperName ?? d.postedByName,
        entryKind: 'document',
        refId: d.id,
        docDate: d.date,
        docNumber: d.number,
        docTypeKey: typeKey,
        docStatus: status,
        counterpartyName,
        mode: status === 'draft' ? 'edit' : 'view',
        link: { kind: 'warehouse_document', documentId: d.id },
      })
    }
  }

  if (allowed.has('warehouse_loading')) {
    for (const s of store.warehouse.loadingShipments ?? []) {
      push(out, {
        id: `wh-l-${s.id}`,
        category: 'warehouse_loading',
        at: s.postedAt ?? s.updatedAt,
        title: s.number,
        detail: `${s.counterpartyName} · ${s.lines.length} поз. · ${(s.totalsGrossKg / 1000).toFixed(3)} т${s.orderNo ? ` · ${s.orderNo}` : ''}`,
        actor: s.keeperName,
        entryKind: 'document',
        refId: s.id,
        docDate: s.date,
        docNumber: s.number,
        docTypeKey: 'journals.docType.loading',
        docStatus: s.status,
        counterpartyName: s.counterpartyName || undefined,
        mode: s.status === 'draft' ? 'edit' : 'view',
        link: { kind: 'warehouse_loading', shipmentId: s.id },
      })
    }
  }

  if (allowed.has('warehouse_nomenclature')) {
    for (const [itemId, history] of Object.entries(store.warehouse.itemHistories ?? {})) {
      for (const h of history) {
        push(out, {
          id: `wh-i-${h.id}`,
          category: 'warehouse_nomenclature',
          at: h.at,
          title: h.kind,
          detail: `${itemName(store, itemId)} · ${h.detail}`,
          actor: undefined,
          refId: itemId,
          docDate: h.at.slice(0, 10),
          mode: 'view',
          link: { kind: 'warehouse_item', itemId },
        })
      }
    }
    for (const r of store.warehouse.itemRequests ?? []) {
      push(out, {
        id: `wh-rq-${r.id}`,
        category: 'warehouse_nomenclature',
        at: r.createdAt,
        title: 'Заявка на номенклатуру',
        detail: `${r.name} · ${r.status}${r.note ? ` · ${r.note}` : ''}`,
        actor: r.requestedByName,
        refId: r.id,
      })
    }
    for (const r of store.warehouse.itemRenameRequests ?? []) {
      push(out, {
        id: `wh-rn-${r.id}`,
        category: 'warehouse_nomenclature',
        at: r.createdAt,
        title: 'Переименование номенклатуры',
        detail: `${r.proposedName} · ${r.status}`,
        actor: r.requestedByName,
        refId: r.itemId,
      })
    }
  }

  if (allowed.has('technologist_batch')) {
    for (const run of store.formulations.batchRuns ?? []) {
      push(out, {
        id: `tb-${run.id}`,
        category: 'technologist_batch',
        at: run.createdAt,
        title: `Замес ${run.documentNumber}`,
        detail: `${run.recipeCode} · ${run.targetVolumeL} л · ${formatMixDate(run.mixedAt, locale)} · ${run.mixedByName}`,
        actor: run.mixedByName,
        refId: run.id,
      })
    }
  }

  if (allowed.has('technologist_climate')) {
    for (const r of store.technologistQc.roomClimateLog) {
      push(out, {
        id: `tc-${r.id}`,
        category: 'technologist_climate',
        at: `${r.measuredDate}T${r.measuredTime || '00:00'}:00`,
        title: 't° / влажность',
        detail: `${r.temperatureC.toFixed(1)} °C · ${r.humidityPct.toFixed(0)} %${r.roomLabel ? ` · ${r.roomLabel}` : ''}`,
        actor: r.recordedByName,
        refId: r.id,
      })
    }
  }

  if (allowed.has('technologist_qc')) {
    const qc = store.technologistQc
    for (const r of qc.eadCalculations) {
      push(out, {
        id: `qc-ec-${r.id}`,
        category: 'technologist_qc',
        at: r.createdAt,
        title: 'EAD расчёт',
        detail: `${r.productType} · ${r.testedAt ?? r.manufacturedAt ?? ''}`,
        actor: r.createdByName,
        refId: r.id,
      })
    }
    for (const r of qc.eadControls) {
      push(out, {
        id: `qc-ect-${r.id}`,
        category: 'technologist_qc',
        at: r.createdAt,
        title: 'EAD контроль',
        detail: `${r.productType} · ${r.lineId} · ${r.manufacturedAt ?? ''}`,
        actor: r.createdByName,
        refId: r.id,
      })
    }
    for (const r of qc.incomingControls) {
      push(out, {
        id: `qc-in-${r.id}`,
        category: 'technologist_qc',
        at: r.createdAt,
        title: 'Входной контроль',
        detail: `${r.itemName} · ${r.controlDate ?? r.receiptDate ?? ''}`,
        actor: r.controllerName,
        refId: r.id,
      })
    }
    for (const r of qc.impregnationQc) {
      push(out, {
        id: `qc-im-${r.id}`,
        category: 'technologist_qc',
        at: r.createdAt,
        title: 'Контроль пропитки',
        detail: `${r.recipeCode ?? '—'} · ${r.batchNumber ?? ''} · ${r.computed?.status ?? ''}`,
        actor: r.controllerName,
        refId: r.id,
      })
    }
  }

  if (allowed.has('procurement')) {
    for (const order of store.procurement.orders) {
      for (const h of order.statusHistory) {
        const receiptLink = resolveProcurementReceiptLink(store, order, h)
        push(out, {
          id: `po-${order.id}-${h.id}`,
          category: 'procurement',
          at: h.at,
          title: order.orderNumber,
          detail: `${h.fromStatus ?? '—'} → ${h.toStatus}${h.note ? ` · ${h.note}` : ''}`,
          actor: undefined,
          refId: order.id,
          docDate: order.orderDate,
          docNumber: order.orderNumber,
          docTypeKey: receiptLink ? 'warehouse.receipt' : 'nav.procurement',
          docStatus: h.toStatus,
          mode: 'view',
          link: receiptLink ?? { kind: 'procurement_order', orderId: order.id },
        })
      }
    }
  }

  if (allowed.has('workwear')) {
    const catalog = new Map(store.workwear.catalog.map((c) => [c.id, c.name]))
    for (const iss of store.workwear.issuances) {
      const emp = employeeName(store, iss.employeeId)
      push(out, {
        id: `ww-${iss.id}`,
        category: 'workwear',
        at: iss.createdAt,
        title: `СИЗ · ${iss.documentNumber}`,
        detail: `${emp ?? iss.employeeId} · ${catalog.get(iss.itemId) ?? iss.itemId} · ${iss.size}${iss.quantity > 1 ? ` ×${iss.quantity}` : ''}`,
        actor: iss.issuedByName,
        refId: iss.employeeId,
      })
    }
  }

  if (allowed.has('it_office')) {
    const it = store.itOffice
    for (const act of it.acts) {
      if (act.status !== 'posted') continue
      push(out, {
        id: `it-a-${act.id}`,
        category: 'it_office',
        at: act.postedAt ?? act.updatedAt,
        title: act.number,
        detail: `${act.actType} · ${act.lines.length} поз.${act.comment ? ` · ${act.comment}` : ''}`,
        actor: act.issuedByName,
        refId: act.id,
        docDate: act.date,
        docNumber: act.number,
        docTypeKey: 'nav.it',
        docStatus: act.status,
        mode: 'view',
        link: { kind: 'it' },
      })
    }
    for (const iss of it.consumableIssues ?? []) {
      const spec = it.consumableSpecs.find((s) => s.id === iss.specId)
      push(out, {
        id: `it-c-${iss.id}`,
        category: 'it_office',
        at: iss.createdAt,
        title: spec?.name ?? iss.specId.slice(0, 8),
        detail: `${iss.qty} ${spec?.unit ?? ''}${iss.note ? ` · ${iss.note}` : ''}`,
        actor: iss.issuedByName,
        refId: iss.id,
        docDate: iss.date,
        docTypeKey: 'nav.it',
        mode: 'view',
        link: { kind: 'it' },
      })
    }
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export function countJournalEntriesByCategory(
  entries: UnifiedJournalEntry[],
): JournalCategoryCounts {
  const counts: JournalCategoryCounts = {}
  for (const e of entries) {
    counts[e.category] = (counts[e.category] ?? 0) + 1
  }
  return counts
}

export function filterJournalEntries(
  entries: UnifiedJournalEntry[],
  opts: {
    categories?: Set<JournalCategory>
    search?: string
    dateFrom?: string
    dateTo?: string
    docStatus?: string
    /** События не позже этого ISO-момента */
    asOfIso?: string
  },
): UnifiedJournalEntry[] {
  const q = opts.search?.trim().toLowerCase()
  const statusQ = opts.docStatus?.trim().toLowerCase()
  return entries.filter((e) => {
    if (opts.asOfIso && e.at > opts.asOfIso) return false
    if (opts.categories && opts.categories.size > 0 && !opts.categories.has(e.category)) {
      return false
    }
    const day = (e.docDate ?? e.at).slice(0, 10)
    if (opts.dateFrom && day < opts.dateFrom) return false
    if (opts.dateTo && day > opts.dateTo) return false
    if (statusQ && !(e.docStatus ?? '').toLowerCase().includes(statusQ)) return false
    if (!q) return true
    const hay = `${e.title} ${e.detail} ${e.actor ?? ''} ${e.refId ?? ''} ${e.docNumber ?? ''} ${e.counterpartyName ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}

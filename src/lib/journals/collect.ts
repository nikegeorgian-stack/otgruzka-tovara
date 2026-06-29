import type { AppStore } from '@/lib/types'
import { formatMixDate } from '@/lib/formulations/cubeLabel'
import type {
  JournalCategory,
  JournalCategoryCounts,
  UnifiedJournalEntry,
} from './types'

function push(out: UnifiedJournalEntry[], entry: UnifiedJournalEntry) {
  out.push(entry)
}

function itemName(store: AppStore, itemId?: string): string {
  if (!itemId) return ''
  return store.warehouse.items.find((i) => i.id === itemId)?.name ?? itemId.slice(0, 8)
}

function employeeName(store: AppStore, id?: string): string | undefined {
  if (!id) return undefined
  return store.employees.find((e) => e.id === id)?.fullName
}

const TIMESHEET_ACTION: Record<string, string> = {
  fact_change: 'Изменение факта',
  plan_change: 'Изменение плана',
  comment: 'Комментарий',
  substitution: 'Подмена',
  employee_remove: 'Удаление сотрудника',
  month_remove: 'Удаление месяца',
  bulk: 'Массовая операция',
}

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
): UnifiedJournalEntry[] {
  const allowed = new Set(categories)
  const out: UnifiedJournalEntry[] = []
  const locale = store.settings.locale === 'ka' ? 'ka' : 'ru'

  if (allowed.has('timesheet')) {
    for (const e of store.auditLog) {
      push(out, {
        id: `ts-${e.id}`,
        category: 'timesheet',
        at: e.at,
        title: TIMESHEET_ACTION[e.action] ?? e.action,
        detail: e.detail,
        actor: e.employeeId ? employeeName(store, e.employeeId) : undefined,
        refId: e.month,
      })
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
        title: `Заявка · ${line} · ${r.shift === 'night' ? 'ночь' : 'день'}`,
        detail: `${r.date} · ${r.brigadeName}${r.plannerSourceNote ? ` · ${r.plannerSourceNote}` : ''} · ${r.status}`,
        actor: foreman,
        refId: r.id,
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
        refId: e.itemId ?? e.batchRunId,
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
        refId: m.documentNo ?? m.documentId,
      })
    }
  }

  if (allowed.has('warehouse_documents')) {
    for (const d of store.warehouse.documents) {
      push(out, {
        id: `wh-d-${d.id}`,
        category: 'warehouse_documents',
        at: d.createdAt,
        title: `${d.type} · ${d.number}`,
        detail: `${d.date} · ${d.lines.length} поз.${d.comment ? ` · ${d.comment}` : ''}`,
        refId: d.id,
      })
    }
  }

  if (allowed.has('warehouse_loading')) {
    for (const s of store.warehouse.loadingShipments ?? []) {
      if (s.status !== 'posted') continue
      push(out, {
        id: `wh-l-${s.id}`,
        category: 'warehouse_loading',
        at: s.postedAt ?? s.updatedAt,
        title: `Погрузка · ${s.number}`,
        detail: `${s.date} · ${s.counterpartyName} · ${s.lines.length} поз. · ${(s.totalsGrossKg / 1000).toFixed(3)} т${s.orderNo ? ` · ${s.orderNo}` : ''}`,
        actor: s.keeperName,
        refId: s.id,
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
          refId: itemId,
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
        push(out, {
          id: `po-${order.id}-${h.id}`,
          category: 'procurement',
          at: h.at,
          title: `Заказ ${order.orderNumber}`,
          detail: `${h.fromStatus ?? '—'} → ${h.toStatus}${h.note ? ` · ${h.note}` : ''}`,
          refId: order.id,
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
  },
): UnifiedJournalEntry[] {
  const q = opts.search?.trim().toLowerCase()
  return entries.filter((e) => {
    if (opts.categories && opts.categories.size > 0 && !opts.categories.has(e.category)) {
      return false
    }
    const day = e.at.slice(0, 10)
    if (opts.dateFrom && day < opts.dateFrom) return false
    if (opts.dateTo && day > opts.dateTo) return false
    if (!q) return true
    const hay = `${e.title} ${e.detail} ${e.actor ?? ''} ${e.refId ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}

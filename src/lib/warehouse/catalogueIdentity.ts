/**
 * R2.9H — catalogue identity helpers for G1 overlay + safe UI sort.
 * Critical remains authoritative for stock docs/movements.
 * For catalogue cards: never let a degraded stub (name empty / name===id)
 * overwrite a richer SQL/legacy identity for the same stable item id.
 */
export type CatalogueIdentityFields = {
  id: string
  name?: string | null
  internalCode?: string | null
  sku?: string | null
  unit?: string | null
  categoryId?: string | null
  active?: boolean | null
  barcode?: string | null
}

/** True when name is missing or is just a copy of the UUID id (G2 stub). */
export function isDegradedCatalogueIdentity(
  item: CatalogueIdentityFields | null | undefined,
): boolean {
  if (!item?.id) return true
  const name = item.name == null ? '' : String(item.name).trim()
  if (!name) return true
  if (name === String(item.id).trim()) return true
  return false
}

function pickNonEmpty(
  preferred: string | null | undefined,
  fallback: string | null | undefined,
): string | undefined {
  const p = preferred == null ? '' : String(preferred).trim()
  if (p) return preferred == null ? undefined : String(preferred)
  const f = fallback == null ? '' : String(fallback).trim()
  if (f) return fallback == null ? undefined : String(fallback)
  return undefined
}

/**
 * Merge same-id cards: start from critical/authoritative shape,
 * but restore identity fields from legacy when critical is a degraded stub
 * or leaves identity empty while legacy has values.
 */
export function mergeCatalogueItemIdentity<T extends CatalogueIdentityFields>(
  criticalItem: T,
  legacyItem: T | undefined,
): T {
  if (!legacyItem) return criticalItem
  const criticalDegraded = isDegradedCatalogueIdentity(criticalItem)
  const legacyDegraded = isDegradedCatalogueIdentity(legacyItem)

  if (!criticalDegraded) {
    // Critical has a real name — keep critical, but fill empty identity holes from legacy.
    return {
      ...criticalItem,
      internalCode:
        pickNonEmpty(criticalItem.internalCode, legacyItem.internalCode) ??
        criticalItem.internalCode,
      sku: pickNonEmpty(criticalItem.sku, legacyItem.sku) ?? criticalItem.sku,
      unit: pickNonEmpty(criticalItem.unit, legacyItem.unit) ?? criticalItem.unit,
      categoryId:
        pickNonEmpty(criticalItem.categoryId, legacyItem.categoryId) ??
        criticalItem.categoryId,
      barcode:
        pickNonEmpty(criticalItem.barcode, legacyItem.barcode) ?? criticalItem.barcode,
      active:
        criticalItem.active == null && legacyItem.active != null
          ? legacyItem.active
          : criticalItem.active,
    }
  }

  if (legacyDegraded) return criticalItem

  // Critical stub + rich legacy → keep id from critical, identity from legacy.
  return {
    ...criticalItem,
    name: legacyItem.name,
    internalCode:
      pickNonEmpty(legacyItem.internalCode, criticalItem.internalCode) ??
      legacyItem.internalCode,
    sku: pickNonEmpty(legacyItem.sku, criticalItem.sku) ?? legacyItem.sku,
    unit: pickNonEmpty(legacyItem.unit, criticalItem.unit) ?? legacyItem.unit,
    categoryId:
      pickNonEmpty(legacyItem.categoryId, criticalItem.categoryId) ??
      legacyItem.categoryId,
    barcode:
      pickNonEmpty(legacyItem.barcode, criticalItem.barcode) ?? legacyItem.barcode,
    active:
      legacyItem.active != null
        ? legacyItem.active
        : criticalItem.active,
  }
}

/**
 * Union catalogue lists: critical ids first (stock-authoritative cards),
 * then legacy-only ids. Same id → identity-aware merge (R2.9H).
 */
export function unionWarehouseCatalogueItems<T extends CatalogueIdentityFields>(
  legacyItems: T[] | null | undefined,
  criticalItems: T[] | null | undefined,
): T[] {
  const legacy = Array.isArray(legacyItems) ? legacyItems : []
  const critical = Array.isArray(criticalItems) ? criticalItems : []
  if (!critical.length) return legacy
  if (!legacy.length) return critical

  const legacyById = new Map<string, T>()
  for (const item of legacy) {
    if (item?.id) legacyById.set(item.id, item)
  }

  const out: T[] = []
  const seen = new Set<string>()
  for (const item of critical) {
    if (!item?.id) continue
    out.push(mergeCatalogueItemIdentity(item, legacyById.get(item.id)))
    seen.add(item.id)
  }
  for (const item of legacy) {
    if (item?.id && !seen.has(item.id)) out.push(item)
  }
  return out
}

function sortKeyPart(value: unknown): string {
  if (value == null) return ''
  const s = String(value).trim()
  return s
}

/** Safe UI sort: name → internalCode → sku → id (never throws on undefined name). */
export function compareWarehouseItemsForSort(
  a: CatalogueIdentityFields,
  b: CatalogueIdentityFields,
  locale = 'ru',
): number {
  const an = sortKeyPart(a.name)
  const bn = sortKeyPart(b.name)
  if (an || bn) {
    const byName = an.localeCompare(bn, locale)
    if (byName !== 0) return byName
  }
  const ac = sortKeyPart(a.internalCode)
  const bc = sortKeyPart(b.internalCode)
  if (ac || bc) {
    const byCode = ac.localeCompare(bc, locale)
    if (byCode !== 0) return byCode
  }
  const as = sortKeyPart(a.sku)
  const bs = sortKeyPart(b.sku)
  if (as || bs) {
    const bySku = as.localeCompare(bs, locale)
    if (bySku !== 0) return bySku
  }
  return sortKeyPart(a.id).localeCompare(sortKeyPart(b.id), locale)
}

/** Server/client shared: complete receipt snapshot for unknown catalogue ids. */
export function isCompleteItemIdentitySnapshot(line: {
  itemId?: string | null
  itemNameSnapshot?: string | null
  unitSnapshot?: string | null
  inputUnit?: string | null
}): boolean {
  const id = String(line.itemId ?? '').trim()
  const name = String(line.itemNameSnapshot ?? '').trim()
  if (!id || !name || name === id) return false
  const unit = String(line.unitSnapshot ?? line.inputUnit ?? '').trim()
  return Boolean(unit)
}

export type EnsureItemCatalogLine = {
  itemId: string
  itemNameSnapshot?: string | null
  itemCodeSnapshot?: string | null
  unitSnapshot?: string | null
  inputUnit?: string | null
  skuSnapshot?: string | null
  categoryIdSnapshot?: string | null
  barcodeSnapshot?: string | null
  activeSnapshot?: boolean | null
}

/**
 * Pure catalogue ensure used by tests (mirrors G2 ensureItemCatalog contract):
 * existing id untouched; unknown without complete snapshot fails closed.
 */
export function ensureItemCatalogPure<T extends CatalogueIdentityFields>(
  items: T[],
  lines: EnsureItemCatalogLine[],
):
  | { ok: true; items: T[] }
  | { ok: false; error: 'unknown_item_incomplete_snapshot'; itemId: string } {
  const next = [...items]
  for (const line of lines) {
    const itemId = String(line.itemId ?? '').trim()
    if (!itemId) continue
    if (next.some((i) => i.id === itemId)) continue
    if (!isCompleteItemIdentitySnapshot(line)) {
      return { ok: false, error: 'unknown_item_incomplete_snapshot', itemId }
    }
    next.push({
      id: itemId,
      name: String(line.itemNameSnapshot).trim(),
      internalCode: String(line.itemCodeSnapshot ?? '').trim(),
      unit: String(line.unitSnapshot ?? line.inputUnit ?? '').trim(),
      sku: line.skuSnapshot != null ? String(line.skuSnapshot) : undefined,
      categoryId: line.categoryIdSnapshot != null ? String(line.categoryIdSnapshot) : undefined,
      barcode: line.barcodeSnapshot != null ? String(line.barcodeSnapshot) : undefined,
      active: line.activeSnapshot === false ? false : true,
    } as T)
  }
  return { ok: true, items: next }
}

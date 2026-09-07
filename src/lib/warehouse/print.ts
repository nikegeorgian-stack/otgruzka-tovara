import { computeAllBalances } from '@/lib/warehouse/stock'
import { formatQty } from '@/lib/warehouse/stock'
import { compareWarehouseItemsForSort } from '@/lib/warehouse/catalogueIdentity'
import type { WarehouseStore } from '@/lib/warehouse/types'

export function printWarehouseBalances(
  store: WarehouseStore,
  warehouseId?: string,
  title = 'Остатки склада',
): void {
  const balances = computeAllBalances(store, warehouseId)
  const catMap = new Map(store.categories.map((c) => [c.id, c.name]))
  const locName = warehouseId
    ? store.locations.find((l) => l.id === warehouseId)?.name
    : 'Все склады'

  const rows = store.items
    .filter((i) => i.active && (!warehouseId || i.warehouseId === warehouseId))
    .sort((a, b) => compareWarehouseItemsForSort(a, b, 'ru'))

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;font-size:12px}
h1{font-size:18px;margin:0 0 4px}
.meta{color:#666;margin-bottom:16px}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
th{background:#f5f5f5;font-size:10px;text-transform:uppercase}
.num{text-align:right;font-variant-numeric:tabular-nums}
.low{color:#b45309;font-weight:600}
@media print{body{padding:0}}
</style></head><body>
<h1>${title}</h1>
<p class="meta">${locName ?? ''} · ${new Date().toLocaleDateString('ru-RU')}</p>
<table><thead><tr>
<th>Категория</th><th>Наименование</th><th>Ед.</th>
<th class="num">Остаток</th><th class="num">Резерв</th><th class="num">Доступно</th>
</tr></thead><tbody>
${rows
  .map((item) => {
    const b = balances.get(item.id)
    const low = item.minStock != null && (b?.available ?? 0) < item.minStock
    return `<tr>
<td>${catMap.get(item.categoryId) ?? ''}</td>
<td>${item.name}</td><td>${item.unit}</td>
<td class="num ${low ? 'low' : ''}">${formatQty(b?.balance ?? 0)}</td>
<td class="num">${formatQty(b?.reserved ?? 0)}</td>
<td class="num">${formatQty(b?.available ?? 0)}</td>
</tr>`
  })
  .join('')}
</tbody></table></body></html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.onload = () => w.print()
}

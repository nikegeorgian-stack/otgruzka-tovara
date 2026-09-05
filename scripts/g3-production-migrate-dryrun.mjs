/**
 * PHASE G3 — dry-run migration inventory (no production I/O, no writes).
 * Usage: node scripts/g3-production-migrate-dryrun.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function log(msg) {
  process.stdout.write(`[g3-dryrun] ${msg}\n`)
}

function countMatches(dir, pattern) {
  let n = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(cur, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
        stack.push(full)
      } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const text = fs.readFileSync(full, 'utf8')
        const m = text.match(pattern)
        if (m) n += m.length
      }
    }
  }
  return n
}

log('Inventory (code references only — no SQL/production reads)')
log(`ProductionOrder type refs: ${countMatches(path.join(root, 'src'), /ProductionOrder/g)}`)
log(`recipeVersions refs: ${countMatches(path.join(root, 'src'), /recipeVersions/g)}`)
log(`confirmProductionShiftReport refs: ${countMatches(path.join(root, 'src'), /confirmProductionShiftReport/g)}`)
log(`productionMaterialHandoff refs: ${countMatches(path.join(root, 'src'), /productionMaterialHandoff/g)}`)
log(`UpdateFstStore refs: ${countMatches(path.join(root, 'src'), /UpdateFstStore/g)}`)

log('')
log('Bootstrap plan (explicit, not auto):')
log('  1. Export legacy FstStore production+formulations recipeVersions/orders/shiftReports')
log('  2. Map IDs: recipeId, orderId, lineId, warehouseItemId (fail on name-only)')
log('  3. Validate approved versions have warehouseItemId components')
log('  4. Upsert into FstCriticalStore.domains.production via admin CAS (revision 0→1)')
log('  5. Switch web overlay to critical-only when revision>0')
log('  6. Rollback: set revision awareness / feature flag off; keep legacy FstStore readable')
log('')
log('Out of scope: employees/months/timesheets, packaging/QC/FG, procurement, sales')
log('DRY-RUN COMPLETE — no writes performed')
process.exitCode = 0

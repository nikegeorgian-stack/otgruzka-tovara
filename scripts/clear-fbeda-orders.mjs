/**
 * Удалить заказы FBeda за указанные даты из Firestore (fbeda-5c061).
 * Usage (from tabel root): node scripts/clear-fbeda-orders.mjs 2026-07-08 2026-07-09
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDyFoL8A3CB4uJ1_wu-dxSROtYbZSy3IAU',
  authDomain: 'fbeda-5c061.firebaseapp.com',
  projectId: 'fbeda-5c061',
  storageBucket: 'fbeda-5c061.firebasestorage.app',
  messagingSenderId: '451874579311',
  appId: '1:451874579311:web:e560f9612f557c75a2be9a',
}

const args = process.argv.slice(2)
const fromIdx = args.indexOf('--from')
let dateSet = null
let fromDate = null

if (fromIdx !== -1) {
  fromDate = args[fromIdx + 1]
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    console.error('Usage: node scripts/clear-fbeda-orders.mjs --from YYYY-MM-DD')
    process.exit(1)
  }
} else if (!args.length) {
  console.error('Usage: node scripts/clear-fbeda-orders.mjs YYYY-MM-DD [...]')
  console.error('   or: node scripts/clear-fbeda-orders.mjs --from YYYY-MM-DD')
  process.exit(1)
} else {
  dateSet = new Set(args.filter((a) => !a.startsWith('--')))
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

await signInAnonymously(auth)

const ordersSnap = await getDocs(collection(db, 'orders'))
const toDelete = ordersSnap.docs.filter((d) => {
  const data = d.data()
  const orderDate = data.order_date || (d.id.includes('__') ? d.id.split('__')[0] : null)
  if (!orderDate) return false
  if (fromDate) return orderDate >= fromDate
  return dateSet.has(orderDate)
})

const label = fromDate ? `from ${fromDate}` : [...dateSet].join(', ')
console.log(`FBeda fbeda-5c061 — dates: ${label}`)
console.log(`Found ${toDelete.length} order doc(s) to delete`)

if (!toDelete.length) {
  console.log('Nothing to delete.')
  process.exit(0)
}

for (const d of toDelete) {
  const data = d.data()
  console.log(`  - ${d.id} (${data.employee_name ?? '?'}: meat=${data.meat ?? 0}, vegan=${data.vegan ?? 0})`)
}

let batch = writeBatch(db)
let ops = 0
for (const d of toDelete) {
  batch.delete(doc(db, 'orders', d.id))
  ops++
  if (ops >= 450) {
    await batch.commit()
    batch = writeBatch(db)
    ops = 0
  }
}
if (ops) await batch.commit()

const acceptedSnap = await getDocs(collection(db, 'accepted_days'))
for (const d of acceptedSnap.docs) {
  if (fromDate ? d.id >= fromDate : dateSet.has(d.id)) {
    await deleteDoc(doc(db, 'accepted_days', d.id))
    console.log(`Removed accepted_days/${d.id}`)
  }
}

console.log(`Done. Deleted ${toDelete.length} order(s).`)

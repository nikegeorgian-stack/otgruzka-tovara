/**
 * Обновляет общую облачную базу Firestore (fstStores/fibercell-main).
 * Run: $env:FST_ADMIN_PASSWORD="..."; npm run migrate:cloud-store
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { SHARED_STORE_ID, connectCloudFirebase } from './_cloudFirebase.mjs'

function patchStore(store) {
  if (!store || typeof store !== 'object') return store

  if (!store.technologistQc || typeof store.technologistQc !== 'object') {
    store.technologistQc = {}
  }
  const qc = store.technologistQc
  if (!Array.isArray(qc.eadCalculations)) qc.eadCalculations = []
  if (!Array.isArray(qc.eadControls)) qc.eadControls = []
  if (!Array.isArray(qc.incomingControls)) qc.incomingControls = []
  if (!Array.isArray(qc.impregnationQc)) qc.impregnationQc = []
  if (!Array.isArray(qc.roomClimateLog)) qc.roomClimateLog = []
  if (!qc.settings) qc.settings = { defaultNvTolerancePp: 5 }

  if (store.warehouse && !Array.isArray(store.warehouse.auditLog)) {
    store.warehouse.auditLog = []
  }
  if (!Array.isArray(store.auditLog)) store.auditLog = []

  return store
}

const { db } = await connectCloudFirebase()

const ref = doc(db, `fstStores/${SHARED_STORE_ID}`)
const snap = await getDoc(ref)
if (!snap.exists() || !snap.data()?.payload) {
  console.log(`Документ fstStores/${SHARED_STORE_ID} пуст — войдите на сайт один раз.`)
  process.exit(0)
}

const data = snap.data()
const payload = patchStore(structuredClone(data.payload))
const hadClimate = Array.isArray(data.payload?.technologistQc?.roomClimateLog)

await setDoc(ref, {
  payload,
  app: data.app ?? 'FST',
  version: data.version ?? payload.version ?? 6,
  updatedAt: serverTimestamp(),
  schemaPatchedAt: new Date().toISOString(),
})

console.log(`Готово: fstStores/${SHARED_STORE_ID}`)
console.log(
  `  roomClimateLog: ${hadClimate ? 'уже был' : 'добавлен'} (${payload.technologistQc.roomClimateLog.length} записей)`,
)

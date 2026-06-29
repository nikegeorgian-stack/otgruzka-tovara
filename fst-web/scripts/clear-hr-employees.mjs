/**
 * Очищает весь персонал в облачной базе fstStores/fibercell-main.
 *
 * Из корня:  $env:FST_ADMIN_PASSWORD="..."; npm run clear:hr-cloud
 * Из fst-web: $env:FST_ADMIN_PASSWORD="..."; npm run clear:hr-cloud
 * Удобно:   powershell -ExecutionPolicy Bypass -File scripts\clear-hr-cloud.ps1
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { SHARED_STORE_ID, connectCloudFirebase } from './_cloudFirebase.mjs'
import { clearPersonnelPayload } from './_clearPersonnel.mjs'

const { db } = await connectCloudFirebase()

const ref = doc(db, `fstStores/${SHARED_STORE_ID}`)
const snap = await getDoc(ref)
if (!snap.exists() || !snap.data()?.payload) {
  console.log(`Документ fstStores/${SHARED_STORE_ID} пуст — войдите на сайт один раз.`)
  process.exit(0)
}

const data = snap.data()
const payload = structuredClone(data.payload)
const stats = clearPersonnelPayload(payload)

await setDoc(ref, {
  payload,
  app: data.app ?? 'FST',
  version: data.version ?? payload.version ?? 6,
  updatedAt: serverTimestamp(),
  personnelClearedAt: new Date().toISOString(),
})

console.log(`Готово: fstStores/${SHARED_STORE_ID}`)
console.log(`  сотрудников удалено: ${stats.employees}`)
console.log(`  кандидатов удалено: ${stats.candidates}`)
console.log(`  в корзине: ${stats.trashEmployees} сотр. + ${stats.trashCandidates} канд.`)
console.log('Обновите страницу HR (Ctrl+F5) и загрузите реестр заново.')

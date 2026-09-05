import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDyFoL8A3CB4uJ1_wu-dxSROtYbZSy3IAU',
  authDomain: 'fbeda-5c061.firebaseapp.com',
  projectId: 'fbeda-5c061',
  storageBucket: 'fbeda-5c061.firebasestorage.app',
  messagingSenderId: '451874579311',
  appId: '1:451874579311:web:e560f9612f557c75a2be9a',
}

const app = initializeApp(firebaseConfig)
await signInAnonymously(getAuth(app))
const db = getFirestore(app)

for (const name of ['config', 'telegram', 'bots', 'notifications']) {
  try {
    const d = await getDoc(doc(db, 'config', name))
    if (d.exists()) console.log(`config/${name}:`, JSON.stringify(d.data(), null, 2))
  } catch (e) { console.log(`config/${name}:`, e.message) }
}

const configSnap = await getDocs(collection(db, 'config'))
console.log('config docs:', configSnap.docs.map((d) => d.id).join(', '))
for (const d of configSnap.docs) {
  const data = d.data()
  const keys = Object.keys(data)
  const hit = keys.filter((k) => /telegram|bot|chat|token/i.test(k) || /telegram|bot|chat|token/i.test(JSON.stringify(data[k])))
  if (hit.length || /telegram|bot|chat|token/i.test(JSON.stringify(data))) {
    console.log(`\nconfig/${d.id} keys:`, keys.join(', '))
    console.log(JSON.stringify(data, null, 2))
  }
}

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

const configSnap = await getDocs(collection(db, 'config'))
for (const d of configSnap.docs) {
  console.log(`\n=== config/${d.id} ===`)
  console.log(JSON.stringify(d.data(), null, 2))
}

for (const col of ['telegram_messages', 'telegram', 'messages', 'notifications', 'outbox']) {
  try {
    const snap = await getDocs(collection(db, col))
    console.log(`\n=== collection ${col} (${snap.size}) ===`)
    snap.docs.slice(0, 10).forEach((d) => console.log(d.id, JSON.stringify(d.data())))
  } catch (e) {
    console.log(`collection ${col}:`, e.code || e.message)
  }
}

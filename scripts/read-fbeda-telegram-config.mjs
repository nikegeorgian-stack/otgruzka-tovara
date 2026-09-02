import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, doc, getDoc, collection, getDocs } from 'firebase/firestore'

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

const ids = ['telegram_messages', 'telegram', 'bot', 'settings', 'access']
for (const id of ids) {
  const d = await getDoc(doc(db, 'config', id))
  if (d.exists()) {
    console.log(`\n=== config/${id} ===`)
    console.log(JSON.stringify(d.data(), null, 2))
  }
}

// subcollection?
try {
  const sub = await getDocs(collection(db, 'config', 'telegram_messages', 'messages'))
  console.log('\n=== config/telegram_messages/messages count:', sub.size)
  sub.docs.slice(0, 5).forEach((d) => console.log(d.id, JSON.stringify(d.data())))
} catch (e) {
  console.log('subcollection:', e.message)
}

try {
  const root = await getDocs(collection(db, 'telegram_messages'))
  console.log('\n=== telegram_messages root count:', root.size)
  root.docs.slice(0, 5).forEach((d) => console.log(d.id, JSON.stringify(d.data())))
} catch (e) {
  console.log('root telegram_messages:', e.message)
}

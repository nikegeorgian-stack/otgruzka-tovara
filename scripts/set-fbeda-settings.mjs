/**
 * Включить ordersDisabled в FBeda Firestore.
 * Usage: node scripts/set-fbeda-settings.mjs ordersDisabled=true
 */
import { initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously } from 'firebase/auth'
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDyFoL8A3CB4uJ1_wu-dxSROtYbZSy3IAU',
  authDomain: 'fbeda-5c061.firebaseapp.com',
  projectId: 'fbeda-5c061',
  storageBucket: 'fbeda-5c061.firebasestorage.app',
  messagingSenderId: '451874579311',
  appId: '1:451874579311:web:e560f9612f557c75a2be9a',
}

const ordersDisabled = process.argv.includes('ordersDisabled=true')

const app = initializeApp(firebaseConfig)
await signInAnonymously(getAuth(app))
const db = getFirestore(app)

const ref = doc(db, 'config', 'settings')
const prev = (await getDoc(ref)).data() || {}
const next = { ...prev, ordersDisabled, updatedAt: new Date().toISOString() }
await setDoc(ref, next, { merge: true })
console.log('config/settings:', next)

import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)

export async function createAuthUserByAdmin(email: string, password: string) {
  const tempApp = initializeApp(firebaseConfig, `temp-${Date.now()}`)
  try {
    const tempAuth = getAuth(tempApp)
    const cred = await createUserWithEmailAndPassword(tempAuth, email, password)
    await tempAuth.signOut()
    return { uid: cred.user.uid }
  } finally {
    await deleteApp(tempApp)
  }
}

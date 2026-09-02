import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { doc, setDoc, arrayUnion } from 'firebase/firestore'
import { getFirebaseAuth, getFirestoreDb, isFirebaseConfigured } from './firebase'

export const FST_PUSH_TOKENS_COLLECTION = 'fstPushTokens'

export function isNativePushSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

async function saveToken(uid: string, email: string, token: string): Promise<void> {
  if (!isFirebaseConfigured() || !token.trim()) return
  const ref = doc(getFirestoreDb(), FST_PUSH_TOKENS_COLLECTION, uid)
  await setDoc(
    ref,
    {
      email: email.trim().toLowerCase(),
      uid,
      tokens: arrayUnion(token.trim()),
      updatedAt: new Date().toISOString(),
      platform: Capacitor.getPlatform(),
    },
    { merge: true },
  )
}

/** Запросить разрешение и сохранить FCM-токен для текущего пользователя. */
export async function registerFstPushNotifications(): Promise<void> {
  if (!isNativePushSupported() || !isFirebaseConfigured()) return
  const user = getFirebaseAuth().currentUser
  if (!user?.uid || !user.email) return

  let perm = await PushNotifications.checkPermissions()
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
    perm = await PushNotifications.requestPermissions()
  }
  if (perm.receive !== 'granted') {
    console.info('FST push: permission not granted')
    return
  }

  await PushNotifications.removeAllListeners()

  // Android 8+: канал должен совпадать с channelId в api/fst/send-push.mjs
  await PushNotifications.createChannel({
    id: 'fst_default',
    name: 'FiberCell',
    description: 'Уведомления о зарплате и авансах',
    importance: 4,
    visibility: 1,
    sound: 'default',
  }).catch(() => {
    /* канал уже есть или платформа без createChannel */
  })

  await PushNotifications.addListener('registration', (t) => {
    void saveToken(user.uid, user.email!, t.value).catch((err) => {
      console.warn('FST push: save token failed', err)
    })
  })

  await PushNotifications.addListener('registrationError', (err) => {
    console.warn('FST push: registration error', err)
  })

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.info('FST push received', notification.title, notification.body)
  })

  await PushNotifications.addListener('pushNotificationActionPerformed', () => {
    /* tap — сайт уже открыт в WebView */
  })

  await PushNotifications.register()
}

export type SendPushInput = {
  emails: string[]
  title: string
  body: string
  data?: Record<string, string>
}

/** Отправить пуш через Vercel API (нужна авторизованная сессия). */
export async function sendFstPush(input: SendPushInput): Promise<{ ok: boolean; sent?: number }> {
  const user = getFirebaseAuth().currentUser
  if (!user) return { ok: false }
  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
  if (!emails.length || !input.title.trim()) return { ok: false }

  try {
    const token = await user.getIdToken()
    const res = await fetch('/api/fst/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        emails,
        title: input.title.trim().slice(0, 120),
        body: input.body.trim().slice(0, 400),
        data: input.data ?? {},
      }),
    })
    if (!res.ok) return { ok: false }
    const json = (await res.json()) as { sent?: number }
    return { ok: true, sent: json.sent ?? 0 }
  } catch {
    return { ok: false }
  }
}

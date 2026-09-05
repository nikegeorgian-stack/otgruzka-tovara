import { useEffect } from 'react'
import { useFstAuth } from '@/context/FstAuthContext'
import { isNativePushSupported, registerFstPushNotifications } from '@/lib/cloud/fstPush'

/** На Android APK после входа регистрирует FCM-токен. */
export function FstPushBootstrap() {
  const { user, isAllowed } = useFstAuth()

  useEffect(() => {
    if (!user || !isAllowed || !isNativePushSupported()) return
    void registerFstPushNotifications().catch((err) => {
      console.warn('FST push bootstrap failed', err)
    })
  }, [user?.uid, isAllowed])

  return null
}

import { useEffect, useMemo, useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useFstAuth } from '@/context/FstAuthContext'
import { useI18n } from '@/context/I18nContext'
import { prepareCloudPayload } from '@/lib/cloud/cloudPayload'
import { FIRESTORE_STORE_WARN_BYTES, subscribeCloudStoreMeta } from '@/lib/cloud/firestoreSync'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
}

function formatKb(bytes: number): string {
  return String(Math.max(1, Math.round(bytes / 1024)))
}

export function CloudStoreSizePanel({ store }: Props) {
  const { user, configured } = useFstAuth()
  const { t, tf } = useI18n()
  const [remoteBytes, setRemoteBytes] = useState(0)

  const localBytes = useMemo(() => prepareCloudPayload(store).bytes, [store])

  useEffect(() => {
    if (!configured || !user) return
    return subscribeCloudStoreMeta(
      user.uid,
      (meta) => {
        if (meta.bytes > 0) setRemoteBytes(meta.bytes)
      },
      (err) => console.warn('FST cloud size meta error', err),
    )
  }, [configured, user])

  if (!configured) return null

  const displayBytes = remoteBytes > 0 ? remoteBytes : localBytes
  const nearLimit = displayBytes >= FIRESTORE_STORE_WARN_BYTES

  return (
    <section className="rounded-sm border border-grid bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-ink">{t('web.cloud.sizeTitle')}</h2>
      <p className="mt-1 text-xs text-stone-500">{t('web.cloud.sizeHint')}</p>
      <p className="mt-3 font-mono text-sm text-ink">
        {remoteBytes > 0
          ? tf('web.cloud.sizeRemote', { size: formatKb(remoteBytes) })
          : tf('web.cloud.sizeLocal', { size: formatKb(localBytes) })}
      </p>
      {nearLimit && (
        <div className="mt-3">
          <FormNotice
            type="info"
            message={tf('web.cloud.sizeWarn', { size: formatKb(displayBytes) })}
          />
        </div>
      )}
    </section>
  )
}

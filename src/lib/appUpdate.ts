import { isNativeAppShell } from '@/lib/appDownload'

export type AppVersionManifest = {
  apkVersionCode: number
  apkVersionName: string
  apkUrl: string
  apkSizeBytes?: number
  webBundle?: string
  builtAt: string
}

const MANIFEST_URL = '/downloads/app-version.json'
const CANON_ORIGIN = 'https://otgruzka-tovara.vercel.app'

export function apkDownloadHref(manifest?: Pick<AppVersionManifest, 'apkUrl'> | null): string {
  const path = manifest?.apkUrl ?? '/downloads/fst-fibercell.apk'
  if (path.startsWith('http')) return path
  const origin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : CANON_ORIGIN
  return `${origin}${path}`
}

export async function fetchAppVersionManifest(): Promise<AppVersionManifest | null> {
  try {
    const origin =
      typeof window !== 'undefined' && window.location.origin
        ? window.location.origin
        : CANON_ORIGIN
    const res = await fetch(`${origin}${MANIFEST_URL}?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as AppVersionManifest
    if (!data?.apkVersionCode) return null
    return data
  } catch {
    return null
  }
}

export async function getInstalledApkVersionCode(): Promise<number | null> {
  if (!isNativeAppShell()) return null
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    const build = Number.parseInt(info.build, 10)
    return Number.isFinite(build) ? build : null
  } catch {
    return null
  }
}

export async function checkApkUpdateAvailable(): Promise<{
  updateAvailable: boolean
  manifest: AppVersionManifest | null
  installedCode: number | null
}> {
  if (!isNativeAppShell()) {
    return { updateAvailable: false, manifest: null, installedCode: null }
  }
  const [manifest, installedCode] = await Promise.all([
    fetchAppVersionManifest(),
    getInstalledApkVersionCode(),
  ])
  if (!manifest || installedCode == null) {
    return { updateAvailable: false, manifest, installedCode }
  }
  return {
    updateAvailable: manifest.apkVersionCode > installedCode,
    manifest,
    installedCode,
  }
}

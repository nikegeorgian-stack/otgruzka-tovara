/** Прямая загрузка APK / Windows с сайта Otgruzka (без Google Drive). */

export const FST_APK_PUBLIC_PATH = '/downloads/fst-fibercell.apk'

export const FST_WINDOWS_PUBLIC_PATH = '/downloads/otgruzka-setup.exe'



const CANON_ORIGIN = 'https://otgruzka-tovara.vercel.app'



function publicAssetHref(path: string): string {

  if (typeof window !== 'undefined' && window.location.origin) {

    return `${window.location.origin}${path}`

  }

  return `${CANON_ORIGIN}${path}`

}



/** Legacy Drive IDs — больше не используются для раздачи. */

export const FST_APK_DRIVE_ID = '1FLO_b6tT4xn-kFX74i-rbb6siJMEzrt4'

export const FST_WINDOWS_DRIVE_ID = '1VTzdASh-MdcEkjd5R8xLEXhZSgp46yT8'



export function driveUcDownloadUrl(fileId: string): string {

  return `https://drive.google.com/uc?export=download&id=${fileId}`

}



export function driveViewUrl(fileId: string): string {

  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`

}



/** Прямая загрузка APK с Vercel / Hosting. */

export function fstApkHref(): string {

  return publicAssetHref(FST_APK_PUBLIC_PATH)

}



/** Windows: сначала с сайта; если файла нет — fallback на Drive. */

export function fstWindowsHref(): string {

  return publicAssetHref(FST_WINDOWS_PUBLIC_PATH)

}



/** В Capacitor APK уже установлено — ссылку на скачивание Android скрываем. */

export function isNativeAppShell(): boolean {

  if (typeof window === 'undefined') return false

  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor

  return Boolean(cap?.isNativePlatform?.())

}



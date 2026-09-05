export type DocumentPreviewKind = 'google-embed' | 'image' | 'pdf-data' | 'external'

export type DocumentPreview = {
  kind: DocumentPreviewKind
  src: string
  externalUrl: string
}

const ALLOWED_DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com'])

export function isAllowedHrDocumentHost(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.replace(/^www\./, '')
    return ALLOWED_DRIVE_HOSTS.has(host)
  } catch {
    return false
  }
}

/** Ссылка Google Drive / Docs → URL для встраивания в iframe (/preview). */
export function googleDriveEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^www\./, '')
    if (!ALLOWED_DRIVE_HOSTS.has(host)) return null

    const fileMatch = u.pathname.match(/\/file\/d\/([^/]+)/)
    if (host === 'drive.google.com' && fileMatch) {
      return `https://drive.google.com/file/d/${fileMatch[1]}/preview`
    }

    const openId = u.searchParams.get('id')
    if (host === 'drive.google.com' && openId) {
      return `https://drive.google.com/file/d/${openId}/preview`
    }

    const docsMatch = u.pathname.match(/\/(document|spreadsheets|presentation)\/d\/([^/]+)/)
    if (host === 'docs.google.com' && docsMatch) {
      return `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/preview`
    }

    return null
  } catch {
    return null
  }
}

/** id файла Drive для прямой ссылки скачивания. */
export function googleDriveFileId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null
    const host = u.hostname.replace(/^www\./, '')
    if (host !== 'drive.google.com') return null
    const fileMatch = u.pathname.match(/\/file\/d\/([^/]+)/)
    if (fileMatch) return fileMatch[1]
    const openId = u.searchParams.get('id')
    if (openId) return openId
    return null
  } catch {
    return null
  }
}

/** Скачать с Drive (откроется вкладка; для файлов с доступом «по ссылке»). */
export function googleDriveDownloadUrl(url: string): string | null {
  const id = googleDriveFileId(url)
  if (!id) return null
  return `https://drive.google.com/uc?export=download&id=${id}`
}

export function isGoogleDriveUrl(url: string): boolean {
  return googleDriveEmbedUrl(url) !== null
}

export function resolveDocumentPreview(url: string): DocumentPreview {
  if (url.startsWith('data:image/')) {
    return { kind: 'image', src: url, externalUrl: url }
  }
  if (url.startsWith('data:application/pdf')) {
    return { kind: 'pdf-data', src: url, externalUrl: url }
  }

  const embed = googleDriveEmbedUrl(url)
  if (embed) {
    return { kind: 'google-embed', src: embed, externalUrl: url }
  }

  // Произвольные http(s) картинки не встраиваем — только Drive / data URL.
  return { kind: 'external', src: url, externalUrl: url }
}

export function canPreviewInApp(url: string): boolean {
  const { kind } = resolveDocumentPreview(url)
  return kind !== 'external'
}

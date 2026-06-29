export type DocumentPreviewKind = 'google-embed' | 'image' | 'pdf-data' | 'external'

export type DocumentPreview = {
  kind: DocumentPreviewKind
  src: string
  externalUrl: string
}

/** Ссылка Google Drive / Docs → URL для встраивания в iframe (/preview). */
export function googleDriveEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')

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

  if (/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(url)) {
    return { kind: 'image', src: url, externalUrl: url }
  }

  return { kind: 'external', src: url, externalUrl: url }
}

export function canPreviewInApp(url: string): boolean {
  const { kind } = resolveDocumentPreview(url)
  return kind !== 'external'
}

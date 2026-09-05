import { BRAND } from '@/lib/brand'

export type BrandLogoPng = {
  base64: string
  width: number
  height: number
}

/** Растеризует SVG-логотип в PNG для вставки в Excel. */
export async function loadBrandLogoPng(): Promise<BrandLogoPng | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('logo load failed'))
      img.src = BRAND.mark
    })
    const scale = 4
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth * scale
    canvas.height = img.naturalHeight * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(scale, scale)
    ctx.drawImage(img, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    return { base64, width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    return null
  }
}

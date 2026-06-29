export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  })
}

export function autoCropDocumentCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const w = sourceCanvas.width
  const h = sourceCanvas.height
  const srcCtx = sourceCanvas.getContext('2d')
  if (!srcCtx) return sourceCanvas
  const data = srcCtx.getImageData(0, 0, w, h).data

  let minX = w
  let minY = h
  let maxX = 0
  let maxY = 0
  let found = false

  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const isPaper = r > 145 && g > 145 && b > 145 && maxC - minC < 65
      if (!isPaper) continue
      found = true
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (!found) return sourceCanvas
  const pad = 12
  minX = Math.max(0, minX - pad)
  minY = Math.max(0, minY - pad)
  maxX = Math.min(w, maxX + pad)
  maxY = Math.min(h, maxY + pad)
  const cw = maxX - minX
  const ch = maxY - minY
  if (cw < 40 || ch < 40) return sourceCanvas

  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const outCtx = out.getContext('2d')
  if (!outCtx) return sourceCanvas
  outCtx.drawImage(sourceCanvas, minX, minY, cw, ch, 0, 0, cw, ch)
  return out
}

export function newId(): string {
  return crypto.randomUUID()
}

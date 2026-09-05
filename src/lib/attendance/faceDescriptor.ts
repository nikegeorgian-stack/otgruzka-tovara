/**
 * Локальная база лиц: @vladmandic/face-api (MIT) + модели в /models/faceapi.
 * Обработка только в браузере — фото не уходят в сторонние Face API.
 * В сторе храним 128-мерный эмбеддинг (+ маленькое превью кропа лица).
 */

/** Совместимый движок / размер вектора (старый тестовый 16×16 не принимаем). */
export const FACE_ENGINE = 'faceapi-128' as const
export const FACE_DESC_SIZE = 128

/**
 * Евклидово расстояние (меньше = ближе). Типичный порог face-api ≈ 0.6;
 * чуть жёстче — меньше ложных совпадений на киоске.
 */
export const FACE_MATCH_MAX_DISTANCE = 0.55

const MODELS_DIR = 'models/faceapi'

type FaceApi = typeof import('@vladmandic/face-api')

let faceApiMod: FaceApi | null = null
let loadPromise: Promise<void> | null = null

function modelsUri(): string {
  const base = String(import.meta.env.BASE_URL || '/')
  const normalized = base.endsWith('/') ? base : `${base}/`
  return `${normalized}${MODELS_DIR}`
}

async function getFaceApi(): Promise<FaceApi> {
  if (!faceApiMod) {
    faceApiMod = await import('@vladmandic/face-api')
  }
  return faceApiMod
}

export function isValidFaceDescriptor(descriptor?: number[] | null): boolean {
  return Boolean(descriptor && descriptor.length === FACE_DESC_SIZE)
}

/** Загрузка весов один раз на вкладку (кэш в памяти). */
export function ensureFaceModelsLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await getFaceApi()
      const uri = modelsUri()
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(uri),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(uri),
        faceapi.nets.faceRecognitionNet.loadFromUri(uri),
      ])
    })().catch((err) => {
      loadPromise = null
      throw err
    })
  }
  return loadPromise
}

export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0)
  return c
}

export function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality = 0.72): string {
  return canvas.toDataURL('image/jpeg', quality)
}

function cropFacePreview(
  source: HTMLCanvasElement,
  box: { x: number; y: number; width: number; height: number },
): string | undefined {
  const pad = 0.2
  const x = Math.max(0, Math.floor(box.x - box.width * pad))
  const y = Math.max(0, Math.floor(box.y - box.height * pad))
  const w = Math.min(source.width - x, Math.ceil(box.width * (1 + pad * 2)))
  const h = Math.min(source.height - y, Math.ceil(box.height * (1 + pad * 2)))
  if (w < 16 || h < 16) return undefined
  const side = 160
  const out = document.createElement('canvas')
  out.width = side
  out.height = side
  const ctx = out.getContext('2d')
  if (!ctx) return undefined
  ctx.drawImage(source, x, y, w, h, 0, 0, side, side)
  return canvasToJpegDataUrl(out, 0.7)
}

export type FaceExtractResult = {
  descriptor: number[]
  previewDataUrl?: string
  detectionScore: number
}

/**
 * Детект лица → landmarks → 128-d descriptor.
 * Возвращает null, если лицо не найдено.
 */
export async function extractFaceDescriptorFromCanvas(
  source: HTMLCanvasElement,
): Promise<FaceExtractResult | null> {
  await ensureFaceModelsLoaded()
  const faceapi = await getFaceApi()
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 320,
    scoreThreshold: 0.45,
  })
  const detection = await faceapi
    .detectSingleFace(source, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor()
  if (!detection?.descriptor || detection.descriptor.length !== FACE_DESC_SIZE) {
    return null
  }
  const box = detection.detection.box
  return {
    descriptor: Array.from(detection.descriptor),
    previewDataUrl: cropFacePreview(source, box),
    detectionScore: detection.detection.score,
  }
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!
    sum += d * d
  }
  return Math.sqrt(sum)
}

export type FaceMatchCandidate = {
  employeeId: string
  /** 0..1, выше = увереннее (1 − distance / threshold, clamp). */
  score: number
  distance: number
}

export function matchFaceDescriptor(
  probe: number[],
  gallery: { employeeId: string; descriptor: number[] }[],
  maxDistance = FACE_MATCH_MAX_DISTANCE,
): FaceMatchCandidate | null {
  if (!isValidFaceDescriptor(probe)) return null
  let best: FaceMatchCandidate | null = null
  for (const g of gallery) {
    if (!isValidFaceDescriptor(g.descriptor)) continue
    const distance = euclideanDistance(probe, g.descriptor)
    if (distance > maxDistance) continue
    const score = Math.max(0, Math.min(1, 1 - distance / maxDistance))
    if (!best || distance < best.distance) {
      best = { employeeId: g.employeeId, score, distance }
    }
  }
  return best
}

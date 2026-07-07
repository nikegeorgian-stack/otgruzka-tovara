import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalScope } from '@/hooks/useModalScope'
import { getModalPortalRoot } from '@/lib/ui/modalScope'
import { autoCropDocumentCanvas, fileToDataUrl } from '@/lib/hr/files'

type Props = {
  mode: 'photo' | 'document'
  onCapture: (dataUrl: string, fileName?: string) => void
  onClose: () => void
}

export function HrCameraModal({ mode, onCapture, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')

  const { zIndex } = useModalScope({
    open: true,
    onClose,
    containerRef: panelRef,
    initialFocus: 'none',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch {
        setError('Не удалось открыть камеру. Разрешите доступ в браузере.')
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  function capture() {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const finalCanvas = mode === 'document' ? autoCropDocumentCanvas(canvas) : canvas
    onCapture(finalCanvas.toDataURL('image/jpeg', 0.9))
    onClose()
  }

  async function pickFile(file: File) {
    const dataUrl = await fileToDataUrl(file)
    onCapture(dataUrl, file.name)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
      style={{ zIndex }}
    >
      <div ref={panelRef} className="w-full max-w-lg rounded-sm bg-white p-4 shadow-sm">
        <h3 className="text-lg font-bold text-ink">
          {mode === 'photo' ? 'Фото сотрудника' : 'Скан документа'}
        </h3>
        {error ? (
          <p className="mt-2 text-sm text-red-700">{error}</p>
        ) : (
          <video ref={videoRef} autoPlay playsInline className="mt-3 w-full rounded-sm bg-black" />
        )}
        <input
          ref={fileRef}
          type="file"
          accept={mode === 'photo' ? 'image/*' : 'image/*,.pdf'}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void pickFile(file)
          }}
        />
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid px-4 py-2 text-sm hover:bg-paper-dark"
            onClick={() => fileRef.current?.click()}
          >
            Выбрать файл…
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-sm border border-grid px-4 py-2 text-sm hover:bg-paper-dark"
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              type="button"
              className="rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-white"
              onClick={capture}
              disabled={!!error}
            >
              Снять
            </button>
          </div>
        </div>
      </div>
    </div>,
    getModalPortalRoot(),
  )
}

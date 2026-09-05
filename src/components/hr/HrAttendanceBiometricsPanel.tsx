import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import { Button } from '@/components/ui/Button'
import {
  FACE_ENGINE,
  captureVideoFrame,
  ensureFaceModelsLoaded,
  extractFaceDescriptorFromCanvas,
  isValidFaceDescriptor,
} from '@/lib/attendance/faceDescriptor'
import { hashAttendancePin, isValidAttendancePin } from '@/lib/attendance/pin'
import {
  formatPunchTime,
  localDateKey,
  punchesForEmployeeDay,
} from '@/lib/attendance/punch'
import type { AttendanceStore } from '@/lib/attendance/types'
import type { Employee } from '@/lib/types'

type Props = {
  emp: Employee
  attendance?: AttendanceStore
  onPatch: (partial: Partial<Employee>) => void
}

export function HrAttendanceBiometricsPanel({ emp, attendance, onPatch }: Props) {
  const { t, locale } = useI18n()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [faceBusy, setFaceBusy] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const today = punchesForEmployeeDay(attendance, emp.id, localDateKey())

  useEffect(() => {
    if (!enrolling) {
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
      } catch {
        setMsg(t('hr.attendance.cameraError'))
        setEnrolling(false)
      }
    })()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
  }, [enrolling, t])

  async function savePin() {
    setMsg(null)
    if (!isValidAttendancePin(pin)) {
      setMsg(t('hr.attendance.pinInvalid'))
      return
    }
    if (pin !== pin2) {
      setMsg(t('hr.attendance.pinMismatch'))
      return
    }
    const { hash, salt } = await hashAttendancePin(pin)
    onPatch({ attendancePinHash: hash, attendancePinSalt: salt })
    setPin('')
    setPin2('')
    setMsg(t('hr.attendance.pinSaved'))
  }

  function clearPin() {
    onPatch({ attendancePinHash: undefined, attendancePinSalt: undefined })
    setMsg(t('hr.attendance.pinCleared'))
  }

  async function captureFace() {
    if (faceBusy) return
    const video = videoRef.current
    if (!video) return
    const canvas = captureVideoFrame(video)
    if (!canvas) {
      setMsg(t('hr.attendance.cameraError'))
      return
    }
    setFaceBusy(true)
    setMsg(t('hr.attendance.faceLoading'))
    try {
      await ensureFaceModelsLoaded()
      const extracted = await extractFaceDescriptorFromCanvas(canvas)
      if (!extracted) {
        setMsg(t('hr.attendance.faceNoDetect'))
        return
      }
      onPatch({
        attendanceFaceDescriptor: extracted.descriptor,
        attendanceFaceEngine: FACE_ENGINE,
        attendanceFaceDataUrl: extracted.previewDataUrl,
        attendanceFaceEnrolledAt: new Date().toISOString(),
      })
      setEnrolling(false)
      setMsg(t('hr.attendance.faceSaved'))
    } catch {
      setMsg(t('hr.attendance.faceModelError'))
    } finally {
      setFaceBusy(false)
    }
  }

  function clearFace() {
    onPatch({
      attendanceFaceDescriptor: undefined,
      attendanceFaceEngine: undefined,
      attendanceFaceDataUrl: undefined,
      attendanceFaceEnrolledAt: undefined,
    })
    setMsg(t('hr.attendance.faceCleared'))
  }

  const hasPin = Boolean(emp.attendancePinHash && emp.attendancePinSalt)
  const hasFace = isValidFaceDescriptor(emp.attendanceFaceDescriptor)
  const needsReenroll =
    Boolean(emp.attendanceFaceDescriptor?.length) && !hasFace

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-600">{t('hr.attendance.intro')}</p>

      <section className="rounded-sm border border-grid bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-800">{t('hr.attendance.pinTitle')}</h3>
        <p className="mt-1 text-xs text-stone-500">{t('hr.attendance.pinHelp')}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-stone-500">
            {t('hr.attendance.pinNew')}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="mt-1 block w-36 rounded border border-grid px-2 py-1.5 text-sm"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <label className="text-xs text-stone-500">
            {t('hr.attendance.pinRepeat')}
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="mt-1 block w-36 rounded border border-grid px-2 py-1.5 text-sm"
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <Button type="button" size="sm" onClick={() => void savePin()}>
            {t('hr.attendance.pinSave')}
          </Button>
          {hasPin ? (
            <Button type="button" size="sm" variant="secondary" onClick={clearPin}>
              {t('hr.attendance.pinClear')}
            </Button>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          {hasPin ? t('hr.attendance.pinOn') : t('hr.attendance.pinOff')}
        </p>
      </section>

      <section className="rounded-sm border border-grid bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-800">{t('hr.attendance.faceTitle')}</h3>
        <p className="mt-1 text-xs text-stone-500">{t('hr.attendance.faceHelp')}</p>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          {emp.attendanceFaceDataUrl ? (
            <img
              src={emp.attendanceFaceDataUrl}
              alt=""
              className="h-28 w-28 rounded-sm border border-grid object-cover"
            />
          ) : (
            <div className="flex h-28 w-28 items-center justify-center rounded-sm border border-dashed border-grid text-xs text-stone-400">
              {t('hr.attendance.faceEmpty')}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {!enrolling ? (
              <Button type="button" size="sm" onClick={() => setEnrolling(true)}>
                {t('hr.attendance.faceEnroll')}
              </Button>
            ) : (
              <>
                <video
                  ref={videoRef}
                  className="h-40 w-40 rounded-sm bg-stone-900 object-cover"
                  playsInline
                  muted
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={faceBusy}
                    onClick={() => void captureFace()}
                  >
                    {faceBusy ? t('hr.attendance.faceLoading') : t('hr.attendance.faceCapture')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={faceBusy}
                    onClick={() => setEnrolling(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            )}
            {hasFace || needsReenroll ? (
              <Button type="button" size="sm" variant="secondary" onClick={clearFace}>
                {t('hr.attendance.faceClear')}
              </Button>
            ) : null}
            <p className="text-xs text-stone-500">
              {hasFace
                ? t('hr.attendance.faceOn')
                : needsReenroll
                  ? t('hr.attendance.faceNeedsReenroll')
                  : t('hr.attendance.faceOff')}
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-sm border border-grid bg-white p-4">
        <h3 className="text-sm font-semibold text-stone-800">{t('hr.attendance.todayTitle')}</h3>
        {today.length === 0 ? (
          <p className="mt-2 text-sm text-stone-400">{t('hr.attendance.todayEmpty')}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {today.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span>{p.kind === 'in' ? t('timeclock.in') : t('timeclock.out')}</span>
                <span className="tabular-nums text-stone-500">
                  {formatPunchTime(p.at, locale === 'ka' ? 'ka-GE' : 'ru-GE')} · {p.method}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {msg ? <p className="text-sm text-teal-800">{msg}</p> : null}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '@/context/I18nContext'
import {
  captureVideoFrame,
  ensureFaceModelsLoaded,
  extractFaceDescriptorFromCanvas,
  isValidFaceDescriptor,
  matchFaceDescriptor,
} from '@/lib/attendance/faceDescriptor'
import { isValidAttendancePin, verifyAttendancePin } from '@/lib/attendance/pin'
import {
  formatPunchTime,
  localDateKey,
  punchesForDay,
} from '@/lib/attendance/punch'
import type { AttendancePunch } from '@/lib/attendance/types'
import type { AppStore, Employee } from '@/lib/types'

type Props = {
  store: AppStore
  deviceLabel?: string
  onPunch: (input: {
    employeeId: string
    method: 'pin' | 'face'
    deviceLabel?: string
    confidence?: number
  }) => AttendancePunch
}

type Flash = {
  kind: 'in' | 'out'
  name: string
  time: string
  ok: boolean
  message?: string
}

export function TimeclockPage({ store, deviceLabel, onPunch }: Props) {
  const { t, locale } = useI18n()
  const [mode, setMode] = useState<'pin' | 'face'>('pin')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [now, setNow] = useState(() => new Date())
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const activeEmployees = useMemo(
    () => store.employees.filter((e) => e.active !== false && e.hrStatus !== 'fired'),
    [store.employees],
  )

  const todayKey = localDateKey()
  const todayPunches = useMemo(
    () => punchesForDay(store.attendance, todayKey).slice(0, 40),
    [store.attendance, todayKey],
  )

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(() => setFlash(null), 3500)
    return () => window.clearTimeout(id)
  }, [flash])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    if (mode !== 'face') {
      stopCamera()
      return
    }
    let cancelled = false
    void ensureFaceModelsLoaded().catch(() => {
      if (!cancelled) {
        setFlash({
          kind: 'in',
          name: '',
          time: '',
          ok: false,
          message: t('timeclock.faceModelError'),
        })
      }
    })
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
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
        setFlash({
          kind: 'in',
          name: '',
          time: '',
          ok: false,
          message: t('timeclock.cameraError'),
        })
      }
    })()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [mode, stopCamera, t])

  function showResult(punch: AttendancePunch, emp: Employee) {
    setFlash({
      kind: punch.kind,
      name: emp.fullName,
      time: formatPunchTime(punch.at, locale === 'ka' ? 'ka-GE' : 'ru-GE'),
      ok: true,
    })
  }

  async function submitPin() {
    if (busy) return
    if (!isValidAttendancePin(pin)) {
      setFlash({ kind: 'in', name: '', time: '', ok: false, message: t('timeclock.pinInvalid') })
      return
    }
    setBusy(true)
    try {
      let matched: Employee | null = null
      for (const emp of activeEmployees) {
        if (!emp.attendancePinHash || !emp.attendancePinSalt) continue
        if (await verifyAttendancePin(pin, emp.attendancePinHash, emp.attendancePinSalt)) {
          matched = emp
          break
        }
      }
      if (!matched) {
        setFlash({ kind: 'in', name: '', time: '', ok: false, message: t('timeclock.pinUnknown') })
        return
      }
      const punch = onPunch({
        employeeId: matched.id,
        method: 'pin',
        deviceLabel,
      })
      showResult(punch, matched)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  async function submitFace() {
    if (busy) return
    const video = videoRef.current
    if (!video) return
    const canvas = captureVideoFrame(video)
    if (!canvas) {
      setFlash({ kind: 'in', name: '', time: '', ok: false, message: t('timeclock.cameraError') })
      return
    }
    setBusy(true)
    try {
      await ensureFaceModelsLoaded()
      const extracted = await extractFaceDescriptorFromCanvas(canvas)
      if (!extracted) {
        setFlash({
          kind: 'in',
          name: '',
          time: '',
          ok: false,
          message: t('timeclock.faceNoDetect'),
        })
        return
      }
      const gallery = activeEmployees
        .filter((e) => isValidFaceDescriptor(e.attendanceFaceDescriptor))
        .map((e) => ({ employeeId: e.id, descriptor: e.attendanceFaceDescriptor! }))
      const hit = matchFaceDescriptor(extracted.descriptor, gallery)
      if (!hit) {
        setFlash({
          kind: 'in',
          name: '',
          time: '',
          ok: false,
          message: t('timeclock.faceUnknown'),
        })
        return
      }
      const emp = activeEmployees.find((e) => e.id === hit.employeeId)
      if (!emp) return
      const punch = onPunch({
        employeeId: emp.id,
        method: 'face',
        deviceLabel,
        confidence: hit.score,
      })
      showResult(punch, emp)
    } catch {
      setFlash({
        kind: 'in',
        name: '',
        time: '',
        ok: false,
        message: t('timeclock.faceModelError'),
      })
    } finally {
      setBusy(false)
    }
  }

  const clock = now.toLocaleTimeString(locale === 'ka' ? 'ka-GE' : 'ru-GE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const dateLabel = now.toLocaleDateString(locale === 'ka' ? 'ka-GE' : 'ru-GE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  const empName = (id: string) =>
    store.employees.find((e) => e.id === id)?.fullName ?? id.slice(0, 6)

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col gap-4 px-4 py-6">
      <div className="text-center">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">
          {t('timeclock.title')}
        </div>
        <div className="mt-1 font-mono text-5xl font-semibold tabular-nums text-stone-900">
          {clock}
        </div>
        <div className="mt-1 text-sm capitalize text-stone-500">{dateLabel}</div>
      </div>

      <div className="flex rounded-sm border border-grid bg-white p-1">
        <button
          type="button"
          className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium ${
            mode === 'pin' ? 'bg-teal-700 text-white' : 'text-stone-600'
          }`}
          onClick={() => setMode('pin')}
        >
          {t('timeclock.modePin')}
        </button>
        <button
          type="button"
          className={`flex-1 rounded-sm px-3 py-2 text-sm font-medium ${
            mode === 'face' ? 'bg-teal-700 text-white' : 'text-stone-600'
          }`}
          onClick={() => setMode('face')}
        >
          {t('timeclock.modeFace')}
        </button>
      </div>

      {mode === 'pin' ? (
        <div className="rounded-sm border border-grid bg-white p-4 shadow-sm">
          <div className="mb-3 text-center font-mono text-3xl tracking-[0.35em] text-stone-800">
            {pin ? '•'.repeat(pin.length) : '····'}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((key) => (
              <button
                key={key}
                type="button"
                disabled={busy}
                className="rounded-sm border border-grid bg-stone-50 py-4 text-lg font-semibold text-stone-800 active:bg-teal-50 disabled:opacity-50"
                onClick={() => {
                  if (key === '⌫') setPin((p) => p.slice(0, -1))
                  else if (key === 'OK') void submitPin()
                  else if (pin.length < 6) setPin((p) => p + key)
                }}
              >
                {key}
              </button>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-stone-400">{t('timeclock.pinHint')}</p>
        </div>
      ) : (
        <div className="rounded-sm border border-grid bg-white p-3 shadow-sm">
          <div className="overflow-hidden rounded-sm bg-stone-900">
            <video
              ref={videoRef}
              className="aspect-square w-full object-cover"
              playsInline
              muted
            />
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-3 w-full rounded-sm bg-teal-700 py-3 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void submitFace()}
          >
            {busy ? t('timeclock.faceLoading') : t('timeclock.faceCapture')}
          </button>
          <p className="mt-2 text-center text-xs text-stone-400">{t('timeclock.faceHint')}</p>
        </div>
      )}

      {flash ? (
        <div
          className={`rounded-sm border px-4 py-3 text-center ${
            flash.ok
              ? flash.kind === 'in'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                : 'border-amber-300 bg-amber-50 text-amber-950'
              : 'border-rose-300 bg-rose-50 text-rose-900'
          }`}
        >
          {flash.ok ? (
            <>
              <div className="text-lg font-semibold">{flash.name}</div>
              <div className="text-sm">
                {flash.kind === 'in' ? t('timeclock.markedIn') : t('timeclock.markedOut')} ·{' '}
                {flash.time}
              </div>
            </>
          ) : (
            <div className="text-sm font-medium">{flash.message}</div>
          )}
        </div>
      ) : null}

      <div className="rounded-sm border border-grid bg-white">
        <div className="border-b border-grid px-3 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
          {t('timeclock.todayList')}
        </div>
        <ul className="max-h-56 divide-y divide-grid overflow-auto text-sm">
          {todayPunches.length === 0 ? (
            <li className="px-3 py-4 text-center text-stone-400">{t('timeclock.todayEmpty')}</li>
          ) : (
            todayPunches.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate font-medium text-stone-800">
                  {empName(p.employeeId)}
                </span>
                <span className="shrink-0 tabular-nums text-stone-500">
                  {p.kind === 'in' ? t('timeclock.in') : t('timeclock.out')}{' '}
                  {formatPunchTime(p.at, locale === 'ka' ? 'ka-GE' : 'ru-GE')}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}

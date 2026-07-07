import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { CloseIcon } from '@/components/ui/icons'
import { useI18n } from '@/context/I18nContext'
import type { RoomClimateRecord } from '@/lib/technologist/types'
import { TechnologistRoomClimateJournal } from './TechnologistRoomClimateJournal'

type Props = {
  records: RoomClimateRecord[]
  operatorName?: string
  onFix: (entry: Omit<RoomClimateRecord, 'id' | 'createdAt'>) => void
  onRemove?: (id: string) => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function num(v: string): number | undefined {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

const FAB_CLASS =
  'fixed z-[90] bottom-5 left-5 max-lg:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] print:hidden'

const DRAWER_CLASS =
  'fixed z-[90] inset-y-0 right-0 flex w-[min(20rem,calc(100vw-1rem))] flex-col border-l border-sky-200 bg-white shadow-2xl animate-[climateDrawerIn_0.2s_ease-out] max-lg:inset-x-0 max-lg:top-auto max-lg:max-h-[min(28rem,85vh)] max-lg:w-auto max-lg:rounded-t-md max-lg:border-l-0 max-lg:border-t print:hidden'

export function TechnologistRoomClimateWidget({
  records,
  operatorName,
  onFix,
  onRemove,
}: Props) {
  const { t, tf } = useI18n()
  const [open, setOpen] = useState(false)
  const [temperature, setTemperature] = useState('')
  const [humidity, setHumidity] = useState('')
  const [error, setError] = useState('')
  const [fixedSummary, setFixedSummary] = useState('')

  const today = todayIso()
  const todayCount = useMemo(
    () => records.filter((r) => r.measuredDate === today).length,
    [records, today],
  )
  const last = records[0]

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleFix() {
    const temperatureC = num(temperature)
    const humidityPct = num(humidity)
    if (temperatureC == null) {
      setError(t('technologist.climate.errorTemp'))
      return
    }
    if (humidityPct == null || humidityPct < 0 || humidityPct > 100) {
      setError(t('technologist.climate.errorHumidity'))
      return
    }

    const measuredDate = todayIso()
    const measuredTime = nowTime()
    setError('')
    onFix({
      measuredDate,
      measuredTime,
      temperatureC,
      humidityPct,
      recordedByName: operatorName,
    })
    setFixedSummary(
      tf('technologist.climate.fixedOk', {
        temp: temperatureC.toFixed(1),
        humidity: humidityPct.toFixed(0),
        time: measuredTime,
      }),
    )
    setTemperature('')
    setHumidity('')
  }

  if (!open) {
    return (
      <button
        type="button"
        title={t('technologist.climate.open')}
        aria-label={t('technologist.climate.open')}
        className={`${FAB_CLASS} flex h-12 min-w-12 items-center gap-2 rounded-sm border border-sky-500 bg-sky-600 px-3 text-white shadow-md transition hover:bg-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500`}
        onClick={() => {
          setFixedSummary('')
          setError('')
          setOpen(true)
        }}
      >
        <span className="text-sm font-bold tracking-tight">t° / φ</span>
        {todayCount > 0 ? (
          <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold tabular-nums">
            {todayCount}
          </span>
        ) : last ? (
          <span className="hidden text-xs tabular-nums opacity-90 sm:inline">
            {last.temperatureC.toFixed(0)}° · {last.humidityPct.toFixed(0)}%
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('common.close')}
        className="fixed inset-0 z-[89] bg-stone-900/30 print:hidden"
        onClick={() => setOpen(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('technologist.climate.title')}
        className={DRAWER_CLASS}
        style={{
          bottom: 'max(0px, env(safe-area-inset-bottom))',
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-2 border-b border-sky-100 bg-sky-50 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">
              {t('technologist.climate.badge')}
            </p>
            <h2 className="text-sm font-semibold text-sky-950">
              {t('technologist.climate.title')}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-sm p-1 text-stone-500 hover:bg-white hover:text-stone-800"
            onClick={() => setOpen(false)}
            aria-label={t('common.close')}
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t('technologist.climate.temperature')}>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="22.5"
                autoFocus
                className="text-lg tabular-nums"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFix()
                }}
              />
            </FormField>
            <FormField label={t('technologist.climate.humidity')}>
              <Input
                type="number"
                inputMode="decimal"
                step="1"
                min={0}
                max={100}
                placeholder="55"
                className="text-lg tabular-nums"
                value={humidity}
                onChange={(e) => setHumidity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleFix()
                }}
              />
            </FormField>
          </div>

          {error ? (
            <p className="rounded-sm bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">
              {error}
            </p>
          ) : null}

          {fixedSummary ? (
            <p className="rounded-sm bg-teal-50 px-3 py-2 text-xs text-teal-800 ring-1 ring-teal-200">
              {fixedSummary}
            </p>
          ) : null}

          <Button type="button" variant="primary" className="min-h-11 w-full" onClick={handleFix}>
            {t('technologist.climate.fix')}
          </Button>

          <div className="min-h-0 border-t border-stone-100 pt-2">
            <p className="mb-2 text-xs font-medium text-stone-600">
              {t('technologist.climate.journalToday')}
            </p>
            <TechnologistRoomClimateJournal
              records={records.filter((r) => r.measuredDate === today)}
              onRemove={onRemove}
              maxHeightClass="max-h-36"
              compact
            />
          </div>
        </div>
      </aside>
    </>
  )
}

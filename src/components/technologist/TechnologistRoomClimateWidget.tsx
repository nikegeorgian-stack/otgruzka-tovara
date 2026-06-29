import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { RoomClimateRecord } from '@/lib/technologist/types'
import { TechnologistRoomClimateJournal } from './TechnologistRoomClimateJournal'

type Props = {
  records: RoomClimateRecord[]
  operatorName?: string
  onFix: (entry: Omit<RoomClimateRecord, 'id' | 'createdAt'>) => void
  onRemove: (id: string) => void
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

export function TechnologistRoomClimateWidget({
  records,
  operatorName,
  onFix,
  onRemove,
}: Props) {
  const { t } = useI18n()
  const [measuredDate, setMeasuredDate] = useState(todayIso)
  const [measuredTime, setMeasuredTime] = useState(nowTime)
  const [temperature, setTemperature] = useState('')
  const [humidity, setHumidity] = useState('')
  const [roomLabel, setRoomLabel] = useState('')
  const [error, setError] = useState('')
  const [journalOpen, setJournalOpen] = useState(true)

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
    if (!measuredDate) {
      setError(t('technologist.climate.errorDate'))
      return
    }

    setError('')
    onFix({
      measuredDate,
      measuredTime: measuredTime || '00:00',
      temperatureC,
      humidityPct,
      roomLabel: roomLabel.trim() || undefined,
      recordedByName: operatorName,
    })
    setTemperature('')
    setHumidity('')
    setJournalOpen(true)
  }

  return (
    <section
      className="mb-4 overflow-hidden rounded-sm border-2 border-sky-400/70 bg-sky-50 shadow-md ring-1 ring-sky-200/50"
      aria-label={t('technologist.climate.title')}
    >
      <div className="border-b border-sky-200/70 bg-sky-500/10 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              {t('technologist.climate.badge')}
            </p>
            <h2 className="text-base font-semibold text-sky-950 sm:text-lg">
              {t('technologist.climate.title')}
            </h2>
            <p className="mt-0.5 text-xs text-sky-800/80 sm:text-sm">
              {t('technologist.climate.hint')}
            </p>
          </div>
          <span className="rounded-sm bg-sky-500 px-3 py-1 text-xs font-medium text-white shadow-sm">
            {records.length}
          </span>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <FormField label={t('technologist.climate.date')}>
            <Input
              type="date"
              value={measuredDate}
              onChange={(e) => setMeasuredDate(e.target.value)}
            />
          </FormField>
          <FormField label={t('technologist.climate.time')}>
            <Input
              type="time"
              value={measuredTime}
              onChange={(e) => setMeasuredTime(e.target.value)}
            />
          </FormField>
          <FormField label={t('technologist.climate.temperature')}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder="22.5"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
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
              value={humidity}
              onChange={(e) => setHumidity(e.target.value)}
            />
          </FormField>
          <FormField label={t('technologist.climate.room')}>
            <Input
              value={roomLabel}
              onChange={(e) => setRoomLabel(e.target.value)}
              placeholder={t('technologist.climate.roomPlaceholder')}
            />
          </FormField>
        </div>

        {error ? (
          <p className="rounded-sm bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleFix}
            className="inline-flex min-h-11 items-center justify-center rounded-sm bg-sky-700 px-6 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
          >
            {t('technologist.climate.fix')}
          </button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              setMeasuredDate(todayIso())
              setMeasuredTime(nowTime())
            }}
          >
            {t('technologist.climate.now')}
          </Button>
        </div>

        <div className="rounded-sm border border-sky-200/80 bg-white/70">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-sky-950"
            onClick={() => setJournalOpen((v) => !v)}
          >
            <span>{t('technologist.climate.journal')}</span>
            <span className="text-xs text-sky-700">{journalOpen ? '▲' : '▼'}</span>
          </button>

          {journalOpen ? (
            <div className="border-t border-sky-100 px-2 pb-3 pt-1">
              <TechnologistRoomClimateJournal
                records={records}
                onRemove={onRemove}
                maxHeightClass="max-h-72"
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { HrRegistryMissingPicker } from '@/components/hr/HrRegistryMissingPicker'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { loadXlsx } from '@/lib/lazy/xlsx'
import {
  analyzeRegistryImport,
  mergeEmployeesFromRegistry,
  parseRegistrySheet,
  pickRegistryWorksheet,
  registryPersonKey,
  type RegistryImportStats,
  type RegistryPerson,
} from '@/lib/hr/registryImport'
import type { Employee } from '@/lib/types'

type Props = {
  employees: Employee[]
  brigades: string[]
  onImport: (employees: Employee[]) => void
  onClearAllPersonnel?: () => void
}

export function HrRegistryImportPanel({
  employees,
  brigades,
  onImport,
  onClearAllPersonnel,
}: Props) {
  const { t, tf } = useI18n()
  const { confirm } = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ type: 'info' | 'error'; message: string } | null>(null)
  const [lastStats, setLastStats] = useState<RegistryImportStats | null>(null)
  const [missingPicker, setMissingPicker] = useState<{
    registry: RegistryPerson[]
    missing: RegistryPerson[]
    matchedCount: number
  } | null>(null)

  function finishImport(registry: RegistryPerson[], createMissingKeys: Set<string>) {
    const { employees: merged, stats } = mergeEmployeesFromRegistry(
      employees,
      registry,
      brigades,
      { matchByName: true, createMissingKeys },
    )
    onImport(merged)
    setLastStats(stats)
    setNotice({
      type: 'info',
      message: tf('hr.registryImport.done', {
        matched: stats.matched,
        created: stats.created,
        total: stats.totalInRegistry,
        left: stats.notInRegistry,
        skipped: stats.skipped ?? 0,
      }),
    })
  }

  async function handleFile(file: File) {
    setBusy(true)
    setNotice(null)
    try {
      const XLSX = await loadXlsx()
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const sheet = pickRegistryWorksheet(wb, XLSX)
      if (!sheet) throw new Error('empty_sheet')
      const registry = parseRegistrySheet(sheet, XLSX)
      if (!registry.length) throw new Error('no_rows')

      const analysis = analyzeRegistryImport(employees, registry)

      if (
        !(await confirm({
          message: tf('hr.registryImport.confirmByName', {
            total: registry.length,
            matched: analysis.matched.length,
            missing: analysis.missingInDb.length,
            existing: employees.length,
          }),
        }))
      ) {
        return
      }

      if (analysis.missingInDb.length > 0) {
        setMissingPicker({
          registry,
          missing: analysis.missingInDb,
          matchedCount: analysis.matched.length,
        })
        return
      }

      finishImport(registry, new Set())
    } catch {
      setNotice({ type: 'error', message: t('hr.registryImport.error') })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleClear() {
    if (!onClearAllPersonnel) return
    if (
      !(await confirm({
        message: tf('hr.registryImport.clearConfirm', { count: employees.length }),
        confirmLabel: t('hr.registryImport.clearConfirmBtn'),
        danger: true,
      }))
    ) {
      return
    }
    onClearAllPersonnel()
    setLastStats(null)
    setNotice({ type: 'info', message: t('hr.registryImport.clearDone') })
  }

  return (
    <>
      <section className="rounded-sm border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-wide text-violet-900">
          {t('hr.registryImport.title')}
        </h3>
        <p className="mt-1 text-sm text-stone-600">{t('hr.registryImport.hint')}</p>

        {notice && (
          <div className="mt-3">
            <FormNotice type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />
          </div>
        )}

        {lastStats && (
          <ul className="mt-3 space-y-1 text-xs text-stone-600">
            <li>{tf('hr.registryImport.statMatched', { n: lastStats.matched })}</li>
            <li>{tf('hr.registryImport.statCreated', { n: lastStats.created })}</li>
            {(lastStats.skipped ?? 0) > 0 && (
              <li>{tf('hr.registryImport.statSkipped', { n: lastStats.skipped ?? 0 })}</li>
            )}
            <li>{tf('hr.registryImport.statLeft', { n: lastStats.notInRegistry })}</li>
          </ul>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.ods,application/vnd.oasis.opendocument.spreadsheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        <Button
          type="button"
          className="mt-4"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? t('hr.registryImport.busy') : t('hr.registryImport.chooseFile')}
        </Button>
        {onClearAllPersonnel && employees.length > 0 && (
          <Button
            type="button"
            variant="danger"
            className="mt-4 ml-2"
            disabled={busy}
            onClick={() => void handleClear()}
          >
            {t('hr.registryImport.clearAll')}
          </Button>
        )}
      </section>

      {missingPicker && (
        <HrRegistryMissingPicker
          open
          missing={missingPicker.missing}
          matchedCount={missingPicker.matchedCount}
          onCancel={() => {
            setMissingPicker(null)
            setBusy(false)
          }}
          onConfirm={(keys) => {
            const normalized = new Set<string>()
            for (const person of missingPicker.missing) {
              const key = registryPersonKey(person)
              if (keys.has(key)) normalized.add(key)
            }
            finishImport(missingPicker.registry, normalized)
            setMissingPicker(null)
            setBusy(false)
          }}
        />
      )}
    </>
  )
}

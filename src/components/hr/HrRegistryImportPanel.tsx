import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { useConfirm } from '@/context/ConfirmContext'
import { loadXlsx } from '@/lib/lazy/xlsx'
import {
  mergeEmployeesFromRegistry,
  parseRegistrySheet,
  type RegistryImportStats,
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

  async function handleFile(file: File) {
    setBusy(true)
    setNotice(null)
    try {
      const XLSX = await loadXlsx()
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: false })
      const sheet = wb.Sheets[wb.SheetNames[0] ?? '']
      if (!sheet) throw new Error('empty_sheet')
      const registry = parseRegistrySheet(sheet, XLSX)
      if (!registry.length) throw new Error('no_rows')

      if (
        !(await confirm({
          message: tf('hr.registryImport.confirm', {
            count: registry.length,
            existing: employees.length,
          }),
        }))
      ) {
        return
      }

      let replaceExisting = employees.length === 0
      if (employees.length > 0) {
        replaceExisting = await confirm({
          message: t('hr.registryImport.replaceConfirm'),
          confirmLabel: t('hr.registryImport.replaceConfirmBtn'),
          cancelLabel: t('hr.registryImport.mergeConfirmBtn'),
        })
      }

      const { employees: merged, stats } = mergeEmployeesFromRegistry(
        employees,
        registry,
        brigades,
        { replaceExisting },
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
        }),
      })
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
          <li>{tf('hr.registryImport.statLeft', { n: lastStats.notInRegistry })}</li>
        </ul>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
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
  )
}

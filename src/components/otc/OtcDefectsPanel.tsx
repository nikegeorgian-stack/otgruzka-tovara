import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import { localTodayYmd } from '@/lib/otc/calc'
import {
  compressImageFile,
  defectStageLabel,
  defectStatusLabel,
} from '@/lib/otc/labels'
import type {
  OtcDefectCase,
  OtcDefectPhoto,
  OtcDefectStage,
  OtcDefectStatus,
  OtcStore,
} from '@/lib/otc/types'

type Props = {
  store: OtcStore
  operatorName?: string
  onSave: (entry: Omit<OtcDefectCase, 'id' | 'createdAt'> & { id?: string }) => void
  onRemove: (id: string) => void
}

export function OtcDefectsPanel({ store, operatorName, onSave, onRemove }: Props) {
  const { t, locale } = useI18n()
  const [foundAt, setFoundAt] = useState(localTodayYmd())
  const [stage, setStage] = useState<OtcDefectStage>('greige')
  const [productName, setProductName] = useState('')
  const [batchNo, setBatchNo] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeName, setAssigneeName] = useState('')
  const [photos, setPhotos] = useState<OtcDefectPhoto[]>([])
  const [busy, setBusy] = useState(false)

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      const next: OtcDefectPhoto[] = [...photos]
      for (const file of Array.from(files)) {
        if (next.length >= 6) break
        if (!file.type.startsWith('image/')) continue
        const dataUrl = await compressImageFile(file)
        next.push({
          id: crypto.randomUUID(),
          dataUrl,
          createdAt: new Date().toISOString(),
        })
      }
      setPhotos(next)
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!productName.trim() || !description.trim()) return
    onSave({
      foundAt,
      stage,
      productName: productName.trim(),
      batchNo: batchNo.trim() || undefined,
      description: description.trim(),
      photos,
      status: 'open',
      assigneeName: assigneeName.trim() || undefined,
      createdByName: operatorName,
    })
    setDescription('')
    setPhotos([])
    setBatchNo('')
  }

  function setStatus(row: OtcDefectCase, status: OtcDefectStatus) {
    onSave({
      id: row.id,
      foundAt: row.foundAt,
      stage: row.stage,
      productName: row.productName,
      batchNo: row.batchNo,
      description: row.description,
      photos: row.photos,
      status,
      assigneeName: row.assigneeName,
      resolution: row.resolution,
      createdByName: row.createdByName,
    })
  }

  const rows = [...store.defects].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{t('otc.defects.title')}</h3>
        <p className="text-xs text-slate-500">{t('otc.defects.hint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label={t('otc.date')}>
            <Input type="date" value={foundAt} onChange={(e) => setFoundAt(e.target.value)} />
          </FormField>
          <FormField label={t('otc.defects.stage')}>
            <select
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={stage}
              onChange={(e) => setStage(e.target.value as OtcDefectStage)}
            >
              <option value="greige">{defectStageLabel('greige', locale)}</option>
              <option value="finished">{defectStageLabel('finished', locale)}</option>
              <option value="other">{defectStageLabel('other', locale)}</option>
            </select>
          </FormField>
          <FormField label={t('otc.productName')}>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.batchNo')}>
            <Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </FormField>
          <FormField label={t('otc.defects.assignee')}>
            <Input value={assigneeName} onChange={(e) => setAssigneeName(e.target.value)} />
          </FormField>
          <FormField label={t('otc.defects.description')}>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
        <FormField label={t('otc.defects.photos')}>
          <input
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            disabled={busy || photos.length >= 6}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </FormField>
        {photos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                className="relative h-20 w-20 overflow-hidden rounded border"
                title={t('otc.defects.removePhoto')}
                onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
              >
                <img src={p.dataUrl} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <Button
          type="button"
          onClick={save}
          disabled={!productName.trim() || !description.trim() || busy}
        >
          {t('otc.save')}
        </Button>
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('otc.defects.journal')}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t('otc.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {r.foundAt} · {r.productName}
                      {r.batchNo ? ` · ${r.batchNo}` : ''}
                    </div>
                    <div className="text-xs text-slate-500">
                      {defectStageLabel(r.stage, locale)} · {defectStatusLabel(r.status, locale)}
                      {r.assigneeName ? ` · ${r.assigneeName}` : ''}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{r.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'open' && (
                      <Button type="button" onClick={() => setStatus(r, 'in_progress')}>
                        {t('otc.defects.toWork')}
                      </Button>
                    )}
                    {r.status !== 'closed' && (
                      <Button type="button" onClick={() => setStatus(r, 'closed')}>
                        {t('otc.defects.close')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() => {
                        if (confirm(t('otc.deleteConfirm'))) onRemove(r.id)
                      }}
                    >
                      {t('otc.delete')}
                    </Button>
                  </div>
                </div>
                {r.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.photos.map((p) => (
                      <a
                        key={p.id}
                        href={p.dataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="h-16 w-16 overflow-hidden rounded border"
                      >
                        <img src={p.dataUrl} alt="" className="h-full w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

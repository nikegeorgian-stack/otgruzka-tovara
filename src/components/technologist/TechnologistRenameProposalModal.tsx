import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'
import type { CreateItemRenameRequestInput } from '@/lib/warehouse/itemRenameRequests'
import type { WarehouseItem } from '@/lib/warehouse/types'

type Props = {
  item: WarehouseItem
  operatorId?: string
  operatorName?: string
  onSubmit: (input: CreateItemRenameRequestInput) => { ok: boolean; error?: string }
  onClose: () => void
}

export function TechnologistRenameProposalModal({
  item,
  operatorId,
  operatorName,
  onSubmit,
  onClose,
}: Props) {
  const { t } = useI18n()
  const [proposedName, setProposedName] = useState(item.name)
  const [proposedUnit, setProposedUnit] = useState(item.unit)
  const [proposedSku, setProposedSku] = useState(item.sku ?? '')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit() {
    if (!operatorId || !operatorName) return
    const result = onSubmit({
      itemId: item.id,
      proposedName,
      proposedUnit,
      proposedSku: proposedSku || undefined,
      note: notice || undefined,
      requestedBy: operatorId,
      requestedByName: operatorName,
    })
    if (!result.ok) {
      setError(
        result.error === 'already_open'
          ? t('technologist.renameErrOpen')
          : t('technologist.renameErrGeneric'),
      )
      return
    }
    onClose()
  }

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('technologist.renameTitle')}
      subtitle={item.internalCode}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!proposedName.trim()}>
            {t('technologist.renameSend')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <p className="text-sm text-red-700">{error}</p>}
        <p className="rounded-sm bg-stone-100 px-3 py-2 text-sm">
          <span className="text-stone-500">{t('technologist.renameCurrent')}:</span>{' '}
          <span className="font-medium">{item.name}</span>
          <span className="text-stone-400"> · {item.unit}</span>
        </p>
        <FormField label={t('technologist.renameProposedName')}>
          <Input value={proposedName} onChange={(e) => setProposedName(e.target.value)} autoFocus />
        </FormField>
        <FormField label={t('technologist.renameProposedUnit')}>
          <Input value={proposedUnit} onChange={(e) => setProposedUnit(e.target.value)} />
        </FormField>
        <FormField label={t('technologist.renameProposedSku')}>
          <Input
            value={proposedSku}
            onChange={(e) => setProposedSku(e.target.value)}
            placeholder={t('technologist.renameSkuPh')}
          />
        </FormField>
        <FormField label={t('technologist.renameNote')}>
          <Input
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder={t('technologist.renameNotePh')}
          />
        </FormField>
        <p className="text-xs text-stone-500">{t('technologist.renameHint')}</p>
      </div>
    </AppDialog>
  )
}

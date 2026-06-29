import { useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { useI18n } from '@/context/I18nContext'

type Props = {
  dateKey: string
  initial: string
  onSave: (text: string) => void
  onClose: () => void
}

export function CellCommentModal({ dateKey, initial, onSave, onClose }: Props) {
  const { t } = useI18n()
  const [text, setText] = useState(initial)

  return (
    <AppDialog
      open
      onClose={onClose}
      title={t('comment.title')}
      subtitle={dateKey}
      size="md"
      zIndex={110}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onSave(text)
              onClose()
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="px-5 py-4">
        <FormField label={t('comment.placeholder')}>
          <Input
            as="textarea"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('comment.placeholder')}
          />
        </FormField>
      </div>
    </AppDialog>
  )
}

import { useRef } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import {
  WarehouseInventoryRevisionEditor,
  type InventoryRevisionEditorHandle,
} from '@/components/warehouse/WarehouseInventoryRevisionEditor'
import { useConfirm } from '@/context/ConfirmContext'
import { requestModalClose } from '@/lib/ui/requestModalClose'
import type { ComponentProps } from 'react'

type EditorProps = ComponentProps<typeof WarehouseInventoryRevisionEditor>

type Props = {
  open: boolean
  title: string
  onClose: () => void
  zIndex?: number
} & Omit<EditorProps, 'onCancel' | 'hideCloseButton'>

export function WarehouseInventoryRevisionModal({
  open,
  title,
  onClose,
  zIndex = 100,
  ...editorProps
}: Props) {
  const editorRef = useRef<InventoryRevisionEditorHandle>(null)
  const { confirmUnsaved } = useConfirm()

  function requestClose() {
    void requestModalClose(
      { confirmUnsaved },
      {
        isDirty: () => editorRef.current?.isDirty() ?? false,
        save: () => {
          const result = editorRef.current?.saveDraft()
          return result?.ok === true
        },
        close: onClose,
      },
    )
  }

  return (
    <AppDialog
      open={open}
      onClose={requestClose}
      title={title}
      size="preview"
      zIndex={zIndex}
      onPrimaryAction={() => {
        editorRef.current?.saveDraft()
      }}
      initialFocus="none"
    >
      <div className="flex min-h-[min(70vh,720px)] flex-col px-4 py-4">
        <WarehouseInventoryRevisionEditor
          ref={editorRef}
          {...editorProps}
          hideCloseButton
          onCancel={requestClose}
        />
      </div>
    </AppDialog>
  )
}

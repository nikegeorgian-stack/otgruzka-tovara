import { useEffect, useRef } from 'react'

/** Восстановить черновик при переключении вкладки рабочего стола */
export function useWorkspaceDraftRestore<T>(
  draftKey: string,
  onRestore: (draft: T) => void,
  restoreSeq: number,
  drafts: Record<string, unknown>,
) {
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore

  useEffect(() => {
    const draft = drafts[draftKey]
    if (draft !== undefined) {
      onRestoreRef.current(draft as T)
    }
  }, [draftKey, restoreSeq, drafts])
}

import { useCallback } from 'react'
import type { UserViewDefaults } from '@/lib/viewDefaults/types'

type SaveFn = <K extends keyof UserViewDefaults>(
  viewId: K,
  patch: NonNullable<UserViewDefaults[K]>,
) => void

/** Применить сохранённые настройки + колбэк сохранения в профиль. */
export function useViewDefaultsSave(
  onSave?: SaveFn,
): { save: SaveFn | undefined } {
  const save = useCallback(
    <K extends keyof UserViewDefaults>(viewId: K, patch: NonNullable<UserViewDefaults[K]>) => {
      onSave?.(viewId, patch)
    },
    [onSave],
  )
  return { save: onSave ? save : undefined }
}

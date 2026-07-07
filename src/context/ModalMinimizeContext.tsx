import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type MinimizedModalItem = {
  id: string
  title: string
  restore: () => void
  close: () => void
}

type ModalMinimizeContextValue = {
  items: MinimizedModalItem[]
  minimize: (item: MinimizedModalItem) => void
  restore: (id: string) => void
  remove: (id: string) => void
}

const ModalMinimizeContext = createContext<ModalMinimizeContextValue | null>(null)

export function ModalMinimizeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<MinimizedModalItem[]>([])

  const minimize = useCallback((item: MinimizedModalItem) => {
    setItems((prev) => {
      const rest = prev.filter((p) => p.id !== item.id)
      return [...rest, item]
    })
  }, [])

  const restore = useCallback((id: string) => {
    setItems((prev) => {
      const item = prev.find((p) => p.id === id)
      item?.restore()
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const value = useMemo(
    () => ({ items, minimize, restore, remove }),
    [items, minimize, restore, remove],
  )

  return <ModalMinimizeContext.Provider value={value}>{children}</ModalMinimizeContext.Provider>
}

export function useModalMinimize() {
  const ctx = useContext(ModalMinimizeContext)
  if (!ctx) {
    throw new Error('useModalMinimize must be used within ModalMinimizeProvider')
  }
  return ctx
}

/** Безопасный вариант для AppDialog (не падает без провайдера). */
export function useModalMinimizeOptional() {
  return useContext(ModalMinimizeContext)
}

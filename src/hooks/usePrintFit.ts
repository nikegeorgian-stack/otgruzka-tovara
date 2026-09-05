import { useCallback, useLayoutEffect, type RefObject } from 'react'
import { fitPrintPages, resetPrintFit, type PrintFitOpts } from '@/lib/printFit'

type Options = PrintFitOpts & {
  /** Выключить подгонку (например, если пользователь снял «на 1 лист»). */
  enabled?: boolean
  /** Перезапуск после смены данных бланка. */
  deps?: ReadonlyArray<unknown>
}

/**
 * Автоподгонка печатного превью: rAF + ResizeObserver + сброс при размонтировании.
 * Вызывать `runFit()` перед window.print / PDF.
 */
export function usePrintFit(
  printRef: RefObject<HTMLElement | null>,
  opts: Options = {},
): { runFit: () => void } {
  const enabled = opts.enabled !== false
  const shrinkOnly = opts.shrinkOnly
  const portrait = opts.portrait
  const paper = opts.paper
  const deps = opts.deps ?? []

  const runFit = useCallback(() => {
    if (!enabled) return
    fitPrintPages(printRef.current, { shrinkOnly, portrait, paper })
  }, [enabled, printRef, portrait, paper, shrinkOnly])

  useLayoutEffect(() => {
    if (!enabled) {
      resetPrintFit(printRef.current)
      return
    }

    let cancelled = false
    const schedule = () => {
      if (cancelled) return
      requestAnimationFrame(() => {
        if (cancelled) return
        runFit()
      })
    }

    const id = requestAnimationFrame(schedule)
    const el = printRef.current
    const ro =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => schedule())
        : null
    if (el && ro) ro.observe(el)

    return () => {
      cancelled = true
      cancelAnimationFrame(id)
      ro?.disconnect()
      resetPrintFit(printRef.current)
    }
    // deps — содержимое бланка (model, rows, …)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps from caller
  }, [enabled, printRef, runFit, ...deps])

  return { runFit }
}

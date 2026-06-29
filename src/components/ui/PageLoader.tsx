/** Минимальный индикатор при lazy-load страниц и тяжёлых модулей. */
export function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-8" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-stone-500">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-600"
          aria-hidden
        />
        <span className="text-sm">Загрузка…</span>
      </div>
    </div>
  )
}

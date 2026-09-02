/** Короткая пометка: этот экран пишет в тот же AppStore, что и «канонический» раздел. */

type Props = {
  children: React.ReactNode
  action?: React.ReactNode
}

export function SharedDataNotice({ children, action }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <p className="min-w-0 flex-1">{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

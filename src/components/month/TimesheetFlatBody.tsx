import { Fragment, type ReactNode } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import type { TimesheetVirtualItem } from '@/lib/monthTimesheetLayout'

type Props = {
  items: TimesheetVirtualItem[]
  colSpan: number
  virtualizer?: Virtualizer<HTMLDivElement, Element>
  renderItem: (item: TimesheetVirtualItem) => ReactNode
}

export function TimesheetFlatBody({ items, colSpan, virtualizer, renderItem }: Props) {
  if (!virtualizer) {
    return (
      <>
        {items.map((item) => (
          <Fragment key={item.key}>{renderItem(item)}</Fragment>
        ))}
      </>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()
  const padTop = virtualRows[0]?.start ?? 0
  const padBottom =
    virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)

  return (
    <>
      {padTop > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={colSpan}
            style={{ height: padTop, padding: 0, border: 'none', lineHeight: 0 }}
          />
        </tr>
      )}
      {virtualRows.map((vr) => {
        const item = items[vr.index]
        return <Fragment key={item.key}>{renderItem(item)}</Fragment>
      })}
      {padBottom > 0 && (
        <tr aria-hidden="true">
          <td
            colSpan={colSpan}
            style={{ height: padBottom, padding: 0, border: 'none', lineHeight: 0 }}
          />
        </tr>
      )}
    </>
  )
}

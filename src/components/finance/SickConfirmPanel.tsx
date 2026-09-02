import type { ComponentProps } from 'react'
import { AbsenceConfirmPanel } from './AbsenceConfirmPanel'

type Props = Omit<ComponentProps<typeof AbsenceConfirmPanel>, 'kind'>

export function SickConfirmPanel(props: Props) {
  return <AbsenceConfirmPanel kind="sick" {...props} />
}

export function VacationConfirmPanel(props: Props) {
  return <AbsenceConfirmPanel kind="vacation" {...props} />
}

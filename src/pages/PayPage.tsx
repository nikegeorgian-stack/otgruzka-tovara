import { PageLayout } from '@/components/ui/PageLayout'
import { PayrollPanel } from '@/components/hr/PayrollPanel'
import type { AppStore } from '@/lib/types'

type Props = {
  store: AppStore
  month: string
  onMonthChange: (m: string) => void
}

/** @deprecated Используйте вкладку «Оплата» в разделе Персонал */
export function PayPage({ store, month, onMonthChange }: Props) {
  return (
    <PageLayout>
      <PayrollPanel store={store} month={month} onMonthChange={onMonthChange} />
    </PageLayout>
  )
}

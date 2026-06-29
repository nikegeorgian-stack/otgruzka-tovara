import { useState } from 'react'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import type { FormulationStore } from '@/lib/formulations/types'
import type { TechnologistQcStore } from '@/lib/technologist/types'
import { TechnologistEadCalcPanel } from './TechnologistEadCalcPanel'
import { TechnologistEadControlPanel } from './TechnologistEadControlPanel'
import { TechnologistIncomingControlPanel } from './TechnologistIncomingControlPanel'
import { TechnologistImpregnationQcPanel } from './TechnologistImpregnationQcPanel'

type QcTab = 'eadCalc' | 'eadControl' | 'incoming' | 'impreg'

type Props = {
  qcStore: TechnologistQcStore
  formulations: FormulationStore
  operatorName?: string
  onUpsertEadCalculation: Parameters<typeof TechnologistEadCalcPanel>[0]['onSave']
  onRemoveEadCalculation: (id: string) => void
  onUpsertEadControl: Parameters<typeof TechnologistEadControlPanel>[0]['onSave']
  onRemoveEadControl: (id: string) => void
  onUpsertIncomingControl: Parameters<typeof TechnologistIncomingControlPanel>[0]['onSave']
  onRemoveIncomingControl: (id: string) => void
  onUpsertImpregnationQc: Parameters<typeof TechnologistImpregnationQcPanel>[0]['onSave']
  onRemoveImpregnationQc: (id: string) => void
}

export function TechnologistQcHub(props: Props) {
  const { t } = useI18n()
  const [sub, setSub] = useState<QcTab>('eadCalc')

  const tabs = [
    { id: 'eadCalc' as const, label: t('technologist.qc.tab.eadCalc') },
    { id: 'eadControl' as const, label: t('technologist.qc.tab.eadControl') },
    { id: 'incoming' as const, label: t('technologist.qc.tab.incoming') },
    { id: 'impreg' as const, label: t('technologist.qc.tab.impreg') },
  ]

  return (
    <div>
      <TabBar tabs={tabs} value={sub} onChange={setSub} className="mb-4" />
      {sub === 'eadCalc' && (
        <TechnologistEadCalcPanel
          store={props.qcStore}
          operatorName={props.operatorName}
          onSave={props.onUpsertEadCalculation}
          onRemove={props.onRemoveEadCalculation}
        />
      )}
      {sub === 'eadControl' && (
        <TechnologistEadControlPanel
          store={props.qcStore}
          operatorName={props.operatorName}
          onSave={props.onUpsertEadControl}
          onRemove={props.onRemoveEadControl}
        />
      )}
      {sub === 'incoming' && (
        <TechnologistIncomingControlPanel
          store={props.qcStore}
          onSave={props.onUpsertIncomingControl}
          onRemove={props.onRemoveIncomingControl}
        />
      )}
      {sub === 'impreg' && (
        <TechnologistImpregnationQcPanel
          store={props.qcStore}
          formulations={props.formulations}
          operatorName={props.operatorName}
          onSave={props.onUpsertImpregnationQc}
          onRemove={props.onRemoveImpregnationQc}
        />
      )}
    </div>
  )
}

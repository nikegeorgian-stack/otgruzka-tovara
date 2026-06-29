import type { Locale } from '@/lib/types'

export type ExportLabels = {
  nameRu: string
  nameKa: string
  brigade: string
  schedule: string
  planHours: string
  factHours: string
  payAmount: string
  sheetPlan: string
  sheetFact: string
  brigadeCol: string
  amountCol: string
}

const RU: ExportLabels = {
  nameRu: 'ФИО RU',
  nameKa: 'ФИО GE',
  brigade: 'Бригада',
  schedule: 'График',
  planHours: 'Пл.ч',
  factHours: 'Ф.ч',
  payAmount: 'К начислению ₾',
  sheetPlan: 'План',
  sheetFact: 'Факт',
  brigadeCol: 'Бригада',
  amountCol: 'Сумма ₾',
}

const KA: ExportLabels = {
  nameRu: 'სახელი RU',
  nameKa: 'სახელი GE',
  brigade: 'ბრიგადა',
  schedule: 'გრაფიკი',
  planHours: 'გეგ.სთ',
  factHours: 'ფაქ.სთ',
  payAmount: 'დასარიცხი ₾',
  sheetPlan: 'გეგმა',
  sheetFact: 'ფაქტი',
  brigadeCol: 'ბრიგადა',
  amountCol: 'თანხა ₾',
}

export function exportLabels(locale: Locale): ExportLabels {
  return locale === 'ka' ? KA : RU
}

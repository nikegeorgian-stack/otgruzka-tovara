import type { OrgChartNode } from './types'

type SeedRow = {
  id: string
  parentId?: string
  nameFull: string
  nameShort: string
  sortOrder: number
}

/** Штатная схема ООО «Файберселл» (по утверждённому бланку). */
const FIBERCELL_ORG_SEED: SeedRow[] = [
  { id: 'gd', nameFull: 'Генеральный директор', nameShort: 'ГД', sortOrder: 0 },
  {
    id: 'gd-strat',
    parentId: 'gd',
    nameFull: 'Заместитель генерального директора по стратегическому развитию',
    nameShort: 'ГЗС',
    sortOrder: 0,
  },
  {
    id: 'gd-security',
    parentId: 'gd',
    nameFull: 'Заместитель генерального директора по экономической безопасности',
    nameShort: 'ГЗБ',
    sortOrder: 1,
  },
  {
    id: 'od',
    parentId: 'gd',
    nameFull: 'Операционный директор',
    nameShort: 'ОД',
    sortOrder: 2,
  },
  {
    id: 'odp',
    parentId: 'od',
    nameFull: 'Начальник производства',
    nameShort: 'ОДП',
    sortOrder: 0,
  },
  { id: 'wh', parentId: 'odp', nameFull: 'Склад', nameShort: 'Скл', sortOrder: 0 },
  {
    id: 'odpp',
    parentId: 'odp',
    nameFull: 'Мастер цеха пропитки',
    nameShort: 'ОДПП',
    sortOrder: 1,
  },
  {
    id: 'odpp1',
    parentId: 'odpp',
    nameFull: '1 линия пропитки',
    nameShort: 'ОДП1',
    sortOrder: 0,
  },
  {
    id: 'odpp2',
    parentId: 'odpp',
    nameFull: '2 линия пропитки',
    nameShort: 'ОДП2',
    sortOrder: 1,
  },
  {
    id: 'odplu',
    parentId: 'odp',
    nameFull: 'Упаковка',
    nameShort: 'ОДПЛ/У',
    sortOrder: 2,
  },
  {
    id: 'odpll',
    parentId: 'odp',
    nameFull: 'Логистика',
    nameShort: 'ОДПЛЛ',
    sortOrder: 3,
  },
  {
    id: 'odpt',
    parentId: 'odp',
    nameFull: 'Цех ткачества',
    nameShort: 'ОДПТ',
    sortOrder: 4,
  },
  {
    id: 'odpts',
    parentId: 'odpt',
    nameFull: 'Участок намотки',
    nameShort: 'ОДПТС',
    sortOrder: 0,
  },
  {
    id: 'odptn',
    parentId: 'odpt',
    nameFull: 'Ткацкий участок',
    nameShort: 'ОДПТН',
    sortOrder: 1,
  },
  {
    id: 'odptadj',
    parentId: 'odpt',
    nameFull: 'Регулировщики',
    nameShort: 'ОДПТР',
    sortOrder: 2,
  },
  {
    id: 'gi',
    parentId: 'od',
    nameFull: 'Главный инженер',
    nameShort: 'ГИ',
    sortOrder: 1,
  },
  { id: 'gim', parentId: 'gi', nameFull: 'Главный механик', nameShort: 'ГИМ', sortOrder: 0 },
  { id: 'gims', parentId: 'gim', nameFull: 'Механики', nameShort: 'ГИМС', sortOrder: 0 },
  {
    id: 'gt',
    parentId: 'od',
    nameFull: 'Главный технолог',
    nameShort: 'ГТ',
    sortOrder: 2,
  },
  { id: 'gti', parentId: 'gt', nameFull: 'Технологи', nameShort: 'ГТИ', sortOrder: 0 },
  {
    id: 'gts',
    parentId: 'gt',
    nameFull: 'Операторы линии замеса',
    nameShort: 'ГТС',
    sortOrder: 1,
  },
  {
    id: 'omts',
    parentId: 'od',
    nameFull: 'Отдел материально-технического снабжения',
    nameShort: 'ОМТС',
    sortOrder: 3,
  },
  {
    id: 'kd',
    parentId: 'gd',
    nameFull: 'Коммерческий директор',
    nameShort: 'КД',
    sortOrder: 3,
  },
  {
    id: 'kd-m',
    parentId: 'kd',
    nameFull: 'Отдел маркетинга',
    nameShort: 'КДМ',
    sortOrder: 0,
  },
  { id: 'kd-ved', parentId: 'kd', nameFull: 'Служба ВЭД', nameShort: 'КДВЭД', sortOrder: 1 },
  {
    id: 'kd-sales',
    parentId: 'kd',
    nameFull: 'Отдел продаж',
    nameShort: 'КДП',
    sortOrder: 2,
  },
  {
    id: 'fd',
    parentId: 'gd',
    nameFull: 'Финансовый директор',
    nameShort: 'ФД',
    sortOrder: 4,
  },
  { id: 'fd-acc', parentId: 'fd', nameFull: 'Бухгалтерия', nameShort: 'ФДБ', sortOrder: 0 },
  {
    id: 'fd-plan',
    parentId: 'fd',
    nameFull: 'Расчётно-плановый отдел',
    nameShort: 'ФДРПО',
    sortOrder: 1,
  },
  {
    id: 'hr',
    parentId: 'gd',
    nameFull: 'Кадровая служба',
    nameShort: 'ОК',
    sortOrder: 5,
  },
  {
    id: 'otk',
    parentId: 'gd',
    nameFull: 'Отдел контроля качества (ОТК)',
    nameShort: 'ОТК',
    sortOrder: 6,
  },
  { id: 'legal', parentId: 'gd', nameFull: 'Юридический отдел', nameShort: 'ЮО', sortOrder: 7 },
  {
    id: 'safety',
    parentId: 'gd',
    nameFull: 'Инженер по охране труда',
    nameShort: 'ОТБиОТ',
    sortOrder: 8,
  },
  {
    id: 'secretariat',
    parentId: 'gd',
    nameFull: 'Секретариат / офис-менеджер',
    nameShort: 'Секр',
    sortOrder: 9,
  },
  {
    id: 'it',
    parentId: 'gd-strat',
    nameFull: 'Отдел информационных технологий',
    nameShort: 'ФИТ',
    sortOrder: 0,
  },
  {
    id: 'dev',
    parentId: 'gd-strat',
    nameFull: 'Отдел перспективного развития',
    nameShort: 'ОПР',
    sortOrder: 1,
  },
]

export function buildFiberCellOrgChartSeed(): OrgChartNode[] {
  return FIBERCELL_ORG_SEED.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    nameFull: row.nameFull,
    nameShort: row.nameShort,
    sortOrder: row.sortOrder,
    layoutX: 0,
    layoutY: 0,
  }))
}

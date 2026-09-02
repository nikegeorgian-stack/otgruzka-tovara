import type {
  OtcAlkaliSeries,
  OtcDefectCase,
  OtcLabTest,
  OtcNorm,
  OtcSortingRecord,
  OtcStore,
} from './types'
import { computeAlkaliVerdict, computeLabTestVerdict, defaultUnit } from './calc'

export function createDefaultOtcNorms(): OtcNorm[] {
  /** Стартовые шаблоны — править в разделе «Нормы» под заводские паспорта. */
  const rows: Omit<OtcNorm, 'id'>[] = [
    {
      productKind: 'mesh',
      testKind: 'alkali_resistance',
      labelRu: 'Щёлочестойкость · остаточная прочность',
      labelKa: 'ტუტეგამძლეობა',
      unit: '%',
      residualMinPct: 50,
      active: true,
      note: 'Сравнение разрыва до/после 28 сут в щелочи',
    },
    {
      productKind: 'mesh',
      testKind: 'tensile_strength',
      labelRu: 'Прочность на разрыв',
      unit: 'N',
      min: 0,
      active: true,
    },
    {
      productKind: 'mesh',
      testKind: 'mass_per_area',
      labelRu: 'Масса на единицу площади',
      unit: 'г/м²',
      active: true,
    },
    {
      productKind: 'mesh',
      testKind: 'mesh_size',
      labelRu: 'Размер ячейки',
      unit: 'мм',
      active: true,
    },
    {
      productKind: 'mesh',
      testKind: 'loss_on_ignition',
      labelRu: 'Потери при прокаливании',
      unit: '%',
      active: true,
    },
    {
      productKind: 'rooflex',
      testKind: 'tensile_strength',
      labelRu: 'Прочность на разрыв (руфлекс)',
      unit: 'N',
      active: true,
    },
    {
      productKind: 'rooflex',
      testKind: 'fabric_width',
      labelRu: 'Ширина полотна',
      unit: 'см',
      active: true,
    },
    {
      productKind: 'rooflex',
      testKind: 'threads_per_10cm',
      labelRu: 'Число нитей на 10 см',
      unit: 'нит./10 см',
      active: true,
    },
    {
      productKind: 'membrane',
      testKind: 'water_resistance_w1',
      labelRu: 'Водостойкость W1',
      unit: 'класс',
      min: 1,
      max: 1,
      active: true,
      note: '1 = соответствует W1',
    },
    {
      productKind: 'membrane',
      testKind: 'mass_per_area',
      labelRu: 'Масса на единицу площади (мембрана)',
      unit: 'г/м²',
      active: true,
    },
  ]
  return rows.map((r, i) => ({ ...r, id: `otc-norm-${i + 1}` }))
}

export function createDefaultOtcStore(): OtcStore {
  return {
    norms: createDefaultOtcNorms(),
    labTests: [],
    alkaliSeries: [],
    sorting: [],
    defects: [],
  }
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function normalizeOtcStore(raw: OtcStore | undefined): OtcStore {
  const d = createDefaultOtcStore()
  if (!raw) return d
  const norms = Array.isArray(raw.norms) && raw.norms.length > 0
    ? raw.norms.map(normalizeNorm)
    : d.norms
  return {
    norms,
    labTests: Array.isArray(raw.labTests) ? raw.labTests.map(normalizeLabTest) : [],
    alkaliSeries: Array.isArray(raw.alkaliSeries)
      ? raw.alkaliSeries.map(normalizeAlkali)
      : [],
    sorting: Array.isArray(raw.sorting) ? raw.sorting.map(normalizeSorting) : [],
    defects: Array.isArray(raw.defects) ? raw.defects.map(normalizeDefect) : [],
  }
}

function normalizeNorm(r: OtcNorm): OtcNorm {
  return {
    id: String(r.id || crypto.randomUUID()),
    productKind: r.productKind === 'rooflex' || r.productKind === 'membrane' ? r.productKind : 'mesh',
    testKind: r.testKind,
    labelRu: String(r.labelRu || r.testKind),
    labelKa: str(r.labelKa),
    unit: String(r.unit || defaultUnit(r.testKind)),
    min: num(r.min),
    max: num(r.max),
    residualMinPct: num(r.residualMinPct),
    active: r.active !== false,
    note: str(r.note),
  }
}

function normalizeLabTest(r: OtcLabTest): OtcLabTest {
  const computed =
    r.computed ??
    computeLabTestVerdict({
      value: num(r.value),
      valueSecondary: num(r.valueSecondary),
      normMin: num(r.normMin),
      normMax: num(r.normMax),
    })
  return {
    ...r,
    id: String(r.id || crypto.randomUUID()),
    productKind: r.productKind === 'rooflex' || r.productKind === 'membrane' ? r.productKind : 'mesh',
    testKind: r.testKind,
    testedAt: String(r.testedAt || r.createdAt?.slice(0, 10) || ''),
    productName: String(r.productName || ''),
    batchNo: str(r.batchNo),
    finishedProductId: str(r.finishedProductId),
    value: num(r.value),
    valueSecondary: num(r.valueSecondary),
    unit: String(r.unit || defaultUnit(r.testKind)),
    normId: str(r.normId),
    normMin: num(r.normMin),
    normMax: num(r.normMax),
    controllerName: str(r.controllerName),
    note: str(r.note),
    computed,
    createdAt: String(r.createdAt || new Date().toISOString()),
    updatedAt: str(r.updatedAt),
  }
}

function normalizeAlkali(r: OtcAlkaliSeries): OtcAlkaliSeries {
  const base = {
    strengthBefore: num(r.strengthBefore),
    strengthAfter: num(r.strengthAfter),
    strengthBeforeSecondary: num(r.strengthBeforeSecondary),
    strengthAfterSecondary: num(r.strengthAfterSecondary),
    residualMinPct: num(r.residualMinPct) ?? 50,
    phase: (['before', 'soaking', 'after', 'closed'].includes(r.phase)
      ? r.phase
      : 'before') as OtcAlkaliSeries['phase'],
  }
  return {
    id: String(r.id || crypto.randomUUID()),
    productName: String(r.productName || ''),
    finishedProductId: str(r.finishedProductId),
    batchNo: str(r.batchNo),
    sampleLabel: str(r.sampleLabel),
    soakDate: str(r.soakDate),
    dueDate: str(r.dueDate),
    ...base,
    controllerName: str(r.controllerName),
    note: str(r.note),
    computed: r.computed ?? computeAlkaliVerdict(base),
    createdAt: String(r.createdAt || new Date().toISOString()),
    updatedAt: str(r.updatedAt),
  }
}

function normalizeSorting(r: OtcSortingRecord): OtcSortingRecord {
  return {
    id: String(r.id || crypto.randomUUID()),
    sortedAt: String(r.sortedAt || ''),
    shiftLabel: str(r.shiftLabel),
    batchNo: str(r.batchNo),
    productName: String(r.productName || ''),
    finishedProductId: str(r.finishedProductId),
    qtyCat1: num(r.qtyCat1) ?? 0,
    qtyCat2: num(r.qtyCat2) ?? 0,
    qtyCat3: num(r.qtyCat3) ?? 0,
    qtyScrap: num(r.qtyScrap) ?? 0,
    unit: r.unit === 'mp' ? 'mp' : 'rolls',
    visualOk: r.visualOk,
    handStretchOk: r.handStretchOk,
    sorterName: str(r.sorterName),
    note: str(r.note),
    createdAt: String(r.createdAt || new Date().toISOString()),
  }
}

function normalizeDefect(r: OtcDefectCase): OtcDefectCase {
  return {
    id: String(r.id || crypto.randomUUID()),
    foundAt: String(r.foundAt || ''),
    stage: r.stage === 'finished' || r.stage === 'other' ? r.stage : 'greige',
    batchNo: str(r.batchNo),
    productName: String(r.productName || ''),
    description: String(r.description || ''),
    photos: Array.isArray(r.photos)
      ? r.photos
          .filter((p) => p && typeof p.dataUrl === 'string')
          .map((p) => ({
            id: String(p.id || crypto.randomUUID()),
            dataUrl: p.dataUrl,
            caption: str(p.caption),
            createdAt: String(p.createdAt || new Date().toISOString()),
          }))
          .slice(0, 6)
      : [],
    status: r.status === 'in_progress' || r.status === 'closed' ? r.status : 'open',
    assigneeName: str(r.assigneeName),
    resolution: str(r.resolution),
    createdByName: str(r.createdByName),
    createdAt: String(r.createdAt || new Date().toISOString()),
    updatedAt: str(r.updatedAt),
  }
}

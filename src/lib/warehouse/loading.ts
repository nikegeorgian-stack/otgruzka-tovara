/**
 * Калькулятор погрузки готовой продукции в фуру / контейнер.
 * Учитывает лимит по весу и по палет-местам, вес нетто/брутто (тара поддонов
 * и коробок), площадь и количество рулонов. Логика повторяет бумажную форму
 * «Погрузка в фуру».
 */

export type LoadingContainerPreset = {
  id: string
  /** i18n-ключ названия */
  nameKey: string
  /** Максимально допустимый вес груза (брутто), кг */
  payloadKg: number
  /** Лимит палет-мест */
  palletPlaces: number
}

/**
 * Пресеты транспорта. Значения — типовые ориентиры (можно переопределить вручную).
 * Фура: ~21–22 т полезной нагрузки, 33 европалет-места.
 */
export const LOADING_CONTAINERS: LoadingContainerPreset[] = [
  { id: 'fura', nameKey: 'warehouse.loading.container.fura', payloadKg: 21000, palletPlaces: 33 },
  { id: 'c20', nameKey: 'warehouse.loading.container.c20', payloadKg: 21700, palletPlaces: 11 },
  { id: 'c40', nameKey: 'warehouse.loading.container.c40', payloadKg: 26500, palletPlaces: 25 },
  { id: 'c40hc', nameKey: 'warehouse.loading.container.c40hc', payloadKg: 26500, palletPlaces: 25 },
  { id: 'c45', nameKey: 'warehouse.loading.container.c45', payloadKg: 26500, palletPlaces: 33 },
  { id: 'custom', nameKey: 'warehouse.loading.container.custom', payloadKg: 0, palletPlaces: 0 },
]

export type LoadingLine = {
  id: string
  name: string
  /** Статус / комплектация (свободный текст) */
  note: string
  /** Длина рулона, п.м */
  rollLengthM: number
  /** Граммовка, г/м² */
  grammageGsm: number
  /** Ширина рулона, м (для расчёта веса) */
  rollWidthM: number
  /** Количество рулонов */
  rolls: number
  /** Вес одного рулона, кг */
  weightPerRollKg: number
  /** Площадь одного рулона, м² */
  areaPerRollM2: number
  /** Рулонов в коробке (из рецепта упаковки) */
  rollsPerBox: number
  /** Рулонов сверху на одну отгрузочную единицу */
  topRolls: number
  /** Рулонов на поддоне / отгрузочной единице */
  rollsPerPallet: number
  /** Слоёв поддонов в схеме (обычно 1) */
  palletLayers: number
  /** Слоёв коробок в схеме */
  boxLayers: number
  /** Вес пустого поддона (тара), кг */
  palletTareKg: number
  /** Коробок / пакетов */
  boxes: number
  /** Вес одной пустой коробки (тара), кг */
  boxTareKg: number
  /** Палет-мест занимает (по умолчанию = число поддонов) */
  palletPlaces: number
}

export type LoadingLineResult = {
  /** Отгрузочных единиц (ceil(рулоны / рулонов на единицу)) */
  palletUnits: number
  /** Физических поддонов (единицы × слои поддонов) */
  pallets: number
  /** Коробок по схеме */
  boxes: number
  /** Палет-мест (ручное значение или = поддонам) */
  palletPlaces: number
  /** Погонных метров всего */
  linearMeters: number
  /** Вес нетто (только продукция), кг */
  netKg: number
  /** Тара (поддоны + коробки), кг */
  tareKg: number
  /** Вес брутто, кг */
  grossKg: number
  /** Площадь, м² */
  areaM2: number
}

export function computeLoadingLine(line: LoadingLine): LoadingLineResult {
  const rolls = Math.max(0, line.rolls)
  const netKg = rolls * Math.max(0, line.weightPerRollKg)
  const rollsPerPallet = Math.max(0, line.rollsPerPallet)
  const palletUnits = rollsPerPallet > 0 ? Math.ceil(rolls / rollsPerPallet) : 0
  const palletLayers = line.palletLayers > 0 ? line.palletLayers : 1
  const boxLayers = line.boxLayers > 0 ? line.boxLayers : 0
  const physicalPallets = palletUnits * palletLayers
  const boxes =
    line.boxes > 0 ? line.boxes : boxLayers > 0 ? palletUnits * boxLayers : 0
  const palletPlaces = line.palletPlaces > 0 ? line.palletPlaces : physicalPallets
  const tareKg =
    physicalPallets * Math.max(0, line.palletTareKg) +
    boxes * Math.max(0, line.boxTareKg)
  return {
    palletUnits,
    pallets: physicalPallets,
    boxes,
    palletPlaces,
    linearMeters: rolls * Math.max(0, line.rollLengthM),
    netKg,
    tareKg,
    grossKg: netKg + tareKg,
    areaM2: rolls * Math.max(0, line.areaPerRollM2),
  }
}

export type LoadingTotals = {
  rolls: number
  linearMeters: number
  areaM2: number
  boxes: number
  pallets: number
  palletPlaces: number
  netKg: number
  grossKg: number
}

export function computeLoadingTotals(lines: LoadingLine[]): LoadingTotals {
  const totals: LoadingTotals = {
    rolls: 0,
    linearMeters: 0,
    areaM2: 0,
    boxes: 0,
    pallets: 0,
    palletPlaces: 0,
    netKg: 0,
    grossKg: 0,
  }
  for (const line of lines) {
    const r = computeLoadingLine(line)
    totals.rolls += Math.max(0, line.rolls)
    totals.linearMeters += r.linearMeters
    totals.areaM2 += r.areaM2
    totals.boxes += r.boxes
    totals.pallets += r.pallets
    totals.palletPlaces += r.palletPlaces
    totals.netKg += r.netKg
    totals.grossKg += r.grossKg
  }
  return totals
}

export type LoadingBalance = {
  /** Разница лимит − факт по весу (кг). >0 остаток, <0 перевес. */
  weightLeftKg: number
  /** Разница лимит − факт по палет-местам. >0 остаток, <0 перевес. */
  placesLeft: number
  /** Загрузка по весу, % */
  weightLoadPct: number
  /** Загрузка по палет-местам, % */
  placesLoadPct: number
  weightOver: boolean
  placesOver: boolean
}

export function computeLoadingBalance(
  totals: LoadingTotals,
  payloadKg: number,
  palletPlacesLimit: number,
): LoadingBalance {
  const weightLeftKg = payloadKg - totals.grossKg
  const placesLeft = palletPlacesLimit - totals.palletPlaces
  return {
    weightLeftKg,
    placesLeft,
    weightLoadPct: payloadKg > 0 ? (totals.grossKg / payloadKg) * 100 : 0,
    placesLoadPct: palletPlacesLimit > 0 ? (totals.palletPlaces / palletPlacesLimit) * 100 : 0,
    weightOver: weightLeftKg < 0,
    placesOver: placesLeft < 0,
  }
}

/* ——— Форматирование чисел (запятая-разделитель, как в бумажной форме) ——— */

function ruNum(n: number, frac: number): string {
  return n.toLocaleString('ru-RU', {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  })
}

/** «20 157,6» (кг с 1 знаком) */
export function formatKg(kg: number): string {
  return ruNum(kg, 1)
}

/** «21,045» (тонны с 3 знаками) */
export function formatTons(kg: number): string {
  return ruNum(kg / 1000, 3)
}

/** Целое с пробелами-разрядами: «105 150» */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

/** Парсинг ввода с запятой/точкой. */
export function parseNum(input: string): number {
  const n = Number(String(input).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export function emptyLoadingLine(): LoadingLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    note: '',
    rollLengthM: 0,
    grammageGsm: 0,
    rollWidthM: 0,
    rolls: 0,
    weightPerRollKg: 0,
    areaPerRollM2: 0,
    rollsPerBox: 0,
    topRolls: 0,
    rollsPerPallet: 0,
    palletLayers: 0,
    boxLayers: 0,
    palletTareKg: 0,
    boxes: 0,
    boxTareKg: 0,
    palletPlaces: 0,
  }
}

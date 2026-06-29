import type { FormulationCategory, FormulationRecipe, FormulationStore } from './types'

/** Стандартные пресеты граммовки — база для расчётов и подбора рецептов */
export const STANDARD_GRAMMAGE_PRESETS: {
  id: string
  gsm: number
  category: FormulationCategory
  labelRu: string
  labelKa: string
}[] = [
  { id: 'gsm-75', gsm: 75, category: '75', labelRu: '75 г/м²', labelKa: '75 გ/მ²' },
  { id: 'gsm-130', gsm: 130, category: '130', labelRu: '130 г/м²', labelKa: '130 გ/მ²' },
  { id: 'gsm-145', gsm: 145, category: '145', labelRu: '145 г/м²', labelKa: '145 გ/მ²' },
  { id: 'gsm-145ultra', gsm: 145, category: '145ultra', labelRu: '145 Ultra', labelKa: '145 Ultra' },
  { id: 'gsm-160', gsm: 160, category: '160', labelRu: '160 г/м²', labelKa: '160 გ/მ²' },
  { id: 'gsm-165ultra', gsm: 165, category: '165ultra', labelRu: '165 Ultra', labelKa: '165 Ultra' },
]

export type GrammageOption = {
  id: string
  gsm: number
  category: FormulationCategory
  label: string
  /** Из расширяемой базы (не стандартный пресет) */
  custom?: boolean
}

export function formulationCategoryForGsm(gsm: number): FormulationCategory {
  const preset = STANDARD_GRAMMAGE_PRESETS.find((p) => p.gsm === gsm)
  if (preset) return preset.category
  if (gsm <= 80) return '75'
  if (gsm <= 135) return '130'
  if (gsm <= 152) return '145'
  if (gsm <= 162) return '160'
  return 'other'
}

export function presetForRecipe(recipe: Pick<FormulationRecipe, 'grammageGsm' | 'category'>): string | null {
  if (!recipe.grammageGsm) return null
  const hit = STANDARD_GRAMMAGE_PRESETS.find(
    (p) => p.gsm === recipe.grammageGsm && p.category === recipe.category,
  )
  if (hit) return hit.id
  const byGsm = STANDARD_GRAMMAGE_PRESETS.find((p) => p.gsm === recipe.grammageGsm)
  return byGsm?.id ?? null
}

/** Собрать список граммовок: стандарт + база + рецепты */
export function buildGrammageOptions(
  store: FormulationStore,
  locale: 'ru' | 'ka',
): GrammageOption[] {
  const seen = new Set<string>()
  const out: GrammageOption[] = []

  function push(opt: GrammageOption) {
    const key = `${opt.gsm}:${opt.category}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(opt)
  }

  for (const p of STANDARD_GRAMMAGE_PRESETS) {
    push({
      id: p.id,
      gsm: p.gsm,
      category: p.category,
      label: locale === 'ka' ? p.labelKa : p.labelRu,
    })
  }

  for (const gsm of store.grammageRegistry ?? []) {
    if (gsm <= 0) continue
    const isStandard = STANDARD_GRAMMAGE_PRESETS.some((p) => p.gsm === gsm)
    if (isStandard) continue
    push({
      id: `reg-${gsm}`,
      gsm,
      category: formulationCategoryForGsm(gsm),
      label: `${gsm} г/м²`,
      custom: true,
    })
  }

  for (const r of store.recipes) {
    if (!r.grammageGsm || r.grammageGsm <= 0) continue
    const key = `${r.grammageGsm}:${r.category}`
    if (seen.has(key)) continue
    const preset = STANDARD_GRAMMAGE_PRESETS.find(
      (p) => p.gsm === r.grammageGsm && p.category === r.category,
    )
    if (preset) continue
    push({
      id: `recipe-${r.id}`,
      gsm: r.grammageGsm,
      category: r.category,
      label: `${r.grammageGsm} г/м²`,
      custom: true,
    })
  }

  return out.sort((a, b) => a.gsm - b.gsm || a.label.localeCompare(b.label, 'ru'))
}

export function normalizeGrammageRegistry(
  raw: number[] | undefined,
  recipes: FormulationRecipe[],
): number[] {
  const set = new Set<number>()
  for (const gsm of raw ?? []) {
    if (gsm > 0) set.add(Math.round(gsm))
  }
  for (const r of recipes) {
    if (r.grammageGsm && r.grammageGsm > 0) set.add(Math.round(r.grammageGsm))
  }
  for (const p of STANDARD_GRAMMAGE_PRESETS) {
    set.add(p.gsm)
  }
  return [...set].sort((a, b) => a - b)
}

export function withRegisteredGrammage(
  store: FormulationStore,
  gsm?: number,
): FormulationStore {
  if (!gsm || gsm <= 0) return store
  const rounded = Math.round(gsm)
  const registry = store.grammageRegistry ?? []
  if (registry.includes(rounded)) return store
  return {
    ...store,
    grammageRegistry: [...registry, rounded].sort((a, b) => a - b),
  }
}

export function applyGrammageSelection(
  recipe: FormulationRecipe,
  option: GrammageOption,
): FormulationRecipe {
  return {
    ...recipe,
    grammageGsm: option.gsm,
    category: option.category,
  }
}

export function applyCustomGrammage(
  recipe: FormulationRecipe,
  gsm: number,
): FormulationRecipe {
  const rounded = Math.round(gsm)
  return {
    ...recipe,
    grammageGsm: rounded > 0 ? rounded : undefined,
    category: rounded > 0 ? formulationCategoryForGsm(rounded) : recipe.category,
  }
}

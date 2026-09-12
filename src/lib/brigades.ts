import type { AppStore } from './types'

export { DEFAULT_BRIGADES, EMPTY_SLOTS_PER_BRIGADE } from './brigades.constants'

export function getBrigades(store: AppStore): string[] {
  const brigades = Array.isArray(store.brigades) ? store.brigades : []
  return brigades.length > 0 ? [...brigades] : []
}

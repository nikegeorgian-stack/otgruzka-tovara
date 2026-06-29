import {
  confirmBatchMix,
  createPendingBatchMix,
  rejectBatchMix,
  type PostBatchMixInput,
  type PostBatchMixOptions,
  type PostBatchMixResult,
} from '@/lib/formulations/batch'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createFormulationBatchSlice({ setStore }: StoreSliceDeps) {
  return {
    /** Замес куба → создаёт заявку на подтверждение кладовщиком (склад не трогается). */
    postFormulationBatchMix(
      input: PostBatchMixInput,
      locale: 'ru' | 'ka' = 'ru',
      options?: PostBatchMixOptions,
    ): PostBatchMixResult {
      let result: PostBatchMixResult = { ok: false, error: 'unknown' }
      patchStore(setStore, (s) => {
        const r = createPendingBatchMix(s.formulations, s.warehouse, input, locale, options)
        result = r.result
        if (!r.result.ok) return s
        return { ...s, formulations: r.formulations, warehouse: r.warehouse }
      })
      return result
    },

    /** Кладовщик подтверждает замес → проводит списание сырья + приход готовой пропитки. */
    confirmFormulationBatch(
      runId: string,
      keeper?: { id?: string; name?: string },
      options?: PostBatchMixOptions,
    ): PostBatchMixResult {
      let result: PostBatchMixResult = { ok: false, error: 'unknown' }
      patchStore(setStore, (s) => {
        const r = confirmBatchMix(
          s.formulations,
          s.warehouse,
          { runId, keeperId: keeper?.id, keeperName: keeper?.name },
          options,
        )
        result = r.result
        if (!r.result.ok) return s
        return { ...s, formulations: r.formulations, warehouse: r.warehouse }
      })
      return result
    },

    /** Кладовщик отклоняет заявку на замес (склад не затрагивается). */
    rejectFormulationBatch(
      runId: string,
      keeper?: { id?: string; name?: string },
      reason?: string,
    ): PostBatchMixResult {
      let result: PostBatchMixResult = { ok: false, error: 'unknown' }
      patchStore(setStore, (s) => {
        const r = rejectBatchMix(s.formulations, s.warehouse, {
          runId,
          keeperId: keeper?.id,
          keeperName: keeper?.name,
          reason,
        })
        result = r.result
        if (!r.result.ok) return s
        return { ...s, formulations: r.formulations, warehouse: r.warehouse }
      })
      return result
    },
  }
}

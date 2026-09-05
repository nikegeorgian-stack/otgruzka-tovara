import { createMixTaskRecord, type MixTaskInput } from '@/lib/formulations/mixTasks'
import {
  reserveMixTaskInStore,
  unreserveMixTaskInStore,
  type MixTaskReserveResult,
} from '@/lib/formulations/mixTaskReserve'
import type { FormulationMixTask } from '@/lib/formulations/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export type CreateMixTaskResult = {
  ok: boolean
  task?: FormulationMixTask
  reserve?: MixTaskReserveResult
}

export function createMixTasksSlice({ setStore }: StoreSliceDeps) {
  return {
    /** Технолог создаёт задание на замес (+ авто-резерв сырья) */
    createMixTask(input: MixTaskInput): CreateMixTaskResult {
      let result: CreateMixTaskResult = { ok: false }
      patchStore(setStore, (s) => {
        const task = createMixTaskRecord(s.formulations, input)
        if (!task) return s
        const recipe = s.formulations.recipes.find((r) => r.id === task.recipeId)
        let warehouse = s.warehouse
        let reserve: MixTaskReserveResult | undefined
        if (recipe) {
          const out = reserveMixTaskInStore(task, recipe, warehouse)
          warehouse = out.store
          reserve = out.result
        }
        result = { ok: true, task, reserve }
        return {
          ...s,
          warehouse,
          formulations: {
            ...s.formulations,
            mixTasks: [...(s.formulations.mixTasks ?? []), task],
          },
        }
      })
      return result
    },

    updateMixTask(task: FormulationMixTask) {
      patchStore(setStore, (s) => ({
        ...s,
        formulations: {
          ...s.formulations,
          mixTasks: (s.formulations.mixTasks ?? []).map((tRow) =>
            tRow.id === task.id ? { ...task, updatedAt: new Date().toISOString() } : tRow,
          ),
        },
      }))
    },

    cancelMixTask(id: string) {
      patchStore(setStore, (s) => {
        const task = (s.formulations.mixTasks ?? []).find((t) => t.id === id)
        let warehouse = s.warehouse
        if (task && task.status === 'open') {
          warehouse = unreserveMixTaskInStore(task, warehouse).store
        }
        return {
          ...s,
          warehouse,
          formulations: {
            ...s.formulations,
            mixTasks: (s.formulations.mixTasks ?? []).map((tRow) =>
              tRow.id === id
                ? { ...tRow, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
                : tRow,
            ),
          },
        }
      })
    },

    /** Привязать задание к проведённому замесу и закрыть */
    completeMixTask(id: string, batchRunId: string, doneByName?: string) {
      patchStore(setStore, (s) => {
        const task = (s.formulations.mixTasks ?? []).find((t) => t.id === id)
        let warehouse = s.warehouse
        if (task) {
          warehouse = unreserveMixTaskInStore(task, warehouse).store
        }
        return {
          ...s,
          warehouse,
          formulations: {
            ...s.formulations,
            mixTasks: (s.formulations.mixTasks ?? []).map((tRow) =>
              tRow.id === id
                ? {
                    ...tRow,
                    status: 'done' as const,
                    batchRunId,
                    doneByName,
                    doneAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : tRow,
            ),
          },
        }
      })
    },

    reserveMixTaskMaterials(taskId: string): MixTaskReserveResult {
      let result: MixTaskReserveResult = {
        ok: false,
        lines: [],
        messageKey: 'mixer.reserve.nothing',
      }
      patchStore(setStore, (s) => {
        const task = (s.formulations.mixTasks ?? []).find(
          (t) => t.id === taskId && t.status === 'open',
        )
        if (!task) return s
        const recipe = s.formulations.recipes.find((r) => r.id === task.recipeId)
        if (!recipe) {
          result = { ok: false, lines: [], messageKey: 'mixer.reserve.noRecipe' }
          return s
        }
        const out = reserveMixTaskInStore(task, recipe, s.warehouse)
        result = out.result
        return { ...s, warehouse: out.store }
      })
      return result
    },

    unreserveMixTaskMaterials(taskId: string): boolean {
      let ok = false
      patchStore(setStore, (s) => {
        const task = (s.formulations.mixTasks ?? []).find((t) => t.id === taskId)
        if (!task) return s
        const out = unreserveMixTaskInStore(task, s.warehouse)
        ok = out.ok
        return { ...s, warehouse: out.store }
      })
      return ok
    },
  }
}

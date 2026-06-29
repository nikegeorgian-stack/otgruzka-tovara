import { createMixTaskRecord, type MixTaskInput } from '@/lib/formulations/mixTasks'
import type { FormulationMixTask } from '@/lib/formulations/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createMixTasksSlice({ setStore }: StoreSliceDeps) {
  return {
    /** Технолог создаёт задание на замес */
    createMixTask(input: MixTaskInput): { ok: boolean; task?: FormulationMixTask } {
      let result: { ok: boolean; task?: FormulationMixTask } = { ok: false }
      patchStore(setStore, (s) => {
        const task = createMixTaskRecord(s.formulations, input)
        if (!task) return s
        result = { ok: true, task }
        return {
          ...s,
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
      patchStore(setStore, (s) => ({
        ...s,
        formulations: {
          ...s.formulations,
          mixTasks: (s.formulations.mixTasks ?? []).map((tRow) =>
            tRow.id === id
              ? { ...tRow, status: 'cancelled' as const, updatedAt: new Date().toISOString() }
              : tRow,
          ),
        },
      }))
    },

    /** Привязать задание к проведённому замесу и закрыть */
    completeMixTask(id: string, batchRunId: string, doneByName?: string) {
      patchStore(setStore, (s) => ({
        ...s,
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
      }))
    },
  }
}

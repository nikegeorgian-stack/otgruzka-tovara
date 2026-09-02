import { buildEngineerLogEntry, normalizeEngineerLogStore, type EngineerLogDraft } from '@/lib/engineerLog/init'
import type { EngineerLogEntry } from '@/lib/engineerLog/types'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createEngineerLogSlice({ setStore }: StoreSliceDeps) {
  return {
    upsertEngineerLogEntry(draft: EngineerLogDraft) {
      const row = buildEngineerLogEntry(draft)
      patchStore(setStore, (s) => {
        const log = normalizeEngineerLogStore(s.engineerLog)
        const idx = log.entries.findIndex((e) => e.id === row.id)
        const entries =
          idx >= 0
            ? log.entries.map((e, i) =>
                i === idx
                  ? {
                      ...row,
                      createdAt: e.createdAt,
                      updatedAt: new Date().toISOString(),
                    }
                  : e,
              )
            : [row, ...log.entries]
        return { ...s, engineerLog: { entries } }
      })
      return row.id
    },

    removeEngineerLogEntry(id: string) {
      patchStore(setStore, (s) => {
        const log = normalizeEngineerLogStore(s.engineerLog)
        return {
          ...s,
          engineerLog: { entries: log.entries.filter((e) => e.id !== id) },
        }
      })
    },

    toggleEngineerLogPin(id: string) {
      patchStore(setStore, (s) => {
        const log = normalizeEngineerLogStore(s.engineerLog)
        return {
          ...s,
          engineerLog: {
            entries: log.entries.map((e) =>
              e.id === id
                ? { ...e, pinned: !e.pinned, updatedAt: new Date().toISOString() }
                : e,
            ),
          },
        }
      })
    },

    toggleEngineerLogChecklistItem(entryId: string, itemId: string) {
      patchStore(setStore, (s) => {
        const log = normalizeEngineerLogStore(s.engineerLog)
        return {
          ...s,
          engineerLog: {
            entries: log.entries.map((e) => {
              if (e.id !== entryId || !e.checklist) return e
              return {
                ...e,
                updatedAt: new Date().toISOString(),
                checklist: e.checklist.map((c) =>
                  c.id === itemId ? { ...c, done: !c.done } : c,
                ),
              }
            }),
          },
        }
      })
    },

    setEngineerLogEntryStatus(id: string, status: EngineerLogEntry['status']) {
      patchStore(setStore, (s) => {
        const log = normalizeEngineerLogStore(s.engineerLog)
        return {
          ...s,
          engineerLog: {
            entries: log.entries.map((e) =>
              e.id === id
                ? { ...e, status, updatedAt: new Date().toISOString() }
                : e,
            ),
          },
        }
      })
    },
  }
}

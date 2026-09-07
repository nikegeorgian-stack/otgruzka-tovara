import type { Locale } from '@/i18n/types'
import {
  attachBatchMixConfirmedDocs,
  buildBatchMixConfirmCommand,
  classifyBatchMixWarehouseState,
  confirmBatchMix,
  createPendingBatchMix,
  rejectBatchMix,
  type PostBatchMixInput,
  type PostBatchMixOptions,
  type PostBatchMixResult,
} from '@/lib/formulations/batch'
import { warehouseTransactionGroupId } from '@/lib/cloud/transactionGroups'
import {
  g2WarehouseCommand,
  isG2WebAuthoritativePath,
  mirrorG2WarehouseAck,
} from '@/lib/warehouse/g2ServerClient'
import { patchStore, type StoreSliceDeps } from '../storeApi'

export function createFormulationBatchSlice({ setStore, getStore }: StoreSliceDeps) {
  return {
    /** Замес куба → создаёт заявку на подтверждение кладовщиком (склад не трогается). */
    postFormulationBatchMix(
      input: PostBatchMixInput,
      locale: Locale = 'ru',
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

    /**
     * Кладовщик подтверждает замес.
     * Web G2: critical CAS issue+receipt first; formulations.confirmed only after ack.
     * Desktop/local: existing atomic local post.
     */
    async confirmFormulationBatch(
      runId: string,
      keeper?: { id?: string; name?: string },
      options?: PostBatchMixOptions,
    ): Promise<PostBatchMixResult> {
      void options
      if (!isG2WebAuthoritativePath()) {
        let result: PostBatchMixResult = { ok: false, error: 'unknown' }
        patchStore(
          setStore,
          (s) => {
            const r = confirmBatchMix(
              s.formulations,
              s.warehouse,
              { runId, keeperId: keeper?.id, keeperName: keeper?.name },
              options,
            )
            result = r.result
            if (!r.result.ok) return s
            return { ...s, formulations: r.formulations, warehouse: r.warehouse }
          },
          {
            origin: 'user',
            atomic: true,
            transactionGroupId: warehouseTransactionGroupId({
              kind: 'batch_mix',
              sourceId: runId,
              revision: 'confirm',
            }),
            transactionGroupKind: 'batch_mix',
            transactionGroupLabel: 'Подтверждение замеса',
          },
        )
        return result
      }

      const store = getStore()
      const run = (store.formulations.batchRuns ?? []).find((r) => r.id === runId)
      if (!run) return { ok: false, error: 'batch_not_found' }
      if ((run.status ?? 'confirmed') !== 'pending') {
        return { ok: false, error: 'batch_not_pending' }
      }

      const groupId = warehouseTransactionGroupId({
        kind: 'batch_mix',
        sourceId: runId,
        revision: 'confirm',
      })
      const command = buildBatchMixConfirmCommand(
        run,
        store.formulations.recipes.find((r) => r.id === run.recipeId),
      )
      const server = await g2WarehouseCommand({
        idempotencyKey: groupId,
        commandType: 'warehouse.batchMix.confirm',
        command,
      })
      if (!server.ok) {
        return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      }

      const issueDocumentId = String(
        (server.data as { issueDocumentId?: string }).issueDocumentId ?? '',
      )
      const receiptDocumentId = String(
        (server.data as { receiptDocumentId?: string }).receiptDocumentId ?? '',
      )
      if (!issueDocumentId || !receiptDocumentId) {
        return { ok: false, error: 'warehouse.g2.errServer' }
      }

      let result: PostBatchMixResult = { ok: false, error: 'unknown' }
      patchStore(
        setStore,
        (s) => {
          const attached = attachBatchMixConfirmedDocs(s.formulations, {
            runId,
            keeperId: keeper?.id,
            keeperName: keeper?.name,
            issueDocumentId,
            receiptDocumentId,
          })
          result = attached.result
          if (!attached.result.ok) return s
          return {
            ...s,
            formulations: attached.formulations,
            warehouse: mirrorG2WarehouseAck(
              s.warehouse,
              (server.data as { warehouse?: typeof s.warehouse }).warehouse,
            ),
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'batch_mix',
          transactionGroupLabel: 'Подтверждение замеса (G2)',
        },
      )
      return result
    },

    /**
     * Orphan recovery: confirmed formulations without critical issue/receipt.
     * Fail-closed on partial ledger; idempotent when complete.
     */
    async recoverOrphanBatchMixConfirm(
      runId: string,
      keeper?: { id?: string; name?: string },
    ): Promise<PostBatchMixResult> {
      if (!isG2WebAuthoritativePath()) {
        return { ok: false, error: 'g2_required' }
      }
      const store = getStore()
      const run = (store.formulations.batchRuns ?? []).find((r) => r.id === runId)
      if (!run) return { ok: false, error: 'batch_not_found' }
      if ((run.status ?? '') !== 'confirmed') {
        return { ok: false, error: 'batch_not_confirmed_orphan' }
      }

      const ledger = classifyBatchMixWarehouseState(store.warehouse, runId)
      if (ledger.state === 'complete') {
        const attached = attachBatchMixConfirmedDocs(store.formulations, {
          runId,
          keeperId: keeper?.id,
          keeperName: keeper?.name,
          issueDocumentId: ledger.issueDocumentId!,
          receiptDocumentId: ledger.receiptDocumentId!,
          allowAlreadyConfirmed: true,
        })
        if (attached.result.ok) {
          patchStore(setStore, (s) => ({ ...s, formulations: attached.formulations }))
        }
        return attached.result
      }
      if (ledger.state === 'partial') {
        return {
          ok: false,
          error: `partial_batch_mix_docs:issue=${ledger.issueDocumentId ?? 'none'};receipt=${ledger.receiptDocumentId ?? 'none'};issueMov=${ledger.issueMovementCount};receiptMov=${ledger.receiptMovementCount}`,
        }
      }

      const groupId = warehouseTransactionGroupId({
        kind: 'batch_mix',
        sourceId: runId,
        revision: 'confirm',
      })
      const command = buildBatchMixConfirmCommand(
        run,
        store.formulations.recipes.find((r) => r.id === run.recipeId),
      )
      const server = await g2WarehouseCommand({
        idempotencyKey: groupId,
        commandType: 'warehouse.batchMix.confirm',
        command,
      })
      if (!server.ok) {
        return { ok: false, error: server.error || 'warehouse.g2.errServer' }
      }
      const issueDocumentId = String(
        (server.data as { issueDocumentId?: string }).issueDocumentId ?? '',
      )
      const receiptDocumentId = String(
        (server.data as { receiptDocumentId?: string }).receiptDocumentId ?? '',
      )
      if (!issueDocumentId || !receiptDocumentId) {
        return { ok: false, error: 'warehouse.g2.errServer' }
      }

      let result: PostBatchMixResult = { ok: false, error: 'unknown' }
      patchStore(
        setStore,
        (s) => {
          const attached = attachBatchMixConfirmedDocs(s.formulations, {
            runId,
            keeperId: keeper?.id,
            keeperName: keeper?.name,
            issueDocumentId,
            receiptDocumentId,
            allowAlreadyConfirmed: true,
          })
          result = attached.result
          if (!attached.result.ok) return s
          return {
            ...s,
            formulations: attached.formulations,
            warehouse: mirrorG2WarehouseAck(
              s.warehouse,
              (server.data as { warehouse?: typeof s.warehouse }).warehouse,
            ),
          }
        },
        {
          origin: 'user',
          atomic: true,
          transactionGroupId: groupId,
          transactionGroupKind: 'batch_mix',
          transactionGroupLabel: 'Восстановление замеса (G2 orphan)',
        },
      )
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

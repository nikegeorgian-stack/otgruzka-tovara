import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormNotice } from '@/components/ui/FormNotice'
import { OtcAlkaliPanel } from '@/components/otc/OtcAlkaliPanel'
import { OtcDashboardPanel } from '@/components/otc/OtcDashboardPanel'
import { OtcDefectsPanel } from '@/components/otc/OtcDefectsPanel'
import { OtcLabTestsPanel } from '@/components/otc/OtcLabTestsPanel'
import { OtcNormsPanel } from '@/components/otc/OtcNormsPanel'
import { OtcSortingPanel } from '@/components/otc/OtcSortingPanel'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { canReleaseFinishedGoodsQc } from '@/lib/access/permissions'
import type { AccessStore } from '@/lib/access/types'
import type { FinishedProduct } from '@/lib/finishedProducts/types'
import { lotQcBadgeKey, listPendingQcLots, type FinishedGoodsLot } from '@/lib/production/finishedGoodsLots'
import type {
  OtcDefectCase,
  OtcLabTest,
  OtcNorm,
  OtcSortingRecord,
  OtcStore,
} from '@/lib/otc/types'
import type { AppUser } from '@/lib/access/types'
import type { ProductionStore } from '@/lib/production/types'
import type { WarehouseStore } from '@/lib/warehouse/types'
import type { QcDocumentKind, QcLotAttachment } from '@/lib/production/qcAttachments'
import { releaseFinishedGoodsLot as previewReleaseFinishedGoodsLot } from '@/lib/production/qcRelease'
import { qcReleaseLot } from '@/lib/production/qcServerClient'
import { FST_SHARED_STORE_DOC_ID } from '@/lib/cloud/firestoreSchema'

type Tab = 'dash' | 'lab' | 'alkali' | 'sorting' | 'defects' | 'norms' | 'qc'

type Props = {
  store: OtcStore
  operatorName?: string
  onUpsertNorm: (entry: OtcNorm) => void
  onRemoveNorm: (id: string) => void
  onUpsertLabTest: (entry: Omit<OtcLabTest, 'computed' | 'id' | 'createdAt'>) => void
  onRemoveLabTest: (id: string) => void
  onUpsertAlkali: Parameters<typeof OtcAlkaliPanel>[0]['onSave']
  onRemoveAlkali: (id: string) => void
  onUpsertSorting: (entry: Omit<OtcSortingRecord, 'id' | 'createdAt'>) => void
  onRemoveSorting: (id: string) => void
  onUpsertDefect: (entry: Omit<OtcDefectCase, 'id' | 'createdAt'> & { id?: string }) => void
  onRemoveDefect: (id: string) => void
  productionStore: ProductionStore
  warehouse: WarehouseStore
  access: AccessStore
  finishedProducts: FinishedProduct[]
  currentUser?: AppUser | null
  onStartQcReview: (lotId: string) => void | Promise<void>
  onReleaseFinishedGoodsLot: (input: {
    lotId: string
    access?: AccessStore | null
    actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
    attachments?: { passportAttachmentId?: string; protocolAttachmentId?: string }
  }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  onMirrorServerQcRelease: (input: {
    lotId: string
    decisionId: string
    decisionRevision?: number
    decidedByUid?: string
    decidedAt?: string
  }) => { ok: boolean }
  onRequestRegrade: (input: {
    lotId: string
    targetFinishedProductId: string
    targetWarehouseItemId: string
    reason: string
    quantity?: number
    access?: AccessStore | null
    actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
    idempotencyKey: string
  }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  onRejectFinishedGoodsLot: (input: {
    lotId: string
    reason: string
    access?: AccessStore | null
    actor?: { id?: string; name?: string; roleId?: AppUser['roleId'] }
  }) => { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  onUpsertQcAttachment: (input: {
    lotId: string
    documentKind: QcDocumentKind
    originalFilename: string
    mimeType: string
    sizeBytes: number
    bytes?: ArrayBuffer | Uint8Array
    uploadedBy?: string
  }) => Promise<QcLotAttachment>
  focusTab?: Tab | null
  onFocusTabConsumed?: () => void
}

export function OtcPage({
  store,
  operatorName,
  onUpsertNorm,
  onRemoveNorm,
  onUpsertLabTest,
  onRemoveLabTest,
  onUpsertAlkali,
  onRemoveAlkali,
  onUpsertSorting,
  onRemoveSorting,
  onUpsertDefect,
  onRemoveDefect,
  productionStore,
  warehouse,
  access,
  finishedProducts,
  currentUser,
  onStartQcReview,
  onReleaseFinishedGoodsLot,
  onMirrorServerQcRelease,
  onRequestRegrade,
  onRejectFinishedGoodsLot,
  onUpsertQcAttachment,
  focusTab,
  onFocusTabConsumed,
}: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('dash')
  const [notice, setNotice] = useState<string | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingAttachRef = useRef<{ lot: FinishedGoodsLot; kind: QcDocumentKind } | null>(null)
  const [regradeDrafts, setRegradeDrafts] = useState<
    Record<string, { targetFinishedProductId: string; quantity: string }>
  >({})

  useEffect(() => {
    if (!focusTab) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-shot focus load
    setTab(focusTab)
    onFocusTabConsumed?.()
  }, [focusTab, onFocusTabConsumed])

  const tabs = [
    { id: 'dash' as const, label: t('otc.tab.dash') },
    { id: 'lab' as const, label: t('otc.tab.lab') },
    { id: 'alkali' as const, label: t('otc.tab.alkali') },
    { id: 'sorting' as const, label: t('otc.tab.sorting') },
    { id: 'defects' as const, label: t('otc.tab.defects') },
    { id: 'norms' as const, label: t('otc.tab.norms') },
    { id: 'qc' as const, label: t('otc.tab.qc') },
  ]

  const pendingLots = listPendingQcLots(productionStore.finishedGoodsLots)
  const canRelease = canReleaseFinishedGoodsQc(currentUser ?? null, access)
  const actor = {
    id: currentUser?.id,
    name: currentUser?.displayName ?? operatorName,
    roleId: currentUser?.roleId ?? 'otc',
  } as const

  function regradeDraftFor(lot: FinishedGoodsLot) {
    return (
      regradeDrafts[lot.id] ?? {
        targetFinishedProductId: lot.finishedProductId,
        quantity: String(Math.max(0, lot.quantityProduced - lot.quantityShipped)),
      }
    )
  }

  function updateRegradeDraft(
    lot: FinishedGoodsLot,
    patch: Partial<{ targetFinishedProductId: string; quantity: string }>,
  ) {
    setRegradeDrafts((curr) => ({
      ...curr,
      [lot.id]: {
        ...regradeDraftFor(lot),
        ...curr[lot.id],
        ...patch,
      },
    }))
  }

  function attachmentStatus(lotId: string, kind: QcDocumentKind) {
    const attachment = (productionStore.qcAttachments ?? []).find(
      (row) => row.lotId === lotId && row.documentKind === kind,
    )
    if (!attachment) return { key: 'otc.qc.attachMissing', attachment: undefined }
    if (attachment.uploadStatus === 'stored') {
      return { key: 'otc.qc.attachStored', attachment }
    }
    return { key: 'otc.qc.attachPending', attachment }
  }

  function storeAttachment(lot: FinishedGoodsLot, kind: QcDocumentKind) {
    pendingAttachRef.current = { lot, kind }
    const input = fileInputRef.current
    if (!input) {
      setNotice(t('otc.qc.error'))
      return
    }
    input.value = ''
    input.click()
  }

  async function onAttachmentFileChosen(fileList: FileList | null) {
    const pending = pendingAttachRef.current
    pendingAttachRef.current = null
    const file = fileList?.[0]
    if (!pending || !file) return
    if (file.type && file.type !== 'application/pdf') {
      setNotice(t('production.qc.errAttachmentType'))
      return
    }
    setAttachBusy(true)
    try {
      const bytes = await file.arrayBuffer()
      const attachment = await onUpsertQcAttachment({
        lotId: pending.lot.id,
        documentKind: pending.kind,
        originalFilename: file.name || `${pending.lot.batchNo}-${pending.kind}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        bytes,
        uploadedBy: actor.name,
      })
      if (attachment.uploadStatus !== 'stored') {
        setNotice(t(attachment.uploadStatus === 'failed' ? 'otc.qc.error' : 'otc.qc.attachPending'))
        return
      }
      setNotice(`${pending.lot.batchNo}: ${attachment.displayName}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'otc.qc.error'
      setNotice(t(message) !== message ? t(message) : t('otc.qc.error'))
    } finally {
      setAttachBusy(false)
    }
  }

  async function handleRelease(lot: FinishedGoodsLot) {
    const preview = previewReleaseFinishedGoodsLot(productionStore, {
      lotId: lot.id,
      access,
      actor,
      attachments: {
        passportAttachmentId: lot.passportAttachmentId,
        protocolAttachmentId: lot.protocolAttachmentId,
      },
    }).result
    if (!preview.ok) {
      setNotice(t(preview.error ?? 'otc.qc.error'))
      return
    }

    const { isG4WebAuthoritativePath, isG4PackagingQcActive } = await import(
      '@/lib/production/g4ServerClient'
    )
    if (
      isG4WebAuthoritativePath() &&
      isG4PackagingQcActive(productionStore as unknown as Record<string, unknown>)
    ) {
      const result = await onReleaseFinishedGoodsLot({
        lotId: lot.id,
        access,
        actor,
        attachments: {
          passportAttachmentId: lot.passportAttachmentId,
          protocolAttachmentId: lot.protocolAttachmentId,
        },
      })
      setNotice(result.ok ? t('otc.qc.released') : t(result.error ?? 'otc.qc.error'))
      return
    }

    if (import.meta.env.VITE_FST_WEB === 'true') {
      void qcReleaseLot({
        storeId: FST_SHARED_STORE_DOC_ID,
        lotId: lot.id,
        idempotencyKey: `qc-release::${lot.id}`,
      }).then((result) => {
        if (!result.ok) {
          setNotice(result.message)
          return
        }
        const decision = (result.data as { decision?: { id?: string; revision?: number; decidedByUid?: string; decidedAt?: string } })
          ?.decision
        if (!decision?.id) {
          setNotice('QC-сервер не вернул decision id')
          return
        }
        onMirrorServerQcRelease({
          lotId: lot.id,
          decisionId: decision.id,
          decisionRevision: decision.revision,
          decidedByUid: decision.decidedByUid,
          decidedAt: decision.decidedAt,
        })
        setNotice(t('otc.qc.released'))
      })
      return
    }

    const result = await onReleaseFinishedGoodsLot({
      lotId: lot.id,
      access,
      actor,
      attachments: {
        passportAttachmentId: lot.passportAttachmentId,
        protocolAttachmentId: lot.protocolAttachmentId,
      },
    })
    setNotice(result.ok ? t('otc.qc.released') : t(result.error ?? 'otc.qc.error'))
  }

  async function handleReview(lot: FinishedGoodsLot) {
    await onStartQcReview(lot.id)
    setNotice(`${lot.batchNo}: ${t(lotQcBadgeKey('in_review'))}`)
  }

  async function handleRegrade(lot: FinishedGoodsLot) {
    const draft = regradeDraftFor(lot)
    const targetProduct = finishedProducts.find((p) => p.id === draft.targetFinishedProductId)
    const targetWarehouseItemId = targetProduct?.warehouseItemId
    if (!targetProduct || !targetWarehouseItemId) {
      setNotice(t('otc.qc.error'))
      return
    }
    const quantity = Number(draft.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setNotice(t('otc.qc.error'))
      return
    }
    const result = await onRequestRegrade({
      lotId: lot.id,
      access,
      targetFinishedProductId: targetProduct.id,
      targetWarehouseItemId,
      reason: t('otc.qc.regradeReason'),
      quantity,
      actor,
      idempotencyKey: `qc-regrade::${lot.id}`,
    })
    setNotice(result.ok ? t('otc.qc.regraded') : t(result.error ?? 'otc.qc.error'))
  }

  async function handleReject(lot: FinishedGoodsLot) {
    const result = await onRejectFinishedGoodsLot({
      lotId: lot.id,
      access,
      reason: t('otc.qc.rejectReason'),
      actor,
    })
    setNotice(result.ok ? t('otc.qc.rejected') : t(result.error ?? 'otc.qc.error'))
  }

  return (
    <PageLayout>
      <PageHeader title={t('otc.title')} subtitle={t('otc.subtitle')} />
      <TabBar coachPrefix="otc" tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
      {notice && <FormNotice type="info" message={notice} onDismiss={() => setNotice(null)} />}
      {tab === 'dash' && <OtcDashboardPanel store={store} />}
      {tab === 'lab' && (
        <OtcLabTestsPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertLabTest}
          onRemove={onRemoveLabTest}
        />
      )}
      {tab === 'alkali' && (
        <OtcAlkaliPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertAlkali}
          onRemove={onRemoveAlkali}
        />
      )}
      {tab === 'sorting' && (
        <OtcSortingPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertSorting}
          onRemove={onRemoveSorting}
        />
      )}
      {tab === 'defects' && (
        <OtcDefectsPanel
          store={store}
          operatorName={operatorName}
          onSave={onUpsertDefect}
          onRemove={onRemoveDefect}
        />
      )}
      {tab === 'norms' && (
        <OtcNormsPanel store={store} onSave={onUpsertNorm} onRemove={onRemoveNorm} />
      )}
      {tab === 'qc' && (
        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => void onAttachmentFileChosen(e.target.files)}
          />
          <section className="rounded-sm border border-grid bg-white p-4 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink">
              {t('otc.qc.title')}
            </h3>
            <p className="mt-1 text-xs text-stone-500">{t('otc.qc.subtitle')}</p>
          </section>
          {pendingLots.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {pendingLots.map((lot) => {
                const product = warehouse.items.find((item) => item.id === lot.warehouseItemId)
                const passport = attachmentStatus(lot.id, 'passport')
                const protocol = attachmentStatus(lot.id, 'protocol')
                const draft = regradeDraftFor(lot)
                const targetProduct = finishedProducts.find((p) => p.id === draft.targetFinishedProductId)
                const canAct = canRelease
                return (
                  <section key={lot.id} className="rounded-sm border border-grid bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-ink">{lot.batchNo}</h4>
                        <p className="text-xs text-stone-500">
                          {product?.name ?? lot.finishedProductId} · {lot.quantityProduced} m²
                        </p>
                      </div>
                      <span className="rounded-full border border-grid bg-stone-50 px-2 py-1 text-[11px] text-stone-600">
                        {t(lotQcBadgeKey(lot.qcStatus))}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>{t('otc.qc.passport')}</span>
                        <span>{t(passport.key)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>{t('otc.qc.protocol')}</span>
                        <span>{t(protocol.key)}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={attachBusy}
                        onClick={() => storeAttachment(lot, 'passport')}
                      >
                        {t('otc.qc.storePassport')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={attachBusy}
                        onClick={() => storeAttachment(lot, 'protocol')}
                      >
                        {t('otc.qc.storeProtocol')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleReview(lot)}>
                        {t('otc.qc.review')}
                      </Button>
                      <Button size="sm" onClick={() => handleRelease(lot)} disabled={!canAct}>
                        {t('otc.qc.release')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleRegrade(lot)} disabled={!canAct}>
                        {t('otc.qc.regrade')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => handleReject(lot)} disabled={!canAct}>
                        {t('otc.qc.reject')}
                      </Button>
                    </div>
                    <div className="mt-4 grid gap-3 rounded-sm border border-dashed border-grid bg-stone-50/60 p-3 text-xs">
                      <label className="block">
                        {t('otc.qc.regradeProduct')}
                        <select
                          className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                          value={draft.targetFinishedProductId}
                          onChange={(e) =>
                            updateRegradeDraft(lot, { targetFinishedProductId: e.target.value })
                          }
                          disabled={!canAct}
                        >
                          {finishedProducts.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} · {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        {t('otc.qc.regradeQty')}
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                          value={draft.quantity}
                          onChange={(e) => updateRegradeDraft(lot, { quantity: e.target.value })}
                          disabled={!canAct}
                        />
                      </label>
                      {targetProduct?.warehouseItemId ? (
                        <p className="text-[11px] text-stone-500">
                          {t('otc.qc.targetItem')}: {targetProduct.warehouseItemId}
                        </p>
                      ) : (
                        <p className="text-[11px] text-red-700">{t('otc.qc.error')}</p>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <section className="rounded-sm border border-grid bg-white p-4 text-sm text-stone-500 shadow-sm">
              {t('otc.qc.empty')}
            </section>
          )}
        </div>
      )}
    </PageLayout>
  )
}

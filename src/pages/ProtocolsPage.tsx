import { useMemo, useRef, useState } from 'react'
import { ProtocolAckPrintModal } from '@/components/protocols/ProtocolAckPrintModal'
import type { ProtocolAckBlankData } from '@/components/protocols/ProtocolAckBlankSheet'
import { ProtocolEditorDialog } from '@/components/protocols/ProtocolEditorDialog'
import { ProtocolItemEditorDialog } from '@/components/protocols/ProtocolItemEditorDialog'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageLayout } from '@/components/ui/PageLayout'
import { TabBar } from '@/components/ui/TabBar'
import { useI18n } from '@/context/I18nContext'
import { employeeName } from '@/i18n'
import type { AppUser } from '@/lib/access/types'
import { resolveDocHeaderOrg } from '@/lib/print/docHeaderOptions'
import { uploadProtocolAttachmentFile } from '@/lib/protocols/attachmentStorage'
import {
  filterProtocolItems,
  filterProtocols,
  type ProtocolListFilters,
} from '@/lib/protocols/filters'
import { createDefaultProtocolsStore } from '@/lib/protocols/init'
import type {
  MeetingProtocol,
  ProtocolAssignmentStatus,
  ProtocolAttachment,
  ProtocolItem,
} from '@/lib/protocols/types'
import type { ProtocolDraft, ProtocolItemDraft } from '@/store/slices/protocolsSlice'
import type { AppStore } from '@/lib/types'

type TabId = 'list' | 'mine' | 'control' | 'ack' | 'journal'

type Props = {
  store: AppStore
  currentUser: AppUser | null
  canEdit: boolean
  onUpsertProtocol: (draft: ProtocolDraft) => string
  onArchiveProtocol: (id: string) => boolean
  onUpsertItem: (draft: ProtocolItemDraft) => string
  onArchiveItem: (id: string) => boolean
  onSetItemStatus: (id: string, status: ProtocolAssignmentStatus) => boolean
  onSendForAck: (itemId: string, toEmployeeId: string, note?: string) => boolean
  onConfirmAck: (
    itemId: string,
    opts?: {
      comment?: string
      method?: 'in_app' | 'paper_scan'
      signedAttachmentId?: string
    },
  ) => boolean
  onRefuseAck: (itemId: string, comment?: string) => boolean
  onAdminFixAck: (
    itemId: string,
    fix: {
      reason: string
      ackStatus?: ProtocolItem['ackStatus']
      unlock?: boolean
      clearAck?: boolean
    },
  ) => boolean
  onRegisterAttachment: (attachment: ProtocolAttachment) => boolean
}

const STATUS_OPTS: ProtocolAssignmentStatus[] = [
  'new',
  'sent_for_ack',
  'acknowledged',
  'in_progress',
  'done',
  'overdue',
  'cancelled',
]

export function ProtocolsPage({
  store,
  currentUser,
  canEdit,
  onUpsertProtocol,
  onArchiveProtocol,
  onUpsertItem,
  onArchiveItem,
  onSetItemStatus,
  onSendForAck,
  onConfirmAck,
  onRefuseAck,
  onAdminFixAck,
  onRegisterAttachment,
}: Props) {
  const { t, locale } = useI18n()
  const [tab, setTab] = useState<TabId>('list')
  const protocolsStore = store.protocols ?? createDefaultProtocolsStore()
  const myEmployeeId = currentUser?.employeeId
  const isSysadmin = currentUser?.roleId === 'sysadmin'
  const scanInputRef = useRef<HTMLInputElement>(null)

  const [filters, setFilters] = useState<ProtocolListFilters>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingProtocol, setEditingProtocol] = useState<MeetingProtocol | null>(null)
  const [itemEditorOpen, setItemEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ProtocolItem | null>(null)
  const [printBlank, setPrintBlank] = useState<ProtocolAckBlankData | null>(null)
  const [ackBusyId, setAckBusyId] = useState<string | null>(null)
  const [scanTargetId, setScanTargetId] = useState<string | null>(null)

  const tabs = useMemo(
    () =>
      (
        [
          ['list', 'protocols.tab.list'],
          ['mine', 'protocols.tab.mine'],
          ['control', 'protocols.tab.control'],
          ['ack', 'protocols.tab.ack'],
          ['journal', 'protocols.tab.journal'],
        ] as const
      ).map(([id, key]) => ({ id, label: t(key) })),
    [t],
  )

  const list = useMemo(() => {
    let protocols = filterProtocols(protocolsStore, filters)
    if (filters.status || filters.overdueOnly || filters.assigneeEmployeeId || filters.structuralUnitId) {
      const itemHits = new Set(
        filterProtocolItems(protocolsStore, store.employees, filters).map((r) => r.protocol.id),
      )
      protocols = protocols.filter((p) => itemHits.has(p.id))
    }
    return protocols
  }, [filters, protocolsStore, store.employees])

  const selected = list.find((p) => p.id === selectedId) ??
    protocolsStore.protocols.find((p) => p.id === selectedId && !p.archived) ??
    null

  const selectedItems = useMemo(() => {
    if (!selected) return []
    return protocolsStore.items
      .filter((it) => it.protocolId === selected.id && !it.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [protocolsStore.items, selected])

  const assignmentRows = useMemo(() => {
    const base: ProtocolListFilters = { ...filters }
    if (tab === 'mine' && myEmployeeId) {
      base.assigneeEmployeeId = myEmployeeId
    }
    let rows = filterProtocolItems(protocolsStore, store.employees, base)
    if (tab === 'control' && myEmployeeId) {
      rows = rows.filter((r) => r.item.controllerEmployeeId === myEmployeeId)
    }
    if (tab === 'ack') {
      rows = rows.filter((r) => {
        const it = r.item
        if (it.ackStatus === 'pending' || it.status === 'sent_for_ack') return true
        if (it.ackStatus === 'acknowledged' || it.ackStatus === 'refused') return true
        if (canEdit && it.ackStatus === 'not_sent') return true
        if (myEmployeeId && it.assigneeEmployeeIds.includes(myEmployeeId)) return true
        return false
      })
      if (myEmployeeId && !canEdit && !isSysadmin) {
        rows = rows.filter(
          (r) =>
            r.item.assigneeEmployeeIds.includes(myEmployeeId) ||
            r.item.ackSentToEmployeeId === myEmployeeId,
        )
      }
    }
    return rows
  }, [canEdit, filters, isSysadmin, myEmployeeId, protocolsStore, store.employees, tab])

  const openCreate = () => {
    setEditingProtocol(null)
    setEditorOpen(true)
  }

  const openEdit = (p: MeetingProtocol) => {
    setEditingProtocol(p)
    setEditorOpen(true)
  }

  const empLabel = (id?: string) => {
    if (!id) return '—'
    const e = store.employees.find((x) => x.id === id)
    return e ? employeeName(e, locale) : id.slice(0, 8)
  }

  const units = store.hrStructuralUnits.filter((u) => !u.archived)
  const orgName = resolveDocHeaderOrg(store, locale).organization

  const auditRows = useMemo(() => {
    return (store.auditLog ?? [])
      .filter((e) => String(e.action).startsWith('protocol_'))
      .slice(0, 80)
  }, [store.auditLog])

  function buildBlank(protocol: MeetingProtocol, item: ProtocolItem): ProtocolAckBlankData {
    const assigneeId = item.ackSentToEmployeeId || item.assigneeEmployeeIds[0]
    return {
      organization: orgName,
      protocolNumber: protocol.number,
      meetingAtLabel: protocol.meetingAt.slice(0, 16).replace('T', ' '),
      topic: protocol.topic,
      itemSortOrder: item.sortOrder,
      decision: item.decision,
      assignmentText: item.assignmentText,
      assigneeName: empLabel(assigneeId),
      dueDateLabel: item.dueDate ?? '',
      controllerName: empLabel(item.controllerEmployeeId),
      secretaryNote: item.secretaryAckNote,
      printedAt: new Date().toLocaleString(
        locale === 'ka' ? 'ka-GE' : locale === 'en' ? 'en-GB' : 'ru-RU',
      ),
    }
  }

  function canConfirmItem(item: ProtocolItem): boolean {
    if (item.ackLocked && item.ackStatus === 'acknowledged') return false
    if (canEdit || isSysadmin) return true
    if (!myEmployeeId) return false
    return (
      item.assigneeEmployeeIds.includes(myEmployeeId) ||
      item.ackSentToEmployeeId === myEmployeeId
    )
  }

  async function handleUploadScan(itemId: string, file: File) {
    setAckBusyId(itemId)
    try {
      const uploaded = await uploadProtocolAttachmentFile(
        'item',
        itemId,
        file,
        currentUser?.id ?? 'unknown',
        'signed_ack',
      )
      if (!uploaded) {
        window.alert(t('protocols.ack.uploadFail'))
        return
      }
      onRegisterAttachment(uploaded)
      onConfirmAck(itemId, {
        method: 'paper_scan',
        signedAttachmentId: uploaded.id,
        comment: t('protocols.ack.scanAttached'),
      })
    } finally {
      setAckBusyId(null)
      setScanTargetId(null)
    }
  }

  return (
    <PageLayout>
      <PageHeader
        title={t('nav.protocols')}
        subtitle={t('protocols.subtitle')}
        density="compact"
        actions={
          canEdit ? (
            <Button type="button" onClick={openCreate} data-coach="protocols:create">
              {t('protocols.create')}
            </Button>
          ) : null
        }
      />

      <TabBar tabs={tabs} value={tab} onChange={setTab} coachPrefix="protocols" />

      <input
        ref={scanInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          const id = scanTargetId
          e.target.value = ''
          if (file && id) void handleUploadScan(id, file)
        }}
      />

      {tab === 'list' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-2">
              <input
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
                placeholder={t('protocols.filter.number')}
                value={filters.numberQ ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, numberQ: e.target.value }))}
              />
              <select
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
                value={filters.status ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    status: (e.target.value || '') as ProtocolAssignmentStatus | '',
                  }))
                }
              >
                <option value="">{t('protocols.filter.anyStatus')}</option>
                {STATUS_OPTS.map((s) => (
                  <option key={s} value={s}>
                    {t(`protocols.status.${s}`)}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
                value={filters.dateFrom ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
                title={t('protocols.filter.dateFrom')}
              />
              <input
                type="date"
                className="rounded border border-stone-300 px-2 py-1.5 text-sm"
                value={filters.dateTo ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value || undefined }))}
                title={t('protocols.filter.dateTo')}
              />
              <select
                className="rounded border border-stone-300 px-2 py-1.5 text-sm sm:col-span-2"
                value={filters.structuralUnitId ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    structuralUnitId: e.target.value || undefined,
                  }))
                }
              >
                <option value="">{t('protocols.filter.anyUnit')}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-stone-600 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={!!filters.overdueOnly}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, overdueOnly: e.target.checked }))
                  }
                />
                {t('protocols.filter.overdueOnly')}
              </label>
            </div>

            <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
              {list.length === 0 ? (
                <li className="p-4 text-sm text-stone-500">{t('protocols.empty')}</li>
              ) : (
                list.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-stone-50 ${
                        selected?.id === p.id ? 'bg-sky-50' : ''
                      }`}
                      onClick={() => setSelectedId(p.id)}
                    >
                      <span className="font-medium text-stone-800">
                        {p.number} · {p.topic || t('protocols.untitled')}
                      </span>
                      <span className="text-xs text-stone-500">
                        {p.meetingAt.slice(0, 16).replace('T', ' ')}
                        {p.place ? ` · ${p.place}` : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white p-4">
            {!selected ? (
              <p className="text-sm text-stone-500">{t('protocols.selectHint')}</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-stone-900">
                      {selected.number}
                    </h2>
                    <p className="text-stone-700">{selected.topic}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {selected.meetingAt.slice(0, 16).replace('T', ' ')}
                      {selected.place ? ` · ${selected.place}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-stone-600">
                      {t('protocols.field.chair')}: {empLabel(selected.chairEmployeeId)} ·{' '}
                      {t('protocols.field.secretary')}: {empLabel(selected.secretaryEmployeeId)}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => openEdit(selected)}>
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(t('protocols.archiveConfirm'))) {
                            onArchiveProtocol(selected.id)
                            setSelectedId(null)
                          }
                        }}
                      >
                        {t('protocols.archive')}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {selected.notes ? (
                  <p className="rounded bg-stone-50 p-2 text-sm text-stone-700">{selected.notes}</p>
                ) : null}

                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-stone-800">{t('protocols.itemsTitle')}</h3>
                  {canEdit ? (
                    <Button
                      type="button"
                      onClick={() => {
                        setEditingItem(null)
                        setItemEditorOpen(true)
                      }}
                    >
                      {t('protocols.item.create')}
                    </Button>
                  ) : null}
                </div>

                <ul className="space-y-2">
                  {selectedItems.length === 0 ? (
                    <li className="text-sm text-stone-500">{t('protocols.noItems')}</li>
                  ) : (
                    selectedItems.map((it) => (
                      <li
                        key={it.id}
                        className="rounded border border-stone-200 px-3 py-2 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">
                              {it.sortOrder}. {it.assignmentText || it.decision || '—'}
                            </div>
                            <div className="mt-0.5 text-xs text-stone-500">
                              {t(`protocols.status.${it.status}`)}
                              {' · '}
                              {t(`protocols.ackStatus.${it.ackStatus}`)}
                              {it.dueDate ? ` · ${t('protocols.item.dueDate')}: ${it.dueDate}` : ''}
                              {it.assigneeEmployeeIds.length
                                ? ` · ${it.assigneeEmployeeIds.map(empLabel).join(', ')}`
                                : ''}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {canEdit ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingItem(it)
                                    setItemEditorOpen(true)
                                  }}
                                >
                                  {t('common.edit')}
                                </Button>
                                {it.ackStatus === 'not_sent' || it.ackStatus === 'refused' ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                      const to =
                                        it.assigneeEmployeeIds[0] ||
                                        window.prompt(t('protocols.ack.pickAssignee')) ||
                                        ''
                                      if (!to) return
                                      onSendForAck(it.id, to)
                                    }}
                                  >
                                    {t('protocols.ack.send')}
                                  </Button>
                                ) : null}
                                {it.status !== 'done' ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => onSetItemStatus(it.id, 'done')}
                                  >
                                    {t('protocols.status.done')}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() => {
                                    if (window.confirm(t('protocols.item.archiveConfirm'))) {
                                      onArchiveItem(it.id)
                                    }
                                  }}
                                >
                                  {t('protocols.archive')}
                                </Button>
                              </>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setPrintBlank(buildBlank(selected, it))}
                            >
                              {t('protocols.ack.blank')}
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'mine' || tab === 'control' ? (
        <div className="rounded-lg border border-stone-200 bg-white">
          {!myEmployeeId ? (
            <p className="p-4 text-sm text-amber-800">{t('protocols.needEmployeeLink')}</p>
          ) : assignmentRows.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">{t('protocols.noAssignments')}</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {assignmentRows.map(({ protocol, item }) => (
                <li key={item.id} className="px-3 py-2.5 text-sm">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setSelectedId(protocol.id)
                      setTab('list')
                    }}
                  >
                    <div className="font-medium text-stone-800">
                      {protocol.number} · п.{item.sortOrder}
                    </div>
                    <div className="text-stone-700">{item.assignmentText || item.decision}</div>
                    <div className="text-xs text-stone-500">
                      {t(`protocols.status.${item.status}`)}
                      {item.dueDate ? ` · ${item.dueDate}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === 'ack' ? (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">{t('protocols.ackHint')}</p>
          <div className="rounded-lg border border-stone-200 bg-white">
            {assignmentRows.length === 0 ? (
              <p className="p-4 text-sm text-stone-500">{t('protocols.ack.empty')}</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {assignmentRows.map(({ protocol, item }) => {
                  const busy = ackBusyId === item.id
                  return (
                    <li key={item.id} className="px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-medium text-stone-800">
                            {protocol.number} · п.{item.sortOrder}
                          </div>
                          <div className="text-stone-700">
                            {item.assignmentText || item.decision}
                          </div>
                          <div className="mt-0.5 text-xs text-stone-500">
                            {t(`protocols.ackStatus.${item.ackStatus}`)}
                            {item.ackSentToEmployeeId
                              ? ` · ${empLabel(item.ackSentToEmployeeId)}`
                              : item.assigneeEmployeeIds[0]
                                ? ` · ${empLabel(item.assigneeEmployeeIds[0])}`
                                : ''}
                            {item.dueDate ? ` · ${item.dueDate}` : ''}
                            {item.ackLocked ? ` · ${t('protocols.ack.locked')}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setPrintBlank(buildBlank(protocol, item))}
                          >
                            {t('protocols.ack.blank')}
                          </Button>
                          {canEdit &&
                          (item.ackStatus === 'not_sent' || item.ackStatus === 'refused') ? (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                const to = item.assigneeEmployeeIds[0]
                                if (!to) {
                                  window.alert(t('protocols.ack.needAssignee'))
                                  return
                                }
                                onSendForAck(item.id, to)
                              }}
                            >
                              {t('protocols.ack.send')}
                            </Button>
                          ) : null}
                          {canConfirmItem(item) && item.ackStatus === 'pending' ? (
                            <>
                              <Button
                                type="button"
                                disabled={busy}
                                onClick={() => onConfirmAck(item.id, { method: 'in_app' })}
                                data-coach="protocols:ackConfirm"
                              >
                                {t('protocols.ack.confirm')}
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => {
                                  setScanTargetId(item.id)
                                  scanInputRef.current?.click()
                                }}
                              >
                                {t('protocols.ack.uploadSigned')}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => {
                                  const c = window.prompt(t('protocols.ack.refusePrompt')) ?? ''
                                  onRefuseAck(item.id, c || undefined)
                                }}
                              >
                                {t('protocols.ack.refuse')}
                              </Button>
                            </>
                          ) : null}
                          {isSysadmin && item.ackLocked ? (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                const reason = window.prompt(t('protocols.ack.adminFixReason'))
                                if (!reason?.trim()) return
                                onAdminFixAck(item.id, { reason: reason.trim(), unlock: true, clearAck: true })
                              }}
                            >
                              {t('protocols.ack.adminReset')}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {tab === 'journal' ? (
        <div className="rounded-lg border border-stone-200 bg-white">
          {auditRows.length === 0 ? (
            <p className="p-4 text-sm text-stone-500">{t('protocols.journalEmpty')}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {auditRows.map((e) => (
                <li key={e.id} className="px-3 py-2">
                  <div className="text-stone-800">{e.detail}</div>
                  <div className="text-xs text-stone-500">
                    {e.at.slice(0, 19).replace('T', ' ')}
                    {e.byName ? ` · ${e.byName}` : ''} · {e.action}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <ProtocolEditorDialog
        open={editorOpen}
        store={store}
        protocol={editingProtocol}
        defaultSecretaryEmployeeId={myEmployeeId}
        onClose={() => setEditorOpen(false)}
        onSave={(draft) => {
          const id = onUpsertProtocol(draft)
          setSelectedId(id)
        }}
      />

      {selected ? (
        <ProtocolItemEditorDialog
          open={itemEditorOpen}
          store={store}
          protocolId={selected.id}
          item={editingItem}
          onClose={() => setItemEditorOpen(false)}
          onSave={(draft) => onUpsertItem(draft)}
        />
      ) : null}

      {printBlank ? (
        <ProtocolAckPrintModal data={printBlank} onClose={() => setPrintBlank(null)} />
      ) : null}
    </PageLayout>
  )
}

export default ProtocolsPage

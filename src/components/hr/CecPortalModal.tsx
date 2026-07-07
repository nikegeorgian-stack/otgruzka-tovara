import { useEffect, useRef, useState } from 'react'
import { AppDialog } from '@/components/ui/AppDialog'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { buildCecVoterPortalUrl } from '@/lib/hr/cecLookup'
import type { Employee } from '@/lib/types'

const POPUP_NAME = 'fibercell-cec-voter-portal'
const POPUP_FEATURES =
  'popup=yes,width=1180,height=860,menubar=no,toolbar=no,location=yes,status=yes,scrollbars=yes,resizable=yes'

type Props = {
  open: boolean
  emp: Employee
  onClose: () => void
  onApply: (patch: Partial<Employee>) => void
}

export function CecPortalModal({ open, emp, onClose, onApply }: Props) {
  const { t } = useI18n()
  const popupRef = useRef<Window | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [registrationAddress, setRegistrationAddress] = useState(emp.registrationAddress ?? '')
  const [actualAddress, setActualAddress] = useState(emp.actualAddress ?? '')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setRegistrationAddress(emp.registrationAddress ?? '')
    setActualAddress(emp.actualAddress ?? '')
    setNotice(null)
  }, [open, emp.registrationAddress, emp.actualAddress])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => openPopup(), 300)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => {
      const win = popupRef.current
      if (win && win.closed) {
        popupRef.current = null
        setPopupOpen(false)
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      popupRef.current = null
      setPopupOpen(false)
    }
  }, [open])

  function openPopup() {
    setNotice(null)
    const existing = popupRef.current
    if (existing && !existing.closed) {
      existing.focus()
      setPopupOpen(true)
      return
    }

    const pn = emp.personalId?.trim() ?? ''
    const sn = emp.surnameKa?.trim() ?? ''
    const portalUrl = buildCecVoterPortalUrl(pn, sn)
    const win = window.open(portalUrl, POPUP_NAME, POPUP_FEATURES)

    if (pn && sn) {
      void navigator.clipboard?.writeText(`${pn}\n${sn}`).catch(() => {})
    }
    if (!win) {
      setNotice(t('hr.cec.portal.popupBlocked'))
      return
    }

    popupRef.current = win
    setPopupOpen(true)
    win.focus()
  }

  function copyToClipboard(text: string, labelKey: string) {
    if (!text.trim()) return
    void navigator.clipboard.writeText(text).then(() => {
      setNotice(t(labelKey))
      window.setTimeout(() => setNotice(null), 2000)
    })
  }

  function applyAddresses() {
    const reg = registrationAddress.trim()
    const act = actualAddress.trim()
    if (!reg && !act) {
      setNotice(t('hr.cec.portal.emptyAddresses'))
      return
    }
    onApply({
      registrationAddress: reg || undefined,
      actualAddress: act || reg || undefined,
      address: reg || emp.address,
    })
    setNotice(t('hr.cec.portal.applied'))
  }

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={t('hr.cec.portal.title')}
      subtitle={t('hr.cec.portal.subtitle')}
      size="xl"
      blockBackdropClose
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-sm border border-grid px-4 py-2 text-sm font-medium hover:bg-white"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
          <button
            type="button"
            className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            onClick={applyAddresses}
          >
            {t('hr.cec.portal.apply')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">
          {t('hr.cec.portal.cloudflareHint')}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openPopup}
            className="rounded-sm bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
          >
            {popupOpen ? t('hr.cec.portal.focusPopup') : t('hr.cec.portal.openPopup')}
          </button>
          <a
            href={buildCecVoterPortalUrl(emp.personalId, emp.surnameKa)}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-grid px-4 py-2.5 text-sm font-medium hover:bg-stone-50"
          >
            {t('hr.cec.portal.openTab')} ↗
          </a>
        </div>

        {popupOpen && (
          <p className="text-xs text-teal-800">
            {t('hr.cec.portal.popupOpen')}
            {emp.personalId && emp.surnameKa && (
              <span className="mt-1 block font-mono text-stone-600">
                {emp.personalId} · {emp.surnameKa}
              </span>
            )}
          </p>
        )}

        {(!emp.personalId || !emp.surnameKa) && (
          <FormNotice type="info" message={t('hr.cec.portal.fillFirst')} />
        )}

        <div className="rounded-sm border border-grid bg-stone-50 p-3">
          <p className="text-xs font-semibold text-stone-700">{t('hr.cec.portal.searchHint')}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-stone-600">
            <li>{t('hr.cec.portal.step1')}</li>
            <li>{t('hr.cec.portal.step2')}</li>
            <li>{t('hr.cec.portal.step3')}</li>
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {emp.personalId && (
              <button
                type="button"
                className="rounded border border-grid bg-white px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => copyToClipboard(emp.personalId!, 'hr.cec.portal.copiedId')}
              >
                {t('hr.cec.portal.copyId')}: {emp.personalId}
              </button>
            )}
            {emp.surnameKa && (
              <button
                type="button"
                className="rounded border border-grid bg-white px-2 py-1 text-xs hover:bg-stone-100"
                onClick={() => copyToClipboard(emp.surnameKa!, 'hr.cec.portal.copiedSurname')}
              >
                {t('hr.cec.portal.copySurname')}: {emp.surnameKa}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
            {t('hr.cec.registrationAddress')}
            <textarea
              rows={3}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('hr.cec.portal.regPlaceholder')}
              value={registrationAddress}
              onChange={(e) => setRegistrationAddress(e.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
            {t('hr.cec.actualAddress')}
            <textarea
              rows={3}
              className="mt-1 w-full rounded-sm border border-grid px-3 py-2 text-sm"
              placeholder={t('hr.cec.portal.actPlaceholder')}
              value={actualAddress}
              onChange={(e) => setActualAddress(e.target.value)}
            />
          </label>
        </div>

        {notice && (
          <FormNotice
            type={notice.includes(t('hr.cec.portal.applied')) ? 'success' : 'info'}
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        )}
      </div>
    </AppDialog>
  )
}

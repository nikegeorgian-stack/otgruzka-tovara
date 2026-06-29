import { useState } from 'react'
import { CecPortalModal } from '@/components/hr/CecPortalModal'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { lookupCecVoter } from '@/lib/hr/cecClient'
import {
  CITIZENSHIP_OPTIONS,
  isGeorgianCitizen,
  looksLikeGeorgianPersonalId,
} from '@/lib/hr/citizenship'
import type { Employee } from '@/lib/types'

type Props = {
  emp: Employee
  onPatch: (partial: Partial<Employee>) => void
}

export function CecIdentityPanel({ emp, onPatch }: Props) {
  const { t, locale } = useI18n()
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [portalOpen, setPortalOpen] = useState(false)

  const citizenship = (emp.citizenship ?? 'GE') as string
  const showCec = isGeorgianCitizen(citizenship as 'GE')

  async function runCecLookup() {
    const personalId = emp.personalId?.trim() ?? ''
    const surname = emp.surnameKa?.trim() ?? ''
    if (!looksLikeGeorgianPersonalId(personalId)) {
      setNotice(t('hr.cec.errPersonalId'))
      return
    }
    if (!surname) {
      setNotice(t('hr.cec.errSurname'))
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      const result = await lookupCecVoter({ personalId, surname })
      if (!result.ok || !result.data) {
        setNotice(t(`hr.cec.err.${result.error ?? 'cec_not_found'}`))
        return
      }

      const d = result.data
      onPatch({
        personalId,
        surnameKa: surname,
        citizenship: 'GE',
        registrationAddress: d.registrationAddress ?? emp.registrationAddress,
        actualAddress: d.actualAddress ?? d.registrationAddress ?? emp.actualAddress,
        address: d.registrationAddress ?? emp.address,
        birthDate: d.birthDate ?? emp.birthDate,
        nameKa: d.fullName ?? emp.nameKa,
      })
      setNotice(t('hr.cec.success'))
    } catch {
      setNotice(t('hr.cec.err.cec_network'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-sm border border-teal-200 bg-teal-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-800">{t('hr.cec.title')}</h3>
          <p className="mt-1 text-xs text-stone-600">{t('hr.cec.hint')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!emp.personalId?.trim() || !emp.surnameKa?.trim()) {
              setNotice(t('hr.cec.portal.fillFirst'))
              return
            }
            setPortalOpen(true)
          }}
          className="text-xs font-semibold text-teal-800 hover:underline"
        >
          {t('hr.cec.openPortal')} ↗
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-500">
          {t('hr.cec.citizenship')}
          <select
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
            value={citizenship}
            onChange={(e) => onPatch({ citizenship: e.target.value })}
          >
            {CITIZENSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {locale === 'ka' ? o.labelKa : o.labelRu}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-stone-500">
          {t('hr.cec.personalId')}
          <input
            className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm font-mono"
            inputMode="numeric"
            maxLength={11}
            placeholder="01234567890"
            value={emp.personalId ?? ''}
            onChange={(e) =>
              onPatch({ personalId: e.target.value.replace(/\D/g, '').slice(0, 11) })
            }
          />
        </label>

        {showCec && (
          <>
            <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
              {t('hr.cec.surnameKa')}
              <input
                className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                placeholder="გვარაძე"
                value={emp.surnameKa ?? ''}
                onChange={(e) => onPatch({ surnameKa: e.target.value })}
              />
            </label>

            <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
              {t('hr.cec.registrationAddress')}
              <textarea
                rows={2}
                className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                value={emp.registrationAddress ?? ''}
                onChange={(e) =>
                  onPatch({
                    registrationAddress: e.target.value,
                    address: e.target.value || emp.address,
                  })
                }
              />
            </label>

            <label className="block text-xs font-medium text-stone-500 sm:col-span-2">
              {t('hr.cec.actualAddress')}
              <textarea
                rows={2}
                className="mt-1 w-full rounded-sm border border-grid bg-white px-3 py-2 text-sm"
                value={emp.actualAddress ?? ''}
                onChange={(e) => onPatch({ actualAddress: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void runCecLookup()}
                className="rounded-sm bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {loading ? t('hr.cec.loading') : t('hr.cec.fetch')}
              </button>
              {emp.personalId && !looksLikeGeorgianPersonalId(emp.personalId) && (
                <span className="text-xs text-amber-700">{t('hr.cec.errPersonalId')}</span>
              )}
            </div>
          </>
        )}
      </div>

      {notice && (
        <div className="mt-3">
          <FormNotice
            type={notice === t('hr.cec.success') ? 'success' : 'info'}
            message={notice}
            onDismiss={() => setNotice(null)}
          />
        </div>
      )}

      <CecPortalModal
        open={portalOpen}
        emp={emp}
        onClose={() => setPortalOpen(false)}
        onApply={(patch) => {
          onPatch(patch)
          setNotice(t('hr.cec.portal.applied'))
          setPortalOpen(false)
        }}
      />
    </div>
  )
}

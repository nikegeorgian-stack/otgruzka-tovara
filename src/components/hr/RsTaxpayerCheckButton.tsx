import { useState } from 'react'
import { FormNotice } from '@/components/ui/FormNotice'
import { useI18n } from '@/context/I18nContext'
import { looksLikeGeorgianPersonalId } from '@/lib/hr/citizenship'
import {
  compareEmployeeToRsName,
  lookupRsTaxpayer,
  type RsTaxpayerInfo,
} from '@/lib/hr/rsGeClient'
import type { Employee } from '@/lib/types'

type Props = {
  emp: Employee
}

export function RsTaxpayerCheckButton({ emp }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [info, setInfo] = useState<RsTaxpayerInfo | null>(null)
  const [match, setMatch] = useState<'match' | 'mismatch' | 'unknown' | null>(null)
  const [notice, setNotice] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  )

  async function runCheck() {
    const personalId = emp.personalId?.trim() ?? ''
    if (!looksLikeGeorgianPersonalId(personalId) && !/^\d{9}$/.test(personalId)) {
      setNotice({ type: 'error', message: t('hr.rs.errPersonalId') })
      return
    }

    setLoading(true)
    setNotice(null)
    setInfo(null)
    setMatch(null)
    try {
      const result = await lookupRsTaxpayer(personalId)
      if (!result.ok) {
        const baseKey = `hr.rs.err.${result.error}`
        const base = t(baseKey)
        const message =
          result.detail && base !== baseKey ? `${base} (${result.detail})` : base !== baseKey ? base : result.error
        setNotice({ type: 'error', message })
        return
      }
      setInfo(result.data)
      const m = compareEmployeeToRsName([emp.fullName, emp.nameKa], result.data.name)
      setMatch(m)
      if (m === 'match') setNotice({ type: 'success', message: t('hr.rs.match') })
      else if (m === 'mismatch') setNotice({ type: 'info', message: t('hr.rs.mismatch') })
      else setNotice({ type: 'success', message: t('hr.rs.loaded') })
    } catch {
      setNotice({ type: 'error', message: t('hr.rs.err.network') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-3 rounded-sm border border-sky-200 bg-sky-50/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-stone-800">{t('hr.rs.title')}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">{t('hr.rs.hint')}</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runCheck()}
          className="rounded-sm bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
        >
          {loading ? t('hr.rs.loading') : t('hr.rs.check')}
        </button>
      </div>

      {notice && (
        <div className="mt-2">
          <FormNotice type={notice.type} message={notice.message} />
        </div>
      )}

      {info && (
        <dl className="mt-2 grid gap-1 text-xs text-stone-700 sm:grid-cols-2">
          <div>
            <dt className="text-stone-400">{t('hr.rs.name')}</dt>
            <dd className="font-medium">{info.name}</dd>
          </div>
          {info.status ? (
            <div>
              <dt className="text-stone-400">{t('hr.rs.status')}</dt>
              <dd>{info.status}</dd>
            </div>
          ) : null}
          {info.address ? (
            <div className="sm:col-span-2">
              <dt className="text-stone-400">{t('hr.rs.address')}</dt>
              <dd>{info.address}</dd>
            </div>
          ) : null}
          {match === 'match' ? (
            <p className="sm:col-span-2 font-semibold text-emerald-700">{t('hr.rs.matchBadge')}</p>
          ) : null}
          {match === 'mismatch' ? (
            <p className="sm:col-span-2 font-semibold text-amber-700">{t('hr.rs.mismatchBadge')}</p>
          ) : null}
        </dl>
      )}
    </div>
  )
}

import { useI18n } from '@/context/I18nContext'
import { itActTypeLabelKey } from '@/lib/itOffice/labels'
import type { ItHandoverAct } from '@/lib/itOffice/types'

export type ItHandoverPrintLine = {
  assetName: string
  inventoryNo: string
  serialNo?: string
  condition?: string
}

export type ItHandoverPrintModel = {
  act: ItHandoverAct
  employeeName: string
  fromEmployeeName?: string
  issuedByName: string
  lines: ItHandoverPrintLine[]
}

type Props = {
  model: ItHandoverPrintModel
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  if (!y || !m || !d) return iso
  return `${d}.${m}.${y}`
}

export function ItHandoverPrintSheet({ model }: Props) {
  const { t } = useI18n()
  const { act, employeeName, fromEmployeeName, issuedByName, lines } = model
  const actTypeKey = itActTypeLabelKey(act.actType)

  return (
    <article className="print-sheet-page">
      <div className="print-sheet-content">
        <header className="mb-6 border-b border-stone-300 pb-4">
          <div className="text-lg font-bold tracking-wide text-stone-800">FiberCell</div>
          <div className="text-xs text-stone-500">{t('itOffice.print.orgLine')}</div>
        </header>

        <h1 className="mb-2 text-xl font-bold text-stone-900">{t('itOffice.print.actTitle')}</h1>
        <p className="mb-4 text-sm text-stone-700">
          {t('itOffice.print.actNo')}{' '}
          <strong>{act.number}</strong> {t('itOffice.print.fromDate')}{' '}
          <strong>{formatDate(act.date)}</strong>
        </p>

        <dl className="mb-6 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-stone-600">{t('itOffice.col.actType')}</dt>
            <dd>{t(actTypeKey)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-stone-600">{t('itOffice.col.employee')}</dt>
            <dd>{employeeName}</dd>
          </div>
          {act.actType === 'transfer' && fromEmployeeName ? (
            <div>
              <dt className="font-semibold text-stone-600">{t('itOffice.col.fromEmployee')}</dt>
              <dd>{fromEmployeeName}</dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-stone-600">{t('itOffice.col.issuedBy')}</dt>
            <dd>{issuedByName}</dd>
          </div>
          {act.comment ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-stone-600">{t('itOffice.col.comment')}</dt>
              <dd>{act.comment}</dd>
            </div>
          ) : null}
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-stone-800">
              <th className="px-2 py-2 text-left font-semibold">{t('itOffice.print.colNo')}</th>
              <th className="px-2 py-2 text-left font-semibold">{t('itOffice.col.name')}</th>
              <th className="px-2 py-2 text-left font-semibold">{t('itOffice.col.inventoryNo')}</th>
              <th className="px-2 py-2 text-left font-semibold">{t('itOffice.col.serialNo')}</th>
              <th className="px-2 py-2 text-left font-semibold">{t('itOffice.col.condition')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr key={`${line.inventoryNo}-${i}`} className="border-b border-stone-300">
                <td className="px-2 py-2">{i + 1}</td>
                <td className="px-2 py-2">{line.assetName}</td>
                <td className="px-2 py-2 font-mono text-xs">{line.inventoryNo}</td>
                <td className="px-2 py-2">{line.serialNo || '—'}</td>
                <td className="px-2 py-2">{line.condition || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-10 grid gap-12 sm:grid-cols-2">
          <div>
            <p className="mb-8 text-sm text-stone-600">{t('itOffice.print.receivedBy')}</p>
            <div className="border-t border-stone-800 pt-1 text-sm">{employeeName}</div>
          </div>
          <div>
            <p className="mb-8 text-sm text-stone-600">{t('itOffice.print.issuedBySign')}</p>
            <div className="border-t border-stone-800 pt-1 text-sm">{issuedByName}</div>
          </div>
        </div>

        <p className="mt-8 text-[10px] text-stone-400">{t('itOffice.print.generated')}</p>
      </div>
    </article>
  )
}

export function buildItHandoverPrintModel(
  act: ItHandoverAct,
  assets: { id: string; name: string; inventoryNo: string; serialNo?: string }[],
  employeeName: string,
  fromEmployeeName: string | undefined,
): ItHandoverPrintModel {
  const assetMap = new Map(assets.map((a) => [a.id, a]))
  const lines: ItHandoverPrintLine[] = act.lines.map((line) => {
    const asset = assetMap.get(line.assetId)
    return {
      assetName: asset?.name ?? line.assetId,
      inventoryNo: asset?.inventoryNo ?? '—',
      serialNo: asset?.serialNo,
      condition: line.condition,
    }
  })

  return {
    act,
    employeeName,
    fromEmployeeName,
    issuedByName: act.issuedByName,
    lines,
  }
}

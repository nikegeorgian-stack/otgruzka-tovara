import { FiberCellBrand } from '@/components/brand/FiberCellBrand'
import { useI18n } from '@/context/I18nContext'
import type { ResolvedDocHeaderContext } from '@/lib/print/docHeaderOptions'

type Props = {
  header: ResolvedDocHeaderContext
  title: string
  docNumber?: string
  docDate?: string
  formCode?: string
  pageLabel?: string
}

/** Универсальная шапка бланка по опциям пресета (RU/KA). */
export function DocumentPrintHeader({
  header,
  title,
  docNumber,
  docDate,
  formCode,
  pageLabel,
}: Props) {
  const { t, locale } = useI18n()
  const { flags } = header

  const rows: { label: string; value: string }[] = []
  if (flags.showOrg && header.organization) {
    rows.push({ label: t('print.ge.org'), value: header.organization })
  }
  if (flags.showUnit && header.structuralUnit) {
    rows.push({ label: t('print.ge.unit'), value: header.structuralUnit })
  }
  if (flags.showIdCode && header.idCode) {
    rows.push({ label: t('print.ge.idCode'), value: header.idCode })
  }
  if (flags.showAddress && header.address) {
    rows.push({ label: t('docHeader.field.address'), value: header.address })
  }
  if (flags.showBank && header.bankLine) {
    rows.push({ label: t('docHeader.field.bank'), value: header.bankLine })
  }
  if (flags.showPeriod && header.periodLabel) {
    rows.push({ label: t('print.ge.period'), value: header.periodLabel })
  }
  if (flags.showMol && header.mol) {
    rows.push({ label: t('docHeader.field.mol'), value: header.mol })
  }
  if (flags.showWarehouse && header.warehouseName) {
    rows.push({ label: t('docHeader.field.warehouse'), value: header.warehouseName })
  }
  if (flags.showCounterparty && header.counterparty) {
    rows.push({ label: t('docHeader.field.counterparty'), value: header.counterparty })
  }
  if (flags.showPurpose && header.purposeLabel) {
    rows.push({ label: t('docHeader.field.purpose'), value: header.purposeLabel })
  }
  if (flags.showRsKey && header.rsKey) {
    rows.push({ label: t('docHeader.field.rsKey'), value: header.rsKey })
  }
  if (flags.showProductionLink && header.productionLabel) {
    rows.push({ label: t('docHeader.field.production'), value: header.productionLabel })
  }
  if (docNumber) {
    rows.push({ label: t('docHeader.field.docNumber'), value: docNumber })
  }
  if (docDate) {
    rows.push({ label: t('docHeader.field.docDate'), value: docDate })
  }

  return (
    <header className="print-sheet-header border-b border-grid pb-3 mb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {flags.showLogo ? <FiberCellBrand variant="print" /> : null}
          <div className="min-w-0">
            {(formCode || pageLabel) && (
              <div className="print-form-registry text-xs text-stone-500" aria-hidden>
                {formCode ? <span className="print-form-code mr-2">{formCode}</span> : null}
                {pageLabel ? <span className="print-form-page">{pageLabel}</span> : null}
              </div>
            )}
            <h1 className="print-title text-base font-bold text-ink">{title}</h1>
            {locale === 'ru' && flags.showOrderRef ? (
              <p className="text-[10px] text-stone-500 mt-0.5">{t('docHeader.orderHint')}</p>
            ) : null}
          </div>
        </div>
      </div>
      {rows.length > 0 ? (
        <table className="mt-2 w-full text-xs border-collapse">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-stone-100">
                <th className="py-0.5 pr-2 text-left font-medium text-stone-500 w-[36%] align-top">
                  {r.label}
                </th>
                <td className="py-0.5 text-ink align-top">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </header>
  )
}

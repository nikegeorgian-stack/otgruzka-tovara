/**
 * Excel «Salary Calculation» как в шаблоне Fibercell:
 * 1) лист месяца — входы + формулы
 * 2) INFO — сотрудники / пенсия
 * 3) რეესტრი — заготовка (как в файле)
 * 4) G — курсы НБГ (таблица для VLOOKUP)
 */

import { formatMonthTitle } from '@/lib/dates'
import {
  buildSalary1cRows,
  lastDayOfMonth,
  type Salary1cInfoRow,
  type Salary1cInputRow,
} from '@/lib/finance/georgiaSalary1c'
import { fetchNbgRates } from '@/lib/finance/nbgRates'
import { loadExcelJs } from '@/lib/lazy/exceljs'
import { t } from '@/i18n'
import type { Locale } from '@/i18n/types'
import type { AppStore } from '@/lib/types'

const BORDER = 'FFE5E7EB'
const HEADER_BG = 'FFFFF5F0'
const HEADER_FG = 'FF9A3412'
const TOTAL_BG = 'FFFFF7ED'

/** Валюты как в шаблоне (лист G, без GEL). */
const G_CURRENCIES = [
  'DKK', 'EUR', 'GBP', 'ISK', 'RSD', 'NOK', 'PLN', 'RON', 'HUF', 'SEK', 'CHF',
  'CZK', 'USD', 'CAD', 'AUD', 'EGP', 'TRY', 'JPY', 'AED', 'IRR', 'ILS', 'SGD',
  'KWD', 'CNY', 'HKD', 'INR', 'NZD', 'RUB', 'AZN', 'BYN', 'TMT', 'MDL', 'AMD',
  'TJS', 'UZS', 'UAH', 'KZT', 'KGS', 'ZAR', 'BRL', 'QAR', 'KRW',
] as const

const MONTH_HEADERS = [
  '#',
  'Description',
  'Employee ID',
  'Employee Name Surname',
  'Currency',
  'Gross Salary',
  'Pensions Contribution (2% from Employee)',
  'Pensions Contribution (2% from Employer)',
  'Gross Salary excluding pensions contribution',
  'Date',
  'Exchange Rate',
  'Gross Salary (exluding pensiosn cont.) in GEL',
  'WHT in GEL',
  'Meal Allowance Employee',
  'Meal Allowance Company',
  'Net Salary in GEL',
  '',
  'Pensions Contribution in GEL',
  'Included in Pension Scheme',
  '',
  'Bank Account',
] as const

function downloadXlsx(buffer: ArrayBuffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function thinBorder() {
  return {
    top: { style: 'thin' as const, color: { argb: BORDER } },
    left: { style: 'thin' as const, color: { argb: BORDER } },
    bottom: { style: 'thin' as const, color: { argb: BORDER } },
    right: { style: 'thin' as const, color: { argb: BORDER } },
  }
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeMonthFormulas(ws: any, sheetName: string, excelRow: number) {
  const r = excelRow
  const sn = sheetName.replace(/'/g, "''")
  // B=# C=Description D=ID E=Name F=Cur G=Gross … V=Bank  (колонки с 2)
  ws.getCell(`E${r}`).value = {
    formula: `IFERROR(_xlfn.XLOOKUP($D${r},INFO!$A$1:$A$500,INFO!$E$1:$E$500," ")," ")`,
  }
  ws.getCell(`G${r}`).value = {
    formula: `IF($T${r}="YES",(O${r}+Q${r}+P${r})/0.784,(O${r}+Q${r}+P${r})/0.8)`,
  }
  ws.getCell(`H${r}`).value = {
    formula: `IF($T${r}="YES",G${r}*0.02,0)`,
  }
  ws.getCell(`I${r}`).value = { formula: `H${r}` }
  ws.getCell(`J${r}`).value = { formula: `G${r}-H${r}` }
  // Курс: GEL=1, иначе VLOOKUP даты в таблице G + MATCH валюты по заголовку
  ws.getCell(`L${r}`).value = {
    formula: `IF(F${r}="GEL",1,IFERROR(INDEX(G!$A$1:$AQ$400,MATCH(K${r},G!$A:$A,0),MATCH('${sn}'!$F${r},G!$1:$1,0)),1))`,
  }
  ws.getCell(`M${r}`).value = { formula: `J${r}*L${r}` }
  ws.getCell(`N${r}`).value = { formula: `M${r}*20%` }
  ws.getCell(`P${r}`).value = { formula: `O${r}` }
  ws.getCell(`S${r}`).value = { formula: `(H${r}+I${r})*L${r}` }
  ws.getCell(`T${r}`).value = {
    formula: `IFERROR(_xlfn.XLOOKUP($D${r},INFO!$A:$A,INFO!$F:$F," ")," ")`,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeMonthInputs(ws: any, excelRow: number, row: Salary1cInputRow) {
  const r = excelRow
  ws.getCell(`B${r}`).value = row.no
  ws.getCell(`C${r}`).value = 'Salary'
  ws.getCell(`D${r}`).value = row.personalId
  ws.getCell(`F${r}`).value = row.currency
  ws.getCell(`K${r}`).value = parseYmd(row.rateDate)
  ws.getCell(`K${r}`).numFmt = 'yyyy-mm-dd'
  ws.getCell(`O${r}`).value = row.mealEmployee
  ws.getCell(`O${r}`).numFmt = '#,##0.00'
  ws.getCell(`Q${r}`).value = row.netSalaryGel
  ws.getCell(`Q${r}`).numFmt = '#,##0.00'
  ws.getCell(`V${r}`).value = row.bankAccount || ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function styleDataRow(ws: any, excelRow: number) {
  for (let c = 2; c <= 22; c++) {
    const cell = ws.getRow(excelRow).getCell(c)
    cell.border = thinBorder()
    if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeInfoSheet(ws: any, info: Salary1cInfoRow[]) {
  const headers = [
    'პირადი ნომერი',
    'სახელი',
    'გვარი',
    'სახელი გვარი',
    'Name Surname',
    'საპენსიო',
    'მისამართი',
    'სტატუსი',
  ]
  headers.forEach((h, i) => {
    const cell = ws.getRow(1).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 9 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
  })
  info.forEach((row, idx) => {
    const r = idx + 2
    ws.getCell(`A${r}`).value = row.personalId
    ws.getCell(`B${r}`).value = row.firstNameKa
    ws.getCell(`C${r}`).value = row.lastNameKa
    ws.getCell(`D${r}`).value = {
      formula: `CONCATENATE($B${r}," ",$C${r})`,
    }
    ws.getCell(`E${r}`).value = row.nameEn
    ws.getCell(`F${r}`).value = row.pensionScheme
    ws.getCell(`G${r}`).value = row.address
    ws.getCell(`H${r}`).value = 'აქტიური'
  })
  ;[14, 14, 16, 22, 22, 10, 36, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeRegistryStub(ws: any) {
  const headers = [
    'ID',
    'პ.ნ',
    '',
    'დაქირავებული',
    'სქესი',
    'მოქალაქეობა',
    'სტატუსი',
    'რედაქტირებული',
    'დაბადების თარიღი',
    'ტელეფონი',
    'სამუშაო განაკვეთი',
    'რეესტრში შეტანის თარიღი',
    'გააქტიურების თარიღი',
    'ბოლო ცვლილების მომხმარებელი',
    'რედაქტირებული',
  ]
  headers.forEach((h, i) => {
    const cell = ws.getRow(1).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, size: 9 }
  })
  ws.getCell('A2').value =
    'Stub — fill from RS.ge registry if needed. Salary formulas use INFO sheet.'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeRatesSheet(ws: any, rateDate: string, rates: Record<string, number>) {
  ws.getCell('A1').value = 'Column1'
  G_CURRENCIES.forEach((code, i) => {
    ws.getCell(1, i + 2).value = code
  })
  ws.getCell('A2').value = parseYmd(rateDate)
  ws.getCell('A2').numFmt = 'yyyy-mm-dd'
  G_CURRENCIES.forEach((code, i) => {
    const cell = ws.getCell(2, i + 2)
    const v = rates[code]
    cell.value = Number.isFinite(v) ? Math.round(v! * 1e6) / 1e6 : null
  })
}

/**
 * Excel в формате Fibercell «Salary Calculation» (листы + формулы).
 */
export async function exportSalaryCalculation1cExcel(
  store: AppStore,
  month: string,
  _locale: Locale = store.settings.locale,
  opts?: { rateDate?: string },
): Promise<{ missingRates: string[]; rateDate: string }> {
  const rateDate = opts?.rateDate?.trim() || lastDayOfMonth(month)
  const nbg = await fetchNbgRates(rateDate)
  const rates = nbg.ok ? nbg.rates : { GEL: 1 }
  const built = buildSalary1cRows(store, month, nbg.ok ? nbg.date : rateDate)
  if (!built.rows.length) {
    throw new Error('salary1c_empty')
  }

  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FiberCell Otgruzka'
  wb.created = new Date()

  const monthTitle = formatMonthTitle(month, 'en')
  const sheetName = (monthTitle.slice(0, 31) || month).replace(/[\\/*?:\[\]]/g, ' ')

  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 1, showGridLines: false }],
  })

  ws.getCell('B2').value = built.orgTitle
  ws.getCell('B2').font = { bold: true, size: 14, color: { argb: 'FF1A1A1A' } }
  ws.getCell('B3').value = `Salary ${monthTitle}`
  ws.getCell('B3').font = { bold: true, size: 12 }
  ws.getCell('C3').value = `Salary ${monthTitle}`

  const headerRow = 5
  MONTH_HEADERS.forEach((h, i) => {
    const cell = ws.getRow(headerRow).getCell(i + 2) // с колонки B
    if (!h) return
    cell.value = h
    cell.font = { bold: true, size: 9, color: { argb: HEADER_FG } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } }
    cell.border = thinBorder()
    cell.alignment = { wrapText: true, vertical: 'middle' }
  })
  ws.getRow(headerRow).height = 36

  const firstData = headerRow + 1
  let r = firstData
  for (const row of built.rows) {
    writeMonthInputs(ws, r, row)
    writeMonthFormulas(ws, sheetName, r)
    styleDataRow(ws, r)
    r += 1
  }
  const lastData = r - 1

  // Total — как в шаблоне
  const totalRow = r
  ws.getCell(`B${totalRow}`).value = 'Total:'
  ws.getCell(`B${totalRow}`).font = { bold: true }
  ws.getCell(`C${totalRow}`).value = 'Total:'
  const sumCols = ['G', 'H', 'I', 'J', 'M', 'N', 'O', 'Q', 'S'] as const
  for (const col of sumCols) {
    const cell = ws.getCell(`${col}${totalRow}`)
    cell.value = { formula: `SUM(${col}${firstData}:${col}${lastData})` }
    cell.numFmt = '#,##0.00'
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } }
    cell.border = thinBorder()
  }
  ws.getCell(`T${totalRow}`).value = {
    formula: `COUNTA(T${firstData}:T${lastData})`,
  }
  ws.getCell(`T${totalRow}`).font = { bold: true }

  r = totalRow + 4
  ws.getCell(`C${r}`).value = 'Signature'
  ws.getCell(`D${r}`).value = '_____________________'

  const widths = [3, 5, 12, 16, 28, 10, 12, 14, 14, 14, 12, 12, 14, 12, 12, 12, 12, 4, 12, 12, 4, 28]
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w
  })

  const infoWs = wb.addWorksheet('INFO')
  writeInfoSheet(infoWs, built.info)

  const regWs = wb.addWorksheet('დაქირავბეულ პირთა რეესტრი')
  writeRegistryStub(regWs)

  const gWs = wb.addWorksheet('G')
  writeRatesSheet(gWs, built.rateDate, rates)

  const buffer = await wb.xlsx.writeBuffer()
  const fname = `Fibercell Technology_Salary Calculation_${month.replace('-', '.')}.xlsx`
  downloadXlsx(buffer as ArrayBuffer, fname)

  const missingRates = [
    ...new Set(
      built.rows
        .map((row) => row.currency)
        .filter((c) => c !== 'GEL' && !Number.isFinite(rates[c])),
    ),
  ]

  return {
    missingRates,
    rateDate: built.rateDate,
  }
}

export function salary1cEmptyMessage(locale: Locale): string {
  return t(locale, 'fin.salary1c.empty')
}

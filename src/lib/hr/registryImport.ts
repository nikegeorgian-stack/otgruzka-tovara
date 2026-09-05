import type { SheetView, WorkbookView } from '@/lib/excel/workbookAdapter'
import { detectBankFromIban, normalizeIban } from './banks'
import { createNewEmployee } from './newEmployee'
import { applyHrStatus } from './sync'
import { suggestNextTabNumber } from './tabNumber'
import type {
  EmployeeGender,
  HrBankAccount,
  HrContractType,
  HrDocument,
  HrEmploymentContract,
  HrEmploymentContractStatus,
} from './types'
import type { Employee } from '@/lib/types'
import { inferContractAgreementKind, isPendingContractTerm } from './contracts'

export type RegistryContract = {
  idNumber: string
  idLink?: string
  address: string
  positionKa: string
  position: string
  bankAccount: string
  phone: string
  salary?: number
  contractNumber: string
  contractLink?: string
  hireDate?: string
  term: string
  endDate?: string
  bonusThirteenth?: string
  laborRegistry: string
}

export type RegistryPerson = {
  tabNumber: string
  fullName: string
  nameKa: string
  gender: string
  citizenship: string
  birthDate?: string
  phone?: string
  email?: string
  address?: string
  personalId?: string
  idLink?: string
  /** Все IBAN из строк реестра (кол. «ანგარიშის ნომერი») */
  ibans: string[]
  contracts: RegistryContract[]
  /** Уволен / увольняется — из текста в колонке ФИО */
  terminated?: boolean
  terminationDate?: string
}

export type RegistryImportStats = {
  matched: number
  created: number
  updated: number
  notInRegistry: number
  totalInRegistry: number
  skipped?: number
}

export type RegistryImportResult = {
  employees: Employee[]
  stats: RegistryImportStats
}

export type RegistryImportOptions = {
  /** Не сливать с текущей базой — только строки реестра */
  replaceExisting?: boolean
  /** Сопоставление только по ФИО (RU/KA), без табельного № */
  matchByName?: boolean
  /** Кого создавать из «нет в базе» — ключ registryPersonKey. Если задан Set — только выбранные */
  createMissingKeys?: Set<string>
}

export type RegistryImportAnalysis = {
  matched: Array<{ person: RegistryPerson; employee: Employee }>
  missingInDb: RegistryPerson[]
  notInRegistry: Employee[]
}

const MONTHS_RU: Record<string, string> = {
  январ: '01',
  феврал: '02',
  март: '03',
  апрел: '04',
  ма: '05',
  июн: '06',
  июл: '07',
  август: '08',
  сентябр: '09',
  октябр: '10',
  ноябр: '11',
  декабр: '12',
}

function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
}

function excelDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined
    return v.toISOString().slice(0, 10)
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v !== 'number') return undefined
  const epoch = Math.round((v - 25569) * 86400 * 1000)
  const d = new Date(epoch)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

function parseSalary(raw: unknown): number | undefined {
  const text = String(raw ?? '')
    .replace(/\s/g, ' ')
    .trim()
  if (!text) return undefined
  const firstLine = text.split(/[\n\r]+/)[0] ?? text
  const match = firstLine.match(/(\d+(?:[.,]\d+)?)/)
  if (!match) return undefined
  const n = parseFloat(match[1].replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

function mapCitizenship(raw: string): string {
  const key = raw.trim().toUpperCase().replace(/\s/g, '')
  if (key.startsWith('GEO') || key === 'GE') return 'GE'
  if (key.startsWith('AZR') || key === 'AZ') return 'AZ'
  if (key.startsWith('UKR') || key === 'UA') return 'UA'
  if (key.startsWith('ARM') || key === 'AM') return 'AM'
  if (key.startsWith('RU')) return 'RU'
  return 'OTHER'
}

function mapGender(raw: string): EmployeeGender | undefined {
  const key = raw.trim().toLowerCase()
  if (!key) return undefined
  if (/^(м|male|m\b|კაც|♂)/.test(key)) return 'male'
  if (/^(ж|female|f\b|ქალი|ქ\b|♀)/.test(key)) return 'female'
  return 'unknown'
}

function parseTextDate(raw: string): string | undefined {
  const s = raw.trim()
  const dotted = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{2,4})/)
  if (dotted) {
    let year = parseInt(dotted[3], 10)
    if (year < 100) year += 2000
    return `${year}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`
  }
  const lower = s.toLowerCase()
  for (const [stem, mm] of Object.entries(MONTHS_RU)) {
    const m = lower.match(new RegExp(`(\\d{1,2})\\s*${stem}\\w*`, 'i'))
    if (m) {
      const yearMatch = lower.match(/(20\d{2}|\d{2})\s*(?:г|year|$)/)
      let year = new Date().getFullYear()
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10)
        if (year < 100) year += 2000
      }
      return `${year}-${mm}-${m[1].padStart(2, '0')}`
    }
  }
  return undefined
}

/** Разбор ФИО с пометками «уволен / увольняется» в той же ячейке. */
export function parseRegistryPersonName(raw: string): Pick<
  RegistryPerson,
  'fullName' | 'terminated' | 'terminationDate'
> {
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const mainLine = lines[0]?.replace(/\s+/g, ' ').trim() ?? ''
  const tail = lines.slice(1).join(' ') + (lines.length <= 1 ? '' : '')
  const combined = lines.join(' ')
  const fired = /увол|увольн|შეწყვეტ|terminated|dismissed/i.test(combined)
  let terminationDate: string | undefined
  for (const part of [combined, tail, mainLine]) {
    terminationDate = parseTextDate(part) ?? excelDate(part)
    if (terminationDate) break
  }
  const cleanName =
    lines.find((l) => l.length > 2 && !/увол|увольн|შეწყვეტ/i.test(l))?.replace(/\s+/g, ' ').trim() ||
    mainLine.replace(/\s*[-–—].*(увол|увольн|შეწყვეტ).*/i, '').trim()

  return {
    fullName: cleanName,
    terminated: fired,
    terminationDate,
  }
}

function parsePhone(raw: string): { phone: string; email?: string } {
  const parts = raw.split(/\n|,/).map((p) => p.trim()).filter(Boolean)
  let phone = ''
  let email: string | undefined
  for (const p of parts) {
    if (p.includes('@')) email = p
    else if (!phone) phone = p.replace(/\s+/g, ' ').trim()
  }
  if (!phone && parts[0] && !parts[0].includes('@')) phone = parts[0]
  return { phone, email }
}

/** Извлекает грузинские IBAN из ячейки (с пробелами, переносами, мусором). */
export function extractIbans(raw: string): string[] {
  const text = String(raw ?? '').toUpperCase()
  if (!text.trim()) return []
  const found = new Set<string>()
  const normalized = normalizeIban(text)
  if (/^GE\d{2}[A-Z]{2}\d{16}$/.test(normalized)) found.add(normalized)
  for (const m of text.match(/GE[\dA-Z]{20}/g) ?? []) {
    const iban = normalizeIban(m)
    if (/^GE\d{2}[A-Z]{2}\d{16}$/.test(iban)) found.add(iban)
  }
  return [...found]
}

function buildHrContractsFromRegistry(
  person: RegistryPerson,
  primary: RegistryContract | undefined,
): HrEmploymentContract[] {
  return person.contracts.map((c) => {
    const isPrimary = c === primary
    let status: HrEmploymentContractStatus = isPrimary ? 'active' : 'superseded'
    if (isPrimary && isPendingContractTerm(c.term)) status = 'pending'
    return {
      id: crypto.randomUUID(),
      isPrimary,
      status,
      position: c.position || c.positionKa || '',
      positionKa: c.positionKa || undefined,
      contractNumber: c.contractNumber || undefined,
      effectiveDate: c.hireDate,
      endDate: resolveContractEndDate(c),
      term: c.term || undefined,
      agreementKind: inferContractAgreementKind(c, isPrimary),
      contractType: inferContractType(c.position, c.term),
      salary: c.salary,
      laborRegistry: c.laborRegistry || undefined,
      documentUrl: c.contractLink,
      bonusThirteenth: c.bonusThirteenth || undefined,
    }
  })
}

function resolveContractEndDate(contract: RegistryContract | undefined): string | undefined {
  if (!contract) return undefined
  if (contract.endDate) return contract.endDate
  return parseTextDate(contract.term ?? '') ?? undefined
}

function parseProbationMonths(term: string): number | undefined {
  const t = term.trim().toLowerCase()
  const m = t.match(/(\d+)\s*(?:мес|month|თვ|tve)/i)
  if (m) return Number.parseInt(m[1], 10)
  if (t === '3' || /\b3\b/.test(t)) return 3
  return undefined
}

function inferScheduleFromPosition(position: string, positionKa: string): Employee['schedule'] {
  const p = `${position ?? ''} ${positionKa ?? ''}`.toLowerCase()
  if (
    /менеджер|бухгал|офис|админ|директор|эконом|consult|консульт|инженер|it |систем|hr|кадр|юрист|lawyer|market|маркет|бух|account|офис|secr|секрет|service.?manager|сервис/i.test(
      p,
    )
  ) {
    return '5/2 8ч'
  }
  return '2/2 11ч'
}

function inferContractType(position: string, term: string): HrContractType {
  const p = position.toLowerCase()
  const t = term.toLowerCase()
  if (/ученик|мосწ|стаж|intern|trainee/.test(p)) return 'internship'
  if (/времен|temporary|сроч|3\s*мес|3\s*თვ/.test(t)) return 'temporary'
  if (/частич|part.?time/.test(t)) return 'part_time'
  return 'full_time'
}

function hasTabNumber(tab: unknown): boolean {
  return tab !== '' && tab !== null && tab !== undefined && String(tab).trim() !== ''
}

function isTraineeContract(c: RegistryContract): boolean {
  const p = `${c.position ?? ''} ${c.positionKa ?? ''}`.toLowerCase()
  return /ученик|мосწ|стаж|intern|trainee|მოსწავ/.test(p)
}

function parseContinuationContract(
  ws: SheetView,
  r: number,
  positionKa: string,
  positionRu: string,
): RegistryContract {
  const contractCell = cellVal(ws, r, 5)
  return {
    idNumber: '',
    address: '',
    positionKa,
    position: positionRu.replace(/\n/g, ' ').trim(),
    bankAccount: '',
    phone: '',
    salary: parseSalary(cellVal(ws, r, 4).v),
    contractNumber: String(contractCell.v || '').trim(),
    contractLink: contractCell.link,
    hireDate: excelDate(cellVal(ws, r, 6).v),
    term: String(cellVal(ws, r, 7).v || '').trim(),
    endDate: excelDate(cellVal(ws, r, 8).v),
    bonusThirteenth: String(cellVal(ws, r, 9).v || '').trim(),
    laborRegistry: String(cellVal(ws, r, 10).v || '').trim(),
  }
}

function contractHasPayload(contract: RegistryContract): boolean {
  return !!(
    contract.position ||
    contract.positionKa ||
    contract.contractNumber ||
    contract.idNumber ||
    contract.salary ||
    contract.address ||
    contract.bankAccount ||
    contract.phone ||
    contract.term
  )
}

/** Лист с реестром: «Лист1» / Sheet1 или самый большой по строкам. */
export function pickRegistryWorksheet(wb: WorkbookView): SheetView | null {
  const preferred = wb.sheetNames.find((n) => /^лист1$/i.test(n) || /^sheet1$/i.test(n))
  if (preferred) {
    const sheet = wb.sheet(preferred)
    if (sheet) return sheet
  }

  let best: SheetView | null = null
  let bestRows = 0
  for (const sheet of wb.sheets()) {
    if (sheet.rowCount > bestRows) {
      bestRows = sheet.rowCount
      best = sheet
    }
  }
  return best
}

function cellVal(ws: SheetView, r: number, c: number) {
  const cell = ws.cell(r, c)
  return { v: cell.v ?? '', link: cell.link }
}

/** Разбор листа реестра (строка 0 — заголовки). */
export function parseRegistrySheet(ws: SheetView): RegistryPerson[] {
  if (ws.rowCount <= 1) return []
  const people: RegistryPerson[] = []
  let current: RegistryPerson | null = null

  for (let r = 1; r < ws.rowCount; r++) {
    const tab = cellVal(ws, r, 0).v
    const rawName = String(cellVal(ws, r, 1).v || '').trim()
    const nameKa = String(cellVal(ws, r, 2).v || '').trim()
    const hasTab = hasTabNumber(tab)

    if (hasTab && rawName) {
      if (current) people.push(current)
      const parsedName = parseRegistryPersonName(rawName)
      current = {
        tabNumber: String(tab).trim(),
        fullName: parsedName.fullName,
        nameKa,
        gender: String(cellVal(ws, r, 3).v || '').trim(),
        citizenship: String(cellVal(ws, r, 4).v || '').trim(),
        birthDate: excelDate(cellVal(ws, r, 5).v),
        terminated: parsedName.terminated,
        terminationDate: parsedName.terminationDate,
        ibans: [],
        contracts: [],
      }
    }
    if (!current) continue

    const bankRaw = String(cellVal(ws, r, 10).v || '')
    for (const iban of extractIbans(bankRaw)) {
      if (!current.ibans.includes(iban)) current.ibans.push(iban)
    }

    const idCell = cellVal(ws, r, 6)
    const contractCell = cellVal(ws, r, 13)
    const phoneRaw = String(cellVal(ws, r, 11).v || '').trim()

    let contract: RegistryContract
    if (!hasTab && rawName) {
      contract = parseContinuationContract(ws, r, rawName, nameKa)
    } else {
      contract = {
        idNumber: String(idCell.v || '').trim(),
        idLink: idCell.link,
        address: String(cellVal(ws, r, 7).v || '').trim(),
        positionKa: String(cellVal(ws, r, 8).v || '').trim(),
        position: String(cellVal(ws, r, 9).v || '').replace(/\n/g, ' ').trim(),
        bankAccount: String(cellVal(ws, r, 10).v || '').trim(),
        phone: phoneRaw,
        salary: parseSalary(cellVal(ws, r, 12).v),
        contractNumber: String(contractCell.v || '').trim(),
        contractLink: contractCell.link,
        hireDate: excelDate(cellVal(ws, r, 14).v),
        term: String(cellVal(ws, r, 15).v || '').trim(),
        endDate: excelDate(cellVal(ws, r, 16).v),
        bonusThirteenth: String(cellVal(ws, r, 17).v || '').trim(),
        laborRegistry: String(cellVal(ws, r, 18).v || '').trim(),
      }
    }

    if (contractHasPayload(contract)) {
      current.contracts.push(contract)
    }

    const phoneParsed = parsePhone(phoneRaw)
    if (!current.phone && phoneParsed.phone) current.phone = phoneParsed.phone
    if (!current.email && phoneParsed.email) current.email = phoneParsed.email
    if (!current.address && contract.address) current.address = contract.address
    if (!current.personalId && contract.idNumber) current.personalId = contract.idNumber
    if (!current.idLink && contract.idLink) current.idLink = contract.idLink
  }
  if (current) people.push(current)
  return people
}

function primaryContract(contracts: RegistryContract[]): RegistryContract | undefined {
  if (!contracts.length) return undefined
  if (contracts.length === 1) return contracts[0]

  const score = (c: RegistryContract) => {
    let s = 0
    if (isTraineeContract(c)) s -= 100_000
    if (/3\s*мес|3\s*თვ|3\s*month/i.test(c.term ?? '')) s -= 50_000
    if (c.salary) s += c.salary * 100
    if (c.hireDate) s += Date.parse(c.hireDate) || 0
    if (c.contractNumber) s += 500
    if (`${c.position ?? ''} ${c.positionKa ?? ''}`.trim()) s += 1_000
    return s
  }

  return [...contracts].sort((a, b) => score(b) - score(a))[0]
}

/** Фантомы из старого парсера: «сотрудник» с ФИО = должность из доп. строки реестра. */
export function isMisparseGhostEmployee(
  employee: { fullName: string; nameKa?: string },
  registry: RegistryPerson[],
): boolean {
  const key = normalizeName(employee.fullName)
  if (!key) return false
  if (registry.some((p) => normalizeName(p.fullName) === key || normalizeName(p.nameKa) === key)) {
    return false
  }
  return registry.some((p) =>
    p.contracts.some(
      (c) =>
        normalizeName(c.position) === key ||
        normalizeName(c.positionKa) === key ||
        c.position === employee.fullName ||
        c.positionKa === employee.fullName,
    ),
  )
}

function buildBankAccountsFromRegistry(person: RegistryPerson): HrBankAccount[] {
  const ibans = new Set<string>()
  for (const iban of person.ibans) ibans.add(iban)
  for (const c of person.contracts) {
    for (const iban of extractIbans(c.bankAccount)) ibans.add(iban)
  }

  const list = [...ibans]
  return list.map((iban, index) => {
    const bank = detectBankFromIban(iban)
    return {
      id: crypto.randomUUID(),
      iban,
      bankCode: bank?.code,
      holderName: person.fullName,
      currency: 'GEL' as const,
      isPrimary: index === 0,
    }
  })
}

function buildRegistryDocuments(person: RegistryPerson, existing: HrDocument[] = []): HrDocument[] {
  const now = new Date().toISOString()
  const kept = existing.filter((d) => d.uploadedBy !== 'registry-import')
  const byKey = new Map<string, HrDocument>()
  for (const d of kept) {
    const k = d.fileUrl ? `${d.fileUrl}|${d.title}` : d.id
    byKey.set(k, d)
  }

  const add = (
    title: string,
    docType: string,
    url: string | undefined,
    fileName: string | undefined,
    expiresAt: string | undefined,
    dedupeKey: string,
  ) => {
    if (!url || url === 'about:blank' || byKey.has(dedupeKey)) return
    byKey.set(dedupeKey, {
      id: crypto.randomUUID(),
      title,
      docType,
      uploadedAt: now,
      uploadedBy: 'registry-import',
      fileUrl: url,
      fileName: fileName || title,
      expiresAt,
    })
  }

  if (person.idLink) {
    add(
      'Удостоверение личности / ID',
      'id',
      person.idLink,
      person.personalId || 'ID',
      undefined,
      `id:${person.idLink}`,
    )
  }

  for (const c of person.contracts) {
    const end = resolveContractEndDate(c)
    if (c.idLink && c.idLink !== person.idLink) {
      add(
        `ID ${c.idNumber || person.fullName}`,
        'id',
        c.idLink,
        c.idNumber,
        undefined,
        `id:${c.idLink}|${c.idNumber}`,
      )
    }
    if (c.contractLink) {
      const bits = [c.position, c.contractNumber && `№ ${c.contractNumber}`].filter(Boolean)
      const title = bits.length ? `Трудовой договор — ${bits.join(' · ')}` : 'Трудовой договор'
      add(
        title,
        'contract',
        c.contractLink,
        c.contractNumber || c.position || 'contract',
        end,
        `contract:${c.contractLink}|${c.contractNumber}|${c.position}|${c.hireDate ?? ''}`,
      )
    }
  }

  return [...byKey.values()]
}

function buildHrNotes(person: RegistryPerson, primary: RegistryContract | undefined): string {
  const lines: string[] = []
  const laborRegs = [
    ...new Set(person.contracts.map((c) => c.laborRegistry).filter(Boolean)),
  ]
  for (const reg of laborRegs) lines.push(`Реестр труда: ${reg}`)

  if (primary?.bonusThirteenth) {
    lines.push(`13-я зарплата (даты): ${primary.bonusThirteenth}`)
  }

  return lines.join('\n')
}

function findExistingEmployee(employees: Employee[], person: RegistryPerson): Employee | undefined {
  if (person.tabNumber) {
    const byTab = employees.find((e) => e.tabNumber.trim() === person.tabNumber.trim())
    if (byTab) return byTab
  }
  return findExistingEmployeeByName(employees, person)
}

/** Ключ человека в реестре для выбора «создавать / нет». */
export function registryPersonKey(person: RegistryPerson): string {
  const ru = normalizeName(person.fullName)
  if (ru) return ru
  const ka = normalizeName(person.nameKa)
  return ka || `row:${person.tabNumber || person.fullName}`
}

export function findExistingEmployeeByName(
  employees: Employee[],
  person: RegistryPerson,
): Employee | undefined {
  const norm = normalizeName(person.fullName)
  if (norm) {
    const byName = employees.find((e) => normalizeName(e.fullName) === norm)
    if (byName) return byName
  }
  if (person.nameKa?.trim()) {
    const normKa = normalizeName(person.nameKa)
    const byKa = employees.find((e) => e.nameKa && normalizeName(e.nameKa) === normKa)
    if (byKa) return byKa
  }
  return undefined
}

/** Кого обновить, кого нет в базе, кого в базе нет в реестре. */
export function analyzeRegistryImport(
  existing: Employee[],
  registry: RegistryPerson[],
): RegistryImportAnalysis {
  const matched: RegistryImportAnalysis['matched'] = []
  const missingInDb: RegistryPerson[] = []
  const matchedEmployeeIds = new Set<string>()

  for (const person of registry) {
    const employee = findExistingEmployeeByName(existing, person)
    if (employee) {
      matched.push({ person, employee })
      matchedEmployeeIds.add(employee.id)
    } else {
      missingInDb.push(person)
    }
  }

  const notInRegistry = existing.filter((e) => !matchedEmployeeIds.has(e.id))
  return { matched, missingInDb, notInRegistry }
}

function resolveExistingEmployee(
  employees: Employee[],
  person: RegistryPerson,
  matchByName?: boolean,
): Employee | undefined {
  if (matchByName) return findExistingEmployeeByName(employees, person)
  return findExistingEmployee(employees, person)
}

function applyRegistryToEmployee(base: Employee, person: RegistryPerson): Employee {
  const primary = primaryContract(person.contracts)
  const phoneParsed = parsePhone(person.phone || primary?.phone || '')
  const email = person.email || phoneParsed.email || base.email
  const position = primary?.position || base.position
  const positionKa = primary?.positionKa || base.positionKa
  const salary = primary?.salary
  const address = person.address || primary?.address || base.address
  const term = primary?.term ?? ''
  const hrContracts = buildHrContractsFromRegistry(person, primary)
  const primaryAgreement =
    hrContracts.find((c) => c.isPrimary)?.agreementKind ?? 'permanent'
  const contractType = inferContractType(position, term)
  const contractEndDate = resolveContractEndDate(primary)
  const schedule = inferScheduleFromPosition(position, positionKa ?? '')
  const gender = mapGender(person.gender) ?? base.gender
  const bankAccounts = buildBankAccountsFromRegistry(person)
  const hrNotes = buildHrNotes(person, primary)
  const surnameKa = person.nameKa.split(/\s+/)[0]?.trim()

  let next: Employee = {
    ...base,
    fullName: person.fullName,
    nameKa: person.nameKa || base.nameKa,
    surnameKa: surnameKa || base.surnameKa,
    tabNumber: person.tabNumber || base.tabNumber,
    position,
    positionKa,
    schedule: schedule || base.schedule || '2/2 11ч',
    cycleStart: primary?.hireDate || base.cycleStart,
    phone: phoneParsed.phone || base.phone,
    email,
    address,
    registrationAddress: address || base.registrationAddress,
    actualAddress: address || base.actualAddress,
    birthDate: person.birthDate || base.birthDate,
    citizenship: mapCitizenship(person.citizenship) || base.citizenship,
    personalId: person.personalId || primary?.idNumber || base.personalId,
    hireDate: primary?.hireDate || base.hireDate,
    monthlySalary: salary ?? base.monthlySalary,
    currency: 'GEL',
    gender,
    contractType: contractType || base.contractType,
    employmentAgreementKind: primaryAgreement ?? base.employmentAgreementKind,
    probationMonths:
      contractType === 'internship'
        ? (parseProbationMonths(term) ?? base.probationMonths ?? 3)
        : base.probationMonths,
    statusUntil: contractEndDate || base.statusUntil,
    bankAccounts,
    hrContracts,
    hrDocuments: buildRegistryDocuments(person, base.hrDocuments),
    hrAbsences: base.hrAbsences ?? [],
    hrTrainings: base.hrTrainings ?? [],
    hrNotes: hrNotes || base.hrNotes,
    note: base.note,
  }

  if (person.terminated) {
    next = applyHrStatus(next, 'fired')
    next.terminationDate = person.terminationDate || primary?.endDate || next.terminationDate
    next.active = false
  } else {
    next = applyHrStatus(next, base.hrStatus === 'fired' ? 'active' : (base.hrStatus ?? 'active'))
  }

  return next
}

/** Слияние реестра с существующими сотрудниками (ID и табель сохраняются при совпадении ФИО/Таб). */
export function mergeEmployeesFromRegistry(
  existing: Employee[],
  registry: RegistryPerson[],
  brigades: string[],
  options?: RegistryImportOptions,
): RegistryImportResult {
  const baseExisting = options?.replaceExisting ? [] : existing
  const matchedIds = new Set<string>()
  const result: Employee[] = [...baseExisting]
  let matched = 0
  let created = 0
  let updated = 0
  let skipped = 0

  for (const person of registry) {
    const found = resolveExistingEmployee(result, person, options?.matchByName)
    if (found) {
      matchedIds.add(found.id)
      const next = applyRegistryToEmployee(found, person)
      const idx = result.findIndex((e) => e.id === found.id)
      result[idx] = next
      matched++
      updated++
    } else {
      if (options?.createMissingKeys !== undefined) {
        const key = registryPersonKey(person)
        if (!options.createMissingKeys.has(key)) {
          skipped++
          continue
        }
      }
      const blank = createNewEmployee(brigades, result)
      const next = applyRegistryToEmployee(
        {
          ...blank,
          tabNumber: person.tabNumber || suggestNextTabNumber(result),
          brigade: blank.brigade || brigades[0] || '',
        },
        person,
      )
      result.push(next)
      created++
    }
  }

  const notInRegistry = baseExisting.filter((e) => !matchedIds.has(e.id)).length

  return {
    employees: result,
    stats: {
      matched,
      created,
      updated,
      notInRegistry,
      totalInRegistry: registry.length,
      skipped,
    },
  }
}

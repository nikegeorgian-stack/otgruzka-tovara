import type { WorkSheet } from 'xlsx'
import { detectBankFromIban, normalizeIban } from './banks'
import { createNewEmployee } from './newEmployee'
import { applyHrStatus } from './sync'
import { suggestNextTabNumber } from './tabNumber'
import type {
  EmployeeGender,
  EmploymentAgreementKind,
  HrBankAccount,
  HrContractType,
  HrDocument,
} from './types'
import type { Employee } from '@/lib/types'

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
}

export type RegistryImportResult = {
  employees: Employee[]
  stats: RegistryImportStats
}

export type RegistryImportOptions = {
  /** Не сливать с текущей базой — только строки реестра */
  replaceExisting?: boolean
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

function inferAgreementKind(term: string): EmploymentAgreementKind | undefined {
  const t = term.trim().toLowerCase()
  if (!t) return undefined
  if (/ხელ|бесср|основн|ძირითად|permanent|без\s*срок/i.test(t)) return 'permanent'
  if (/წელი|год|month|мес|времен|сроч|term|\d+\s*(г|м|წ)/i.test(t)) return 'fixed_term'
  if (t === '3') return 'permanent'
  return undefined
}

function inferContractType(position: string, term: string): HrContractType {
  const p = position.toLowerCase()
  const t = term.toLowerCase()
  if (/ученик|мосწ|стаж|intern|trainee/.test(p)) return 'internship'
  if (/времен|temporary|сроч|3\s*мес|3\s*თვ/.test(t)) return 'temporary'
  if (/частич|part.?time/.test(t)) return 'part_time'
  return 'full_time'
}

function cellVal(ws: WorkSheet, r: number, c: number, XLSX: typeof import('xlsx')) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return { v: '', link: undefined as string | undefined }
  const link = (cell as { l?: { Target?: string } }).l?.Target
  return { v: cell.v, link }
}

/** Разбор листа реестра (строка 0 — заголовки). */
export function parseRegistrySheet(ws: WorkSheet, XLSX: typeof import('xlsx')): RegistryPerson[] {
  const ref = ws['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const people: RegistryPerson[] = []
  let current: RegistryPerson | null = null

  for (let r = 1; r <= range.e.r; r++) {
    const tab = cellVal(ws, r, 0, XLSX).v
    const rawName = String(cellVal(ws, r, 1, XLSX).v || '').trim()
    const nameKa = String(cellVal(ws, r, 2, XLSX).v || '').trim()

    if (rawName) {
      if (current) people.push(current)
      const parsedName = parseRegistryPersonName(rawName)
      current = {
        tabNumber: tab !== '' && tab !== null && tab !== undefined ? String(tab).trim() : '',
        fullName: parsedName.fullName,
        nameKa,
        gender: String(cellVal(ws, r, 3, XLSX).v || '').trim(),
        citizenship: String(cellVal(ws, r, 4, XLSX).v || '').trim(),
        birthDate: excelDate(cellVal(ws, r, 5, XLSX).v),
        terminated: parsedName.terminated,
        terminationDate: parsedName.terminationDate,
        ibans: [],
        contracts: [],
      }
    }
    if (!current) continue

    const bankRaw = String(cellVal(ws, r, 10, XLSX).v || '')
    for (const iban of extractIbans(bankRaw)) {
      if (!current.ibans.includes(iban)) current.ibans.push(iban)
    }

    const idCell = cellVal(ws, r, 6, XLSX)
    const contractCell = cellVal(ws, r, 13, XLSX)
    const phoneRaw = String(cellVal(ws, r, 11, XLSX).v || '').trim()

    const contract: RegistryContract = {
      idNumber: String(idCell.v || '').trim(),
      idLink: idCell.link,
      address: String(cellVal(ws, r, 7, XLSX).v || '').trim(),
      positionKa: String(cellVal(ws, r, 8, XLSX).v || '').trim(),
      position: String(cellVal(ws, r, 9, XLSX).v || '').replace(/\n/g, ' ').trim(),
      bankAccount: String(cellVal(ws, r, 10, XLSX).v || '').trim(),
      phone: phoneRaw,
      salary: parseSalary(cellVal(ws, r, 12, XLSX).v),
      contractNumber: String(contractCell.v || '').trim(),
      contractLink: contractCell.link,
      hireDate: excelDate(cellVal(ws, r, 14, XLSX).v),
      term: String(cellVal(ws, r, 15, XLSX).v || '').trim(),
      endDate: excelDate(cellVal(ws, r, 16, XLSX).v),
      bonusThirteenth: String(cellVal(ws, r, 17, XLSX).v || '').trim(),
      laborRegistry: String(cellVal(ws, r, 18, XLSX).v || '').trim(),
    }

    if (
      contract.position ||
      contract.contractNumber ||
      contract.idNumber ||
      contract.salary ||
      contract.address ||
      contract.bankAccount ||
      contract.phone
    ) {
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
  const sorted = [...contracts].sort((a, b) => (b.hireDate ?? '').localeCompare(a.hireDate ?? ''))
  return sorted[0]
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
  const byUrl = new Map<string, HrDocument>()
  for (const d of existing) {
    if (d.fileUrl) byUrl.set(d.fileUrl, d)
  }

  const add = (
    title: string,
    docType: string,
    url: string | undefined,
    fileName?: string,
    expiresAt?: string,
  ) => {
    if (!url || url === 'about:blank' || byUrl.has(url)) return
    byUrl.set(url, {
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
    add('Удостоверение личности / ID', 'id', person.idLink, person.personalId || 'ID')
  }

  for (const c of person.contracts) {
    if (c.idLink && c.idLink !== person.idLink) {
      add(`ID ${c.idNumber || person.fullName}`, 'id', c.idLink, c.idNumber)
    }
    if (c.contractLink) {
      const title = c.contractNumber
        ? `Трудовой договор № ${c.contractNumber}`
        : 'Трудовой договор'
      add(title, 'contract', c.contractLink, c.contractNumber || 'contract', c.endDate)
    }
  }

  for (const d of existing) {
    if (!d.fileUrl && !byUrl.has(d.id)) byUrl.set(d.id, d)
  }

  return [...byUrl.values()]
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

  const others = person.contracts.filter((c) => c !== primary)
  for (const c of others) {
    const bits = [
      c.position,
      c.contractNumber && `№ ${c.contractNumber}`,
      c.hireDate && `с ${c.hireDate}`,
      c.endDate && `до ${c.endDate}`,
      c.term && `срок: ${c.term}`,
      c.laborRegistry && `реестр: ${c.laborRegistry}`,
    ].filter(Boolean)
    if (bits.length) lines.push(`Доп. договор: ${bits.join(' · ')}`)
  }
  return lines.join('\n')
}

function findExistingEmployee(employees: Employee[], person: RegistryPerson): Employee | undefined {
  if (person.tabNumber) {
    const byTab = employees.find((e) => e.tabNumber.trim() === person.tabNumber.trim())
    if (byTab) return byTab
  }
  const norm = normalizeName(person.fullName)
  return employees.find((e) => normalizeName(e.fullName) === norm)
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
  const agreementKind = inferAgreementKind(term)
  const contractType = inferContractType(position, term)
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
    employmentAgreementKind: agreementKind ?? base.employmentAgreementKind,
    bankAccounts,
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

  for (const person of registry) {
    const found = findExistingEmployee(result, person)
    if (found) {
      matchedIds.add(found.id)
      const next = applyRegistryToEmployee(found, person)
      const idx = result.findIndex((e) => e.id === found.id)
      result[idx] = next
      matched++
      updated++
    } else {
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
    },
  }
}

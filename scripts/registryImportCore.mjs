import crypto from 'node:crypto'

// --- banks.ts (minimal) ---

const GEORGIAN_BANKS = [
  { code: 'BG', bic: 'BAGAGE22', nameRu: 'Банк Грузии', nameKa: 'საქართველოს ბანკი' },
  { code: 'TB', bic: 'TBCBGE22', nameRu: 'ТиБиСи Банк', nameKa: 'თიბისი ბანკი' },
  { code: 'LB', bic: 'LBRTGE22', nameRu: 'Либерти Банк', nameKa: 'ლიბერთი ბანკი' },
  { code: 'CD', bic: 'JSCRGE22', nameRu: 'Кредо Банк', nameKa: 'კრედო ბანკი' },
  { code: 'PC', bic: 'MIBGGE22', nameRu: 'ПроКредит Банк', nameKa: 'პროკრედიტ ბანკი' },
  { code: 'BS', bic: 'CBASGE22', nameRu: 'Базисбанк', nameKa: 'ბაზისბანკი' },
  { code: 'CR', bic: 'CRTUGE22', nameRu: 'Банк Карту', nameKa: 'ბანკი ქართუ' },
  { code: 'KS', bic: 'TEBAGE22', nameRu: 'Терабанк', nameKa: 'ტერაბანკი' },
  { code: 'HB', bic: 'HABGGE22', nameRu: 'Халик Банк Грузия', nameKa: 'ხალიკ ბანკი საქართველო' },
  { code: 'BT', bic: 'DISNGE22', nameRu: 'Силк Банк', nameKa: 'სილქ ბანკი' },
  { code: 'VT', bic: 'UGEBGE22', nameRu: 'ВТБ Банк Джорджия', nameKa: 'ვითიბი ბანკი ჯორჯია' },
  { code: 'ZB', bic: 'TCZBGE22', nameRu: 'Зираат Банк Грузия', nameKa: 'ზირაათ ბანკი საქართველო' },
  { code: 'PB', bic: 'PAHAGE22', nameRu: 'ПАША Банк Грузия', nameKa: 'პაშა ბანკი საქართველო' },
  { code: 'IS', bic: 'ISBKGE22', nameRu: 'Ишбанк Грузия', nameKa: 'იშბანკი საქართველო' },
  { code: 'PS', bic: 'PSRAGE22', nameRu: 'Пейсера Банк Грузия', nameKa: 'პეისერა ბანკი' },
  { code: 'HS', bic: 'HAJSGE22', nameRu: 'Хеш Банк', nameKa: 'ჰეშ ბანკი' },
  { code: 'PV', bic: 'PAVEGE22', nameRu: 'Пейв Банк Джорджия', nameKa: 'პეივ ბანკ ჯორჯია' },
  { code: 'MB', bic: 'MOMBGE22', nameRu: 'Микробанк ЭмБиСи', nameKa: 'მიკრობანკი ემბისი' },
  { code: 'BC', bic: 'BCRYGE22', nameRu: 'Микробанк Кристал', nameKa: 'მიკრობანკი კრისტალი' },
  { code: 'TR', bic: 'TRESGE22', nameRu: 'Казначейство (Минфин)', nameKa: 'სახაზინო სამსახური' },
  { code: 'NB', bic: 'BNLNGE22', nameRu: 'Национальный банк Грузии', nameKa: 'საქართველოს ეროვნული ბანკი' },
]

const BANK_BY_CODE = new Map(GEORGIAN_BANKS.map((b) => [b.code, b]))

function normalizeIban(raw) {
  return raw.replace(/\s+/g, '').toUpperCase()
}

function detectBankFromIban(raw) {
  const iban = normalizeIban(raw)
  if (!iban.startsWith('GE') || iban.length < 6) return null
  const code = iban.slice(4, 6)
  return BANK_BY_CODE.get(code) ?? null
}

// --- sync.ts (minimal) ---

function hrStatusToEmployment(status) {
  if (status === 'vacation') return 'vacation'
  if (status === 'sick') return 'maternity'
  if (status === 'fired') return 'terminated'
  return 'active'
}

function applyHrStatus(emp, hrStatus) {
  return {
    ...emp,
    hrStatus,
    active: hrStatus !== 'fired',
    employmentStatus: hrStatusToEmployment(hrStatus),
  }
}

// --- tabNumber.ts (minimal) ---

function parseTabNumber(value) {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

function suggestNextTabNumber(employees) {
  let max = 0
  for (const e of employees) {
    const n = parseTabNumber(e.tabNumber)
    if (n !== null && n > max) max = n
  }
  return String(max + 1)
}

// --- newEmployee.ts (minimal) ---

function createNewEmployee(brigades, employees, options) {
  const today = new Date().toISOString().slice(0, 10)
  const brigade = options?.brigade ?? brigades[0] ?? ''
  return applyHrStatus(
    {
      id: crypto.randomUUID(),
      fullName: '',
      tabNumber: suggestNextTabNumber(employees),
      position: '',
      brigade,
      schedule: '2/2 11ч',
      group2x2: 'А',
      cycleStart: today,
      active: true,
      hireDate: today,
      hrDocuments: [],
      hrAbsences: [],
      hrTrainings: [],
      department: brigade,
      line: brigade,
      currency: 'GEL',
      contractType: 'full_time',
      shiftMode: 'day',
      employmentStatus: 'active',
    },
    'active',
  )
}

// --- registryImport.ts ---

const MONTHS_RU = {
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

function normalizeName(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ё/g, 'е')
}

function excelDate(v) {
  if (v === null || v === undefined || v === '') return undefined
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  if (typeof v !== 'number') return undefined
  const epoch = Math.round((v - 25569) * 86400 * 1000)
  const d = new Date(epoch)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

function parseSalary(raw) {
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

function mapCitizenship(raw) {
  const key = raw.trim().toUpperCase().replace(/\s/g, '')
  if (key.startsWith('GEO') || key === 'GE') return 'GE'
  if (key.startsWith('AZR') || key === 'AZ') return 'AZ'
  if (key.startsWith('UKR') || key === 'UA') return 'UA'
  if (key.startsWith('ARM') || key === 'AM') return 'AM'
  if (key.startsWith('RU')) return 'RU'
  return 'OTHER'
}

function mapGender(raw) {
  const key = raw.trim().toLowerCase()
  if (!key) return undefined
  if (/^(м|male|m\b|კაც|♂)/.test(key)) return 'male'
  if (/^(ж|female|f\b|ქალი|ქ\b|♀)/.test(key)) return 'female'
  return 'unknown'
}

function parseTextDate(raw) {
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

function parseRegistryPersonName(raw) {
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const mainLine = lines[0]?.replace(/\s+/g, ' ').trim() ?? ''
  const tail = lines.slice(1).join(' ') + (lines.length <= 1 ? '' : '')
  const combined = lines.join(' ')
  const fired = /увол|увольн|შეწყვეტ|terminated|dismissed/i.test(combined)
  let terminationDate
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

function parsePhone(raw) {
  const parts = raw.split(/\n|,/).map((p) => p.trim()).filter(Boolean)
  let phone = ''
  let email
  for (const p of parts) {
    if (p.includes('@')) email = p
    else if (!phone) phone = p.replace(/\s+/g, ' ').trim()
  }
  if (!phone && parts[0] && !parts[0].includes('@')) phone = parts[0]
  return { phone, email }
}

function extractIbans(raw) {
  const text = String(raw ?? '').toUpperCase()
  if (!text.trim()) return []
  const found = new Set()
  const normalized = normalizeIban(text)
  if (/^GE\d{2}[A-Z]{2}\d{16}$/.test(normalized)) found.add(normalized)
  for (const m of text.match(/GE[\dA-Z]{20}/g) ?? []) {
    const iban = normalizeIban(m)
    if (/^GE\d{2}[A-Z]{2}\d{16}$/.test(iban)) found.add(iban)
  }
  return [...found]
}

function isPendingContractTerm(term) {
  return /гасаформ|оформ|pending|დასაწყ|გასაფორმ/i.test(term ?? '')
}

function inferContractAgreementKind(contract, isPrimary) {
  if (isTraineeContract(contract)) return 'fixed_term'
  if (isPrimary) {
    const t = (contract.term ?? '').trim()
    if (/^3$|^2$|3\s*мес|3\s*თვ|2\s*თვ/i.test(t)) return 'fixed_term'
    return 'permanent'
  }
  if (/1\s*წელი|1\s*год|2\s*თვ|3\s*თვ|3\s*мес/i.test(contract.term ?? '')) return 'fixed_term'
  return 'permanent'
}

function buildHrContractsFromPerson(person, primary) {
  return person.contracts.map((c) => {
    const isPrimary = c === primary
    let status = isPrimary ? 'active' : 'superseded'
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
      contractType: inferContractType(c.position ?? '', c.term ?? ''),
      salary: c.salary,
      laborRegistry: c.laborRegistry || undefined,
      documentUrl: c.contractLink,
      bonusThirteenth: c.bonusThirteenth || undefined,
    }
  })
}

function resolveContractEndDate(contract) {
  if (!contract) return undefined
  if (contract.endDate) return contract.endDate
  return parseTextDate(contract.term ?? '') ?? undefined
}

function parseProbationMonths(term) {
  const t = term.trim().toLowerCase()
  const m = t.match(/(\d+)\s*(?:мес|month|თვ|tve)/i)
  if (m) return Number.parseInt(m[1], 10)
  if (t === '3' || /\b3\b/.test(t)) return 3
  return undefined
}

/** График работы по основной должности (в реестре отдельной колонки нет). */
function inferScheduleFromPosition(position, positionKa) {
  const p = `${position ?? ''} ${positionKa ?? ''}`.toLowerCase()
  if (
    /менеджер|бухгал|офис|админ|директор|эконом|consult|консульт|инженер|it |систем|hr|кадр|юрист|lawyer|market|маркет|бух|account|офис|secr|секрет|service.?manager|сервис/i.test(
      p,
    )
  ) {
    return '5/2 8ч'
  }
  if (/оператор|линия|линии|смен|склад|механик|слесар|технolog|кладов|пропит|ученик|мосწ|trainee|ხაზ|ოპერატ|დაზგ|საწარმ|მესაწყ|შერევ|propit/i.test(p)) {
    return '2/2 11ч'
  }
  return '2/2 11ч'
}

function inferContractType(position, term) {
  const p = position.toLowerCase()
  const t = term.toLowerCase()
  if (/ученик|мосწ|стаж|intern|trainee/.test(p)) return 'internship'
  if (/времен|temporary|сроч|3\s*мес|3\s*თვ/.test(t)) return 'temporary'
  if (/частич|part.?time/.test(t)) return 'part_time'
  return 'full_time'
}

function hasTabNumber(tab) {
  return tab !== '' && tab !== null && tab !== undefined && String(tab).trim() !== ''
}

function isTraineeContract(c) {
  const p = `${c.position ?? ''} ${c.positionKa ?? ''}`.toLowerCase()
  return /ученик|мосწ|стаж|intern|trainee|მოსწავ/.test(p)
}

function parseContinuationContract(ws, r, XLSX, positionKa, positionRu) {
  const contractCell = cellVal(ws, r, 5, XLSX)
  return {
    idNumber: '',
    idLink: undefined,
    address: '',
    positionKa,
    position: positionRu.replace(/\n/g, ' ').trim(),
    bankAccount: '',
    phone: '',
    salary: parseSalary(cellVal(ws, r, 4, XLSX).v),
    contractNumber: String(contractCell.v || '').trim(),
    contractLink: contractCell.link,
    hireDate: excelDate(cellVal(ws, r, 6, XLSX).v),
    term: String(cellVal(ws, r, 7, XLSX).v || '').trim(),
    endDate: excelDate(cellVal(ws, r, 8, XLSX).v),
    bonusThirteenth: String(cellVal(ws, r, 9, XLSX).v || '').trim(),
    laborRegistry: String(cellVal(ws, r, 10, XLSX).v || '').trim(),
  }
}

function contractHasPayload(contract) {
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

/** Лист с реестром: «Лист1» или самый большой по строкам. */
export function pickRegistryWorksheet(wb, XLSX) {
  const preferred = wb.SheetNames.find((n) => /^лист1$/i.test(n) || /^sheet1$/i.test(n))
  if (preferred && wb.Sheets[preferred]) return wb.Sheets[preferred]

  let bestName = null
  let bestRows = 0
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const ref = ws?.['!ref']
    if (!ref) continue
    const rows = XLSX.utils.decode_range(ref).e.r
    if (rows > bestRows) {
      bestRows = rows
      bestName = name
    }
  }
  return bestName ? (wb.Sheets[bestName] ?? null) : null
}

function cellVal(ws, r, c, XLSX) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })]
  if (!cell) return { v: '', link: undefined }
  const link = cell.l?.Target
  return { v: cell.v, link }
}

/** Разбор листа реестра (строка 0 — заголовки). */
export function parseRegistrySheet(ws, XLSX) {
  const ref = ws['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)
  const people = []
  let current = null

  for (let r = 1; r <= range.e.r; r++) {
    const tab = cellVal(ws, r, 0, XLSX).v
    const rawName = String(cellVal(ws, r, 1, XLSX).v || '').trim()
    const nameKa = String(cellVal(ws, r, 2, XLSX).v || '').trim()
    const hasTab = hasTabNumber(tab)

    // Новый сотрудник — только при табельном № в col 0 (строки доп. договоров без tab).
    if (hasTab && rawName) {
      if (current) people.push(current)
      const parsedName = parseRegistryPersonName(rawName)
      current = {
        tabNumber: String(tab).trim(),
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

    let contract
    if (!hasTab && rawName) {
      // Доп. договор: должность в col 1–2, оклад/срок — сдвинуты влево.
      contract = parseContinuationContract(ws, r, XLSX, rawName, nameKa)
    } else {
      contract = {
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

function primaryContract(contracts) {
  if (!contracts.length) return undefined
  if (contracts.length === 1) return contracts[0]

  const score = (c) => {
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
export function isMisparseGhostEmployee(employee, registry) {
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

function buildBankAccountsFromRegistry(person) {
  const ibans = new Set()
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
      currency: 'GEL',
      isPrimary: index === 0,
    }
  })
}

function buildRegistryDocuments(person, existing = []) {
  const now = new Date().toISOString()
  const kept = existing.filter((d) => d.uploadedBy !== 'registry-import')
  const byKey = new Map()
  for (const d of kept) {
    const k = d.fileUrl ? `${d.fileUrl}|${d.title}` : d.id
    byKey.set(k, d)
  }

  const add = (title, docType, url, fileName, expiresAt, dedupeKey) => {
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

function buildHrNotes(person, primary) {
  const lines = []
  const laborRegs = [
    ...new Set(person.contracts.map((c) => c.laborRegistry).filter(Boolean)),
  ]
  for (const reg of laborRegs) lines.push(`Реестр труда: ${reg}`)

  if (primary?.bonusThirteenth) {
    lines.push(`13-я зарплата (даты): ${primary.bonusThirteenth}`)
  }

  return lines.join('\n')
}

function findExistingEmployee(employees, person) {
  if (person.tabNumber) {
    const byTab = employees.find((e) => e.tabNumber.trim() === person.tabNumber.trim())
    if (byTab) return byTab
  }
  return findExistingEmployeeByName(employees, person)
}

export function registryPersonKey(person) {
  const ru = normalizeName(person.fullName)
  if (ru) return ru
  const ka = normalizeName(person.nameKa)
  return ka || `row:${person.tabNumber || person.fullName}`
}

export function findExistingEmployeeByName(employees, person) {
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

export function analyzeRegistryImport(existing, registry) {
  const matched = []
  const missingInDb = []
  const matchedEmployeeIds = new Set()

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

function resolveExistingEmployee(employees, person, matchByName) {
  if (matchByName) return findExistingEmployeeByName(employees, person)
  return findExistingEmployee(employees, person)
}

function applyRegistryToEmployee(base, person) {
  const primary = primaryContract(person.contracts)
  const phoneParsed = parsePhone(person.phone || primary?.phone || '')
  const email = person.email || phoneParsed.email || base.email
  const position = primary?.position || base.position
  const positionKa = primary?.positionKa || base.positionKa
  const salary = primary?.salary
  const address = person.address || primary?.address || base.address
  const term = primary?.term ?? ''
  const hrContracts = buildHrContractsFromPerson(person, primary)
  const primaryAgreement =
    hrContracts.find((c) => c.isPrimary)?.agreementKind ?? 'permanent'
  const contractType = inferContractType(position, term)
  const contractEndDate = resolveContractEndDate(primary)
  const schedule = inferScheduleFromPosition(position, positionKa)
  const gender = mapGender(person.gender) ?? base.gender
  const bankAccounts = buildBankAccountsFromRegistry(person)
  const hrNotes = buildHrNotes(person, primary)
  const surnameKa = person.nameKa.split(/\s+/)[0]?.trim()

  let next = {
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
export function mergeEmployeesFromRegistry(existing, registry, brigades, options) {
  const baseExisting = options?.replaceExisting ? [] : existing
  const matchedIds = new Set()
  const result = [...baseExisting]
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

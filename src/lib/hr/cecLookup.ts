export type CecVoterLookupInput = {
  personalId: string
  surname: string
}

export type CecVoterLookupResult = {
  ok: boolean
  error?: string
  message?: string
  data?: {
    firstName?: string
    lastName?: string
    fullName?: string
    birthDate?: string
    district?: string
    precinct?: string
    registrationAddress?: string
    actualAddress?: string
    pollingStation?: string
  }
}

const CEC_BASES = ['https://ems-voters.cec.gov.ge', 'https://voters.cec.gov.ge']

const CEC_PATHS = [
  '/api/Voter/Search',
  '/api/Voters/Search',
  '/api/voter/search',
  '/api/Elector/Search',
  '/api/Public/SearchVoter',
  '/api/Public/VoterSearch',
  '/Voter/Search',
  '/Home/SearchVoter',
]

function geDateToIso(value: string | undefined): string | undefined {
  if (!value) return undefined
  const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return value.length >= 10 ? value.slice(0, 10) : undefined
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm}-${dd}`
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function unwrapPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const candidates = [
    root,
    root.data as Record<string, unknown>,
    root.Data as Record<string, unknown>,
    root.result as Record<string, unknown>,
    root.Result as Record<string, unknown>,
    root.voter as Record<string, unknown>,
    root.Voter as Record<string, unknown>,
  ].filter(Boolean) as Record<string, unknown>[]

  if (Array.isArray(root.data) && root.data[0]) candidates.unshift(root.data[0] as Record<string, unknown>)
  if (Array.isArray(root.Data) && root.Data[0]) candidates.unshift(root.Data[0] as Record<string, unknown>)

  for (const row of candidates) {
    const address = pickString(row, [
      'address',
      'Address',
      'registrationAddress',
      'RegistrationAddress',
      'legalAddress',
      'LegalAddress',
      'addressOfRegistration',
      'AddressOfRegistration',
    ])
    if (address) return row
    const name = pickString(row, ['surname', 'Surname', 'lastName', 'LastName', 'fullName', 'FullName'])
    if (name) return row
  }

  return candidates[0] ?? null
}

export function parseCecVoterPayload(payload: unknown): CecVoterLookupResult['data'] | null {
  const row = unwrapPayload(payload)
  if (!row) return null

  const registrationAddress = pickString(row, [
    'address',
    'Address',
    'registrationAddress',
    'RegistrationAddress',
    'legalAddress',
    'LegalAddress',
    'addressOfRegistration',
    'AddressOfRegistration',
    'registration_address',
  ])

  const actualAddress = pickString(row, [
    'actualAddress',
    'ActualAddress',
    'factAddress',
    'FactAddress',
    'residenceAddress',
    'ResidenceAddress',
    'temporaryAddress',
    'TemporaryAddress',
    'actual_address',
  ])

  const lastName = pickString(row, ['surname', 'Surname', 'lastName', 'LastName'])
  const firstName = pickString(row, ['firstName', 'FirstName', 'name', 'Name'])
  const fullName =
    pickString(row, ['fullName', 'FullName']) ??
    ([firstName, lastName].filter(Boolean).join(' ').trim() || undefined)

  const birthDate = geDateToIso(
    pickString(row, ['birthDate', 'BirthDate', 'dateOfBirth', 'DateOfBirth', 'birth', 'Birth']),
  )

  const district =
    pickString(row, ['district', 'District', 'districtCode', 'DistrictCode']) ??
    pickString(row, ['precinct', 'Precinct', 'pollingDistrict', 'PollingDistrict'])

  if (!registrationAddress && !actualAddress && !fullName && !lastName) return null

  return {
    firstName,
    lastName,
    fullName,
    birthDate,
    district,
    precinct: pickString(row, ['precinct', 'Precinct', 'pollingStation', 'PollingStation']),
    registrationAddress,
    actualAddress: actualAddress ?? registrationAddress,
    pollingStation: pickString(row, ['pollingStation', 'PollingStation', 'station', 'Station']),
  }
}

function buildBodies(personalId: string, surname: string) {
  const pn = personalId.trim()
  const sn = surname.trim()
  return [
    { personalNumber: pn, surname: sn },
    { PersonalNumber: pn, Surname: sn },
    { personalId: pn, surname: sn },
    { pn, lastName: sn },
    { personal_number: pn, surname: sn },
  ]
}

/** Запрос напрямую с сайта ЦИК из браузера пользователя */
export async function lookupCecVoterInBrowser(
  input: CecVoterLookupInput,
): Promise<CecVoterLookupResult> {
  const personalId = input.personalId.trim()
  const surname = input.surname.trim()
  if (!/^\d{11}$/.test(personalId)) {
    return { ok: false, error: 'invalid_personal_id' }
  }
  if (!surname) {
    return { ok: false, error: 'surname_required' }
  }

  const bodies = buildBodies(personalId, surname)
  let lastError = 'cec_not_found'

  for (const base of CEC_BASES) {
    for (const path of CEC_PATHS) {
      for (const body of bodies) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: JSON.stringify(body),
            mode: 'cors',
          })

          const text = await res.text()
          if (!res.ok) {
            if (res.status === 403 || text.includes('Cloudflare')) {
              lastError = 'cec_cloudflare'
            }
            continue
          }

          let payload: unknown
          try {
            payload = JSON.parse(text)
          } catch {
            continue
          }

          const data = parseCecVoterPayload(payload)
          if (data) return { ok: true, data }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
            lastError = 'cec_cors_or_network'
          }
        }
      }
    }
  }

  return { ok: false, error: lastError }
}

export const CEC_VOTER_PORTAL_URL = 'https://ems-voters.cec.gov.ge/'

/** Локальная страница-переход: подставляет номер и фамилию в URL сайта ЦИК */
export function buildCecVoterPortalUrl(personalId?: string, surname?: string): string {
  const pn = personalId?.trim() ?? ''
  const sn = surname?.trim() ?? ''
  if (!pn && !sn) return CEC_VOTER_PORTAL_URL

  const q = new URLSearchParams()
  if (pn) q.set('pn', pn)
  if (sn) q.set('sn', sn)
  return `/cec-launch.html?${q.toString()}`
}

export function buildCecVoterDirectUrl(personalId?: string, surname?: string): string {
  const pn = personalId?.trim() ?? ''
  const sn = surname?.trim() ?? ''
  if (!pn && !sn) return CEC_VOTER_PORTAL_URL

  const p = new URLSearchParams()
  if (pn) p.set('personalNumber', pn)
  if (sn) p.set('surname', sn)
  return `${CEC_VOTER_PORTAL_URL}?${p.toString()}`
}

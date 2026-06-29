function geDateToIso(value) {
  if (!value) return undefined
  const m = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  if (!m) return String(value).length >= 10 ? String(value).slice(0, 10) : undefined
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm}-${dd}`
}

function pickString(obj, keys) {
  if (!obj) return undefined
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const root = payload
  const candidates = [
    root,
    root.data,
    root.Data,
    root.result,
    root.Result,
    root.voter,
    root.Voter,
  ].filter(Boolean)

  if (Array.isArray(root.data) && root.data[0]) candidates.unshift(root.data[0])
  if (Array.isArray(root.Data) && root.Data[0]) candidates.unshift(root.Data[0])

  for (const row of candidates) {
    const address = pickString(row, [
      'address',
      'Address',
      'registrationAddress',
      'RegistrationAddress',
      'legalAddress',
      'LegalAddress',
    ])
    if (address) return row
    const name = pickString(row, ['surname', 'Surname', 'lastName', 'LastName', 'fullName'])
    if (name) return row
  }

  return candidates[0] ?? null
}

export function parseCecVoterPayload(payload) {
  const row = unwrapPayload(payload)
  if (!row) return null

  const registrationAddress = pickString(row, [
    'address',
    'Address',
    'registrationAddress',
    'RegistrationAddress',
    'legalAddress',
    'LegalAddress',
  ])

  const actualAddress = pickString(row, [
    'actualAddress',
    'ActualAddress',
    'factAddress',
    'FactAddress',
    'residenceAddress',
    'ResidenceAddress',
  ])

  const lastName = pickString(row, ['surname', 'Surname', 'lastName', 'LastName'])
  const firstName = pickString(row, ['firstName', 'FirstName', 'name', 'Name'])
  const fullName =
    pickString(row, ['fullName', 'FullName']) ||
    [firstName, lastName].filter(Boolean).join(' ').trim() ||
    undefined

  const birthDate = geDateToIso(
    pickString(row, ['birthDate', 'BirthDate', 'dateOfBirth', 'DateOfBirth', 'birth']),
  )

  if (!registrationAddress && !actualAddress && !fullName && !lastName) return null

  return {
    firstName,
    lastName,
    fullName,
    birthDate,
    district: pickString(row, ['district', 'District', 'precinct', 'Precinct']),
    registrationAddress,
    actualAddress: actualAddress ?? registrationAddress,
    pollingStation: pickString(row, ['pollingStation', 'PollingStation']),
  }
}

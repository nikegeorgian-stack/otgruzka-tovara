import { parseCecVoterPayload } from './parse.mjs'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CEC_BASES = ['https://ems-voters.cec.gov.ge', 'https://voters.cec.gov.ge']

const CEC_PATHS = [
  '/api/Voter/Search',
  '/api/Voters/Search',
  '/api/voter/search',
  '/api/Elector/Search',
  '/api/Public/SearchVoter',
]

function buildBodies(personalId, surname) {
  const pn = String(personalId).trim()
  const sn = String(surname).trim()
  return [
    { personalNumber: pn, surname: sn },
    { PersonalNumber: pn, Surname: sn },
  ]
}

function parseCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? []
  return raw.map((c) => c.split(';')[0]).join('; ')
}

async function warmSession(base) {
  const res = await fetch(`${base}/`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ka,en;q=0.9',
    },
  })
  const cookies = parseCookies(res)
  await res.text()
  return cookies
}

export async function lookupCecVoterServer({ personalId, surname }) {
  const pn = String(personalId ?? '').trim()
  const sn = String(surname ?? '').trim()

  if (!/^\d{11}$/.test(pn)) {
    return { ok: false, error: 'invalid_personal_id' }
  }
  if (!sn) {
    return { ok: false, error: 'surname_required' }
  }

  let lastError = 'cec_not_found'

  for (const base of CEC_BASES) {
    let cookies = ''
    try {
      cookies = await warmSession(base)
    } catch {
      continue
    }

    for (const path of CEC_PATHS) {
      for (const body of buildBodies(pn, sn)) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Content-Type': 'application/json',
              'User-Agent': UA,
              Origin: base,
              Referer: `${base}/`,
              'X-Requested-With': 'XMLHttpRequest',
              Cookie: cookies,
            },
            body: JSON.stringify(body),
          })

          const text = await res.text()
          if (!res.ok) {
            if (res.status === 403 || text.includes('Cloudflare')) lastError = 'cec_cloudflare'
            continue
          }

          const payload = JSON.parse(text)
          const data = parseCecVoterPayload(payload)
          if (data) return { ok: true, data, source: 'server' }
        } catch {
          /* try next */
        }
      }
    }
  }

  return { ok: false, error: lastError }
}

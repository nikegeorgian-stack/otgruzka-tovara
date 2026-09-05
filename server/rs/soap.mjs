/** Легальный SOAP RS.ge — GetTPInfoPublic (без парсинга сайта / капчи). */

const RS_SOAP_URL =
  process.env.RS_GE_SOAP_URL?.trim() ||
  'https://services.rs.ge/taxservice/taxpayerservice.asmx'

/** Пробный TIN для проверки логина (несуществующий — важна только авторизация). */
export const RS_AUTH_PROBE_TP_CODE = '123456789'

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function tagText(xml, tag) {
  const re = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i')
  const m = xml.match(re)
  if (!m) return ''
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function parseBool(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  return s === 'true' || s === '1'
}

/** Логин: BOM / zero-width / крайние пробелы. */
export function sanitizeRsCredential(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\s+|\s+$/g, '')
}

/**
 * Пароль: не трогаем обычные пробелы (могут быть частью пароля).
 * Только BOM / zero-width / переносы с краёв (часто из буфера).
 */
export function sanitizeRsPassword(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\r\n]+|[\r\n]+$/g, '')
}

/** Варианты логина: как есть + без префикса ERS- (иногда SOAP ждёт только номер). */
export function usernameVariants(username) {
  const user = sanitizeRsCredential(username)
  if (!user) return []
  const out = [user]
  const stripped = user.replace(/^ERS[-_]+/i, '')
  if (stripped && stripped !== user) out.push(stripped)
  return [...new Set(out)]
}

function mapSoapFailure(xml, errorDescription, errorCode) {
  const descLower = errorDescription.toLowerCase()
  const looksAuth =
    errorCode === 1 ||
    errorCode === -2 ||
    /პაროლ|парол|password|მომხმარებელ|пользовател|username|ავტორიზ|auth/i.test(
      errorDescription,
    ) ||
    descLower.includes('incorrect') ||
    descLower.includes('invalid user')

  let error = 'rs_not_found'
  if (looksAuth) error = 'rs_auth'
  else if (errorCode === -4) error = 'rs_access_denied'
  else if (errorCode === -3) error = 'invalid_tp_code'
  else if (errorCode === -1013) error = 'rs_not_found'
  else if (errorCode === -5) error = 'rs_unavailable'
  const detailParts = []
  if (errorDescription) detailParts.push(errorDescription)
  if (Number.isFinite(errorCode)) detailParts.push(`RS code ${errorCode}`)
  return {
    ok: false,
    error,
    detail: detailParts.length ? detailParts.join(' · ') : undefined,
  }
}

async function soapGetTpInfoPublicOnce({ username, password, tpCode }) {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTPInfoPublic xmlns="services.rs.ge">
      <Username>${xmlEscape(username)}</Username>
      <Password>${xmlEscape(password)}</Password>
      <TP_Code>${xmlEscape(tpCode)}</TP_Code>
    </GetTPInfoPublic>
  </soap:Body>
</soap:Envelope>`

  let res
  try {
    res = await fetch(RS_SOAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"services.rs.ge/GetTPInfoPublic"',
      },
      body,
    })
  } catch {
    return { ok: false, error: 'rs_network' }
  }

  const xml = await res.text()
  if (!res.ok) {
    return { ok: false, error: 'rs_http', detail: `HTTP ${res.status}` }
  }

  const responseStatus = parseBool(tagText(xml, 'ResponseStatus'))
  const errorCodeRaw = tagText(xml, 'ErrorCode')
  const errorDescription = tagText(xml, 'ErrorDescription')
  const name = tagText(xml, 'TP_Name')
  const errorCode = Number.parseInt(errorCodeRaw, 10)

  if (responseStatus && name) {
    return {
      ok: true,
      data: {
        tpCode: tagText(xml, 'TP_Code') || tpCode,
        name,
        status: tagText(xml, 'TP_Status'),
        legalForm: tagText(xml, 'TP_LegalForm'),
        address: tagText(xml, 'TP_Address'),
        type: tagText(xml, 'TP_Type'),
        vatStatus: tagText(xml, 'TP_StatusVat'),
      },
      usedUsername: username,
    }
  }

  return mapSoapFailure(xml, errorDescription, errorCode)
}

/**
 * Проверка: логин/пароль принимаются RS.
 * @param {{ username: string, password: string }} input
 */
export async function verifyRsAuth(input) {
  const pass = sanitizeRsPassword(input.password)
  const variants = usernameVariants(input.username)
  if (!variants.length || !pass) {
    return { ok: false, authOk: false, error: 'rs_not_configured' }
  }

  let lastAuthFail = null
  for (const user of variants) {
    const result = await soapGetTpInfoPublicOnce({
      username: user,
      password: pass,
      tpCode: RS_AUTH_PROBE_TP_CODE,
    })
    if (result.ok) {
      return {
        ok: true,
        authOk: true,
        usedUsername: user,
        usernameLen: user.length,
        passwordLen: pass.length,
      }
    }
    if (result.error === 'rs_auth') {
      lastAuthFail = result
      continue
    }
    // Любой другой ответ RS после прохождения auth
    return {
      ok: true,
      authOk: true,
      probeError: result.error,
      detail: result.detail,
      usedUsername: user,
      usernameLen: user.length,
      passwordLen: pass.length,
    }
  }

  return {
    ok: false,
    authOk: false,
    error: lastAuthFail?.error || 'rs_auth',
    detail: lastAuthFail?.detail,
    usernameLen: variants[0].length,
    passwordLen: pass.length,
    triedUsernames: variants.map((u) =>
      u.length <= 4 ? '••' : `${u.slice(0, 2)}•••${u.slice(-2)}`,
    ),
  }
}

/**
 * @param {{ username: string, password: string, tpCode: string }} input
 */
export async function getTpInfoPublic({ username, password, tpCode }) {
  const pass = sanitizeRsPassword(password)
  const code = sanitizeRsCredential(tpCode)
  const variants = usernameVariants(username)
  if (!variants.length || !pass) return { ok: false, error: 'rs_not_configured' }
  if (!/^\d{9,11}$/.test(code)) return { ok: false, error: 'invalid_tp_code' }

  let lastAuthFail = null
  let lastOther = null
  for (const user of variants) {
    const result = await soapGetTpInfoPublicOnce({
      username: user,
      password: pass,
      tpCode: code,
    })
    if (result.ok) {
      const { usedUsername: _u, ...rest } = result
      return rest
    }
    if (result.error === 'rs_auth') {
      lastAuthFail = result
      continue
    }
    lastOther = result
    break
  }
  return lastOther || lastAuthFail || { ok: false, error: 'rs_not_found' }
}

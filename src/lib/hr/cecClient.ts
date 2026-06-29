import { LOCAL_DB_API } from '@/lib/localDb/config'
import {
  lookupCecVoterInBrowser,
  type CecVoterLookupInput,
  type CecVoterLookupResult,
} from './cecLookup'

/** Сначала запрос из браузера (как на сайте ЦИК), затем через локальный сервер */
export async function lookupCecVoter(
  input: CecVoterLookupInput,
): Promise<CecVoterLookupResult> {
  const browser = await lookupCecVoterInBrowser(input)
  if (browser.ok) return browser

  try {
    const res = await fetch(`${LOCAL_DB_API}/cec/voter-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = (await res.json()) as CecVoterLookupResult
    if (data.ok) return data
    return { ok: false, error: data.error ?? browser.error ?? 'cec_not_found' }
  } catch {
    return { ok: false, error: browser.error ?? 'cec_network' }
  }
}

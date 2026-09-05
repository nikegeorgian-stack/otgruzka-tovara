/**
 * Proxy to National Bank of Georgia public FX rates.
 * Source: https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/
 */

function parseDate(raw) {
  const s = String(raw ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return new Date().toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' })
    return
  }

  const date = parseDate(req.query?.date)
  const lang = req.query?.lang === 'ka' ? 'ka' : 'en'
  const url = `https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/${lang}/json/?date=${encodeURIComponent(date)}`

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!upstream.ok) {
      res.status(502).json({
        ok: false,
        error: 'nbg_upstream',
        status: upstream.status,
      })
      return
    }
    const data = await upstream.json()
    const day = Array.isArray(data) ? data[0] : data
    const currencies = Array.isArray(day?.currencies) ? day.currencies : []
    const rates = {}
    for (const row of currencies) {
      const code = String(row?.code ?? '')
        .trim()
        .toUpperCase()
      const rate = Number(row?.rate)
      const quantity = Number(row?.quantity) || 1
      if (!code || !Number.isFinite(rate) || rate <= 0) continue
      rates[code] = rate / quantity
    }
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({
      ok: true,
      date: String(day?.date ?? date).slice(0, 10),
      rates,
      source: 'nbg.gov.ge',
    })
  } catch (err) {
    console.error('nbg rates failed', err)
    res.status(500).json({ ok: false, error: 'nbg_failed' })
  }
}

const tokenCache = new Map()

export async function getOAuthToken(carrier, config) {
  const cacheKey = `${carrier}:${config.clientId}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(config.clientId ? { 'Consumer-Key': config.clientId } : {}),
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`oauth_${carrier}_failed:${res.status}:${text.slice(0, 200)}`)
  }

  const data = await res.json()
  const token = data.access_token
  const expiresIn = Number(data.expires_in) || 3600
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  return token
}

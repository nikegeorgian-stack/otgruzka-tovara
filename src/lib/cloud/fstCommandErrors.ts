/** Map FST API error codes to operator-visible messages (RU default). */
export function fstCommandErrorMessage(error: string | undefined, fallback: string): string {
  const code = String(error ?? '').trim()
  if (code === 'domain_frozen') {
    return 'Контур временно доступен только для чтения (domain_frozen)'
  }
  if (code === 'cross_origin_api_unsupported') {
    return 'Cross-origin API calls are not supported (use same-origin)'
  }
  return fallback
}

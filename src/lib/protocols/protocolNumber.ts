/** Номер протокола: ПС-YYYY-NNN */

export function allocateProtocolNumber(
  year: number,
  nextSeq: number,
): { number: string; nextNumberSeq: number } {
  const seq = Math.max(1, Math.floor(nextSeq || 1))
  const number = `ПС-${year}-${String(seq).padStart(3, '0')}`
  return { number, nextNumberSeq: seq + 1 }
}

export function protocolYearFromIso(meetingAt: string): number {
  const d = new Date(meetingAt)
  if (Number.isNaN(d.getTime())) return new Date().getFullYear()
  return d.getFullYear()
}

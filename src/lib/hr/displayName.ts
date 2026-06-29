/** Фамилия и имя из полного ФИО (первое слово — фамилия, остальное — имя/отчество). */
export function splitEmployeeName(fullName: string): { surname: string; firstName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { surname: '', firstName: '' }
  if (parts.length === 1) return { surname: parts[0], firstName: '' }
  return { surname: parts[0], firstName: parts.slice(1).join(' ') }
}

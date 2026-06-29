/** Очистка персонала в payload AppStore (Firestore / SQLite). */
export function clearPersonnelPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      employees: 0,
      candidates: 0,
      trashEmployees: 0,
      trashCandidates: 0,
    }
  }

  const stats = {
    employees: Array.isArray(payload.employees) ? payload.employees.length : 0,
    candidates: Array.isArray(payload.candidates) ? payload.candidates.length : 0,
    trashEmployees: Array.isArray(payload.trash?.employees) ? payload.trash.employees.length : 0,
    trashCandidates: Array.isArray(payload.trash?.candidates) ? payload.trash.candidates.length : 0,
  }

  payload.employees = []
  payload.candidates = []
  if (!payload.trash || typeof payload.trash !== 'object') {
    payload.trash = { employees: [], months: [], candidates: [] }
  } else {
    payload.trash.employees = []
    payload.trash.candidates = []
  }

  if (payload.months && typeof payload.months === 'object') {
    for (const sheet of Object.values(payload.months)) {
      if (!sheet || typeof sheet !== 'object') continue
      if (Array.isArray(sheet.rows)) {
        sheet.rows = sheet.rows.map((r) => ({ ...r, employeeId: null }))
      }
      sheet.substitutions = {}
    }
  }

  if (payload.workwear && typeof payload.workwear === 'object') {
    payload.workwear.issuances = []
  }

  return stats
}

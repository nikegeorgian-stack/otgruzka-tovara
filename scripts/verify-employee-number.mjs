/**
 * Smoke: ensureEmployeeNumbers backfill + immutability.
 * Run: node scripts/verify-employee-number.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

// Inline mirror of ensure/suggest (keep in sync with src/lib/hr/employeeNumber.ts)
function parseEmployeeNumber(value) {
  if (!value) return null
  const digits = String(value).replace(/\D/g, '')
  if (!digits) return null
  const n = Number.parseInt(digits, 10)
  return Number.isFinite(n) ? n : null
}

function suggestNextEmployeeNumber(employees) {
  const used = new Set()
  let max = 0
  for (const e of employees) {
    const t = e.employeeNumber?.trim()
    if (!t) continue
    used.add(t)
    const n = parseEmployeeNumber(t)
    if (n !== null && n > max) max = n
  }
  let next = max + 1
  while (used.has(String(next))) next += 1
  return String(next)
}

function ensureEmployeeNumbers(employees) {
  if (employees.length === 0) return employees
  const used = new Set()
  let max = 0
  for (const e of employees) {
    const t = e.employeeNumber?.trim()
    if (!t) continue
    used.add(t)
    const n = parseEmployeeNumber(t)
    if (n !== null && n > max) max = n
  }
  const need = employees
    .filter((e) => !e.employeeNumber?.trim())
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
  if (need.length === 0) return employees
  const assigned = new Map()
  let next = max + 1
  for (const e of need) {
    while (used.has(String(next))) next += 1
    assigned.set(e.id, String(next))
    used.add(String(next))
    next += 1
  }
  return employees.map((e) => {
    const value = assigned.get(e.id)
    return value ? { ...e, employeeNumber: value } : e
  })
}

function lockEmployeeNumber(draft, prev, allEmployees) {
  const prevNum = prev?.employeeNumber?.trim()
  if (prevNum) return { ...draft, employeeNumber: prevNum }
  const own = draft.employeeNumber?.trim()
  if (own) return { ...draft, employeeNumber: own }
  return {
    ...draft,
    employeeNumber: suggestNextEmployeeNumber(allEmployees.filter((e) => e.id !== draft.id)),
  }
}

const list = [
  { id: 'b', fullName: 'B', employeeNumber: undefined },
  { id: 'a', fullName: 'A', employeeNumber: undefined },
  { id: 'c', fullName: 'C', employeeNumber: '5' },
]
const filled = ensureEmployeeNumbers(list)
assert.equal(filled.find((e) => e.id === 'c').employeeNumber, '5')
assert.equal(filled.find((e) => e.id === 'a').employeeNumber, '6') // id a before b
assert.equal(filled.find((e) => e.id === 'b').employeeNumber, '7')

const again = ensureEmployeeNumbers(filled)
assert.deepEqual(
  again.map((e) => e.employeeNumber),
  filled.map((e) => e.employeeNumber),
)

const locked = lockEmployeeNumber(
  { id: 'c', employeeNumber: '999' },
  { id: 'c', employeeNumber: '5' },
  filled,
)
assert.equal(locked.employeeNumber, '5')

assert.equal(suggestNextEmployeeNumber(filled), '8')
console.log('ok: employeeNumber ensure + lock')

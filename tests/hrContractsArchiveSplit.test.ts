import { describe, expect, it } from 'vitest'
import {
  collectDocumentMonitorRows,
  employeesMissingPrimaryContract,
} from '@/lib/hr/documentMonitor'
import { computeHrKpis } from '@/lib/hr/stats'
import type { Employee } from '@/lib/types'

function emp(partial: Partial<Employee> & { id: string; fullName: string }): Employee {
  return {
    active: true,
    hrStatus: 'active',
    brigade: 'B1',
    schedule: '5/2',
    ...partial,
  } as Employee
}

describe('HR contracts vs archive documents', () => {
  it('monitor ignores archive «Трудовой договор» copies; uses hrContracts', () => {
    const employees = [
      emp({
        id: 'e1',
        fullName: 'A',
        hrDocuments: [
          {
            id: 'd1',
            title: 'Скан договора',
            docType: 'Трудовой договор',
            uploadedAt: '2026-01-01',
            uploadedBy: 'x',
            expiresAt: '2020-01-01',
          },
          {
            id: 'd2',
            title: 'Паспорт',
            docType: 'Паспорт',
            uploadedAt: '2026-01-01',
            uploadedBy: 'x',
            expiresAt: '2020-06-01',
          },
        ],
        hrContracts: [
          {
            id: 'c1',
            isPrimary: true,
            status: 'active',
            position: 'Рабочий',
            contractNumber: '12',
            effectiveDate: '2025-01-01',
            endDate: '2020-02-01',
          },
        ],
      }),
    ]
    const rows = collectDocumentMonitorRows(employees, { onlyProblems: true })
    expect(rows.some((r) => r.source === 'document' && r.docType === 'Трудовой договор')).toBe(
      false,
    )
    expect(rows.some((r) => r.source === 'contract')).toBe(true)
    expect(rows.some((r) => r.source === 'document' && r.docType === 'Паспорт')).toBe(true)
  })

  it('KPI missingPrimaryContracts counts employees without active primary', () => {
    const employees = [
      emp({ id: 'e1', fullName: 'No contract' }),
      emp({
        id: 'e2',
        fullName: 'Has',
        hrContracts: [
          {
            id: 'c1',
            isPrimary: true,
            status: 'active',
            position: 'X',
            effectiveDate: '2025-01-01',
          },
        ],
      }),
      emp({
        id: 'e3',
        fullName: 'Pending',
        hrContracts: [
          {
            id: 'c2',
            isPrimary: true,
            status: 'pending',
            position: 'Y',
            effectiveDate: '2026-01-01',
          },
        ],
      }),
    ]
    const kpis = computeHrKpis(employees)
    expect(kpis.missingPrimaryContracts).toBe(2)
    expect(employeesMissingPrimaryContract(employees).map((e) => e.employeeId).sort()).toEqual([
      'e1',
      'e3',
    ])
  })
})

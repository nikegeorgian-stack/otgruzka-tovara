import type { Employee } from '@/lib/types'
import type { StatementRow } from './calc'
import type { PayrollSnapshotRow } from './types'

/** Store only fields used by payroll documents, never PINs, biometrics or HR files. */
export function payrollEmployeeSnapshot(emp: Employee): Employee {
  const keys: (keyof Employee)[] = [
    'id',
    'fullName',
    'tabNumber',
    'employeeNumber',
    'position',
    'positionKa',
    'brigade',
    'schedule',
    'shiftHours',
    'group2x2',
    'cycleStart',
    'active',
    'shiftMode',
    'monthlySalary',
    'hourlyRate',
    'staffRate',
    'monthlyBonus',
    'individualBonus',
    'bonusPercentFromSalary',
    'monthPremiums',
    'nameKa',
    'nameEn',
    'surnameKa',
    'personalId',
    'currency',
    'pensionScheme',
    'mealAllowanceGel',
    'bankAccounts',
    'individualSalary',
    'registrationAddress',
    'actualAddress',
    'address',
    'hireDate',
    'terminationDate',
    'employmentStatus',
    'department',
  ]
  return JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((key) => [key, emp[key]]))),
  ) as Employee
}

/** Missing historic details stay explicitly unavailable, never recalculated with today's rates. */
export function frozenStatementRow(snap: PayrollSnapshotRow, employee?: Employee): StatementRow {
  if (snap.statement) {
    return {
      ...structuredClone(snap.statement),
      paid: 0,
      remaining: snap.statement.net,
      frozen: true,
    }
  }
  const emp = employee
    ? payrollEmployeeSnapshot(employee)
    : ({
        id: snap.employeeId,
        fullName: snap.employeeId,
        tabNumber: '',
        position: '',
        brigade: '',
        schedule: '5/2 8ч',
        group2x2: '',
        cycleStart: '',
        active: false,
      } as Employee)
  return {
    rowId: snap.rowId ?? snap.employeeId,
    employeeId: snap.employeeId,
    emp,
    brigade: emp.brigade,
    schedule: emp.schedule,
    rateLabel: '',
    accrued: snap.accrued,
    bonus: snap.bonus,
    brigadierBonus: snap.brigadierBonus ?? 0,
    autoBonus: 0,
    productivityBonus: 0,
    otherManualBonus: snap.bonus,
    penalty: snap.penalty,
    advance: snap.advance,
    mealDeduction:
      snap.accrued +
      snap.bonus +
      (snap.brigadierBonus ?? 0) -
      snap.penalty -
      snap.advance -
      snap.net,
    net: snap.net,
    factHours: snap.factHours,
    paid: 0,
    remaining: snap.net,
    frozen: true,
    sickDates: [],
    vacationDates: [],
    sickConfirmed: false,
    vacationConfirmed: false,
    breakdown: {
      base: 0,
      night: 0,
      overtime: 0,
      ot110: 0,
      ot115: 0,
      ot120: 0,
      idle: 0,
      vacation: 0,
      sick: 0,
      nightLineBonus: 0,
    },
    hourDetail: {
      unavailable: true,
      planHours: 0,
      factHours: snap.factHours,
      workFactHours: 0,
      baseHours: 0,
      overtimeHours: 0,
      monthDeltaOtHours: 0,
      otDayHours: 0,
      otNightHours: 0,
      nightShiftHours: 0,
      idleHours: 0,
      hourlyRate: 0,
      nightMultiplier: 0,
      idleMultiplier: 0,
      otDayMultiplier: 0,
      otNightMultiplier: 0,
      nightLineNights: 0,
      nightLineFixedGel: 0,
      nightLineBonus: 0,
      brigadier: null,
    },
  }
}

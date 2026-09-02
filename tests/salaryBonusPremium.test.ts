import { describe, expect, it } from 'vitest'
import {
  autoEmployeeBonuses,
  individualMonthlyBonus,
  oneTimeMonthPremium,
} from '@/lib/finance/employeeBonus'
import { effectiveSalaryWithBonus, resolvePayRate } from '@/lib/payrollRates'
import type { Employee } from '@/lib/types'

function emp(partial: Partial<Employee>): Employee {
  return {
    id: 'e1',
    fullName: 'Test',
    tabNumber: '1',
    brigade: 'A',
    schedule: '5/2',
    group2x2: 'А',
    cycleStart: '2026-01-01',
    active: true,
    ...partial,
  } as Employee
}

describe('бонус к зарплате и разовая премия', () => {
  it('бонус к зарплате входит в базу ставки и аванса', () => {
    const e = emp({
      monthlySalary: 1000,
      individualBonus: true,
      monthlyBonus: 200,
    })
    expect(individualMonthlyBonus(e)).toBe(200)
    expect(effectiveSalaryWithBonus(e)).toBe(1200)
    expect(resolvePayRate(e).monthly).toBe(1200)
    expect(resolvePayRate(e).salaryBonus).toBe(200)
  })

  it('бонус к зарплате не дублируется в колонке авто-премий', () => {
    const e = emp({
      monthlySalary: 1000,
      individualBonus: true,
      monthlyBonus: 200,
      bonusPercentFromSalary: true,
    })
    // 10% от 1000 начисленного — без monthlyBonus
    expect(autoEmployeeBonuses(e, 1000, '2026-07')).toBe(100)
  })

  it('единоразовая премия только за указанный месяц', () => {
    const e = emp({
      monthPremiums: { '2026-07': 150, '2026-06': 50 },
    })
    expect(oneTimeMonthPremium(e, '2026-07')).toBe(150)
    expect(oneTimeMonthPremium(e, '2026-08')).toBe(0)
    expect(autoEmployeeBonuses(e, 0, '2026-07')).toBe(150)
    expect(autoEmployeeBonuses(e, 0, '2026-08')).toBe(0)
  })
})

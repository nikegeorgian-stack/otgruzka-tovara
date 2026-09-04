import { describe, expect, it } from 'vitest'
import {
  cookAdvanceSummary,
  employeeAcceptedMealDeduction,
  findPublishedMealWeek,
  isMealOrderLocked,
  mealCost,
  mealCompositionLabel,
  mealCompositionText,
  mealDayExtraIds,
  mealPortions,
  orderMealCost,
  weekStartIso,
} from '@/lib/meals/calc'
import { createDefaultMealsStore, normalizeMealsStore } from '@/lib/meals/init'
import {
  canCookMeals,
  canManageMealSettings,
  canOrderMeals,
  canSeeMealPrices,
} from '@/lib/meals/access'
import { viewsForUser } from '@/lib/access/permissions'
import { createDefaultAccessStore } from '@/lib/access/init'
import { mealBenefitFor1c } from '@/lib/finance/georgiaSalary1c'
import type { AppUser } from '@/lib/access/types'
import type { AppStore } from '@/lib/types'

function user(roleId: AppUser['roleId'], extra: Partial<AppUser> = {}): AppUser {
  return {
    id: 'u1',
    login: 't@t.t',
    displayName: 'T',
    roleId,
    passwordHash: '',
    passwordSalt: '',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...extra,
  }
}

describe('meal pricing', () => {
  const pricing = createDefaultMealsStore().settings.pricing

  it('charges 5 ₾ employee for the first portion and 10 ₾ for extras', () => {
    expect(mealCost(1, pricing)).toEqual({ employeeGel: 5, companyGel: 5 })
    expect(mealCost(3, pricing)).toEqual({ employeeGel: 25, companyGel: 5 })
    expect(mealCost(0, pricing)).toEqual({ employeeGel: 0, companyGel: 0 })
  })

  it('snapshots base split and charges extras fully to employee', () => {
    const order = {
      lines: [
        {
          optionId: 'base-2026-08-18',
          kind: 'base' as const,
          qty: 1,
          employeeUnitGel: 5,
          companyUnitGel: 5,
        },
        {
          optionId: 'extra-khachapuri',
          kind: 'extra' as const,
          qty: 3,
          employeeUnitGel: 4,
          companyUnitGel: 0,
        },
      ],
    }
    expect(orderMealCost(order, pricing)).toEqual({ employeeGel: 17, companyGel: 5 })
  })
})

describe('weekly meal menu', () => {
  it('uses Monday as stable week id and only exposes a published week', () => {
    expect(weekStartIso('2026-08-19')).toBe('2026-08-17')
    const meals = normalizeMealsStore({
      weeks: [
        {
          id: '2026-08-17',
          weekStart: '2026-08-17',
          status: 'draft',
          days: [],
          extraIds: [],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '2026-08-24',
          weekStart: '2026-08-24',
          status: 'published',
          days: [],
          extraIds: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    expect(findPublishedMealWeek(meals, '2026-08-19')).toBeUndefined()
    expect(findPublishedMealWeek(meals, '2026-08-26')?.id).toBe('2026-08-24')
  })

  it('keeps per-day extras and falls back to the weekly list for old menus', () => {
    const meals = normalizeMealsStore({
      weeks: [
        {
          id: '2026-08-17',
          weekStart: '2026-08-17',
          status: 'published',
          days: [
            { date: '2026-08-17', baseItemId: 'base-soup', extraIds: ['extra-khachapuri'] },
            { date: '2026-08-18', baseItemId: 'base-soup', extraIds: [] },
          ],
          extraIds: ['extra-salad'],
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    const week = findPublishedMealWeek(meals, '2026-08-17')
    expect(mealDayExtraIds(week, '2026-08-17')).toEqual(['extra-khachapuri'])
    // День с пустым списком — это осознанное «без дополнений», не повод брать недельный.
    expect(mealDayExtraIds(week, '2026-08-18')).toEqual([])
    // День без собственного списка остаётся на старом недельном наборе.
    expect(mealDayExtraIds(week, '2026-08-19')).toEqual(['extra-salad'])
  })

  it('keeps restaurant-style combo composition with grams', () => {
    const meals = normalizeMealsStore({
      catalog: [
        {
          id: 'base-lunch',
          kind: 'base',
          nameRu: 'Комплекс дня',
          nameKa: 'Комплекс дня',
          nameEn: 'Комплекс дня',
          employeePriceGel: 0,
          active: true,
          sort: 0,
          composition: [
            { id: '1', nameRu: 'Суп', grams: 250 },
            { id: '2', nameRu: 'Котлета', grams: 120 },
            { nameRu: '  ' },
          ],
        },
      ],
    })
    expect(meals.catalog[0]?.composition).toEqual([
      { id: '1', nameRu: 'Суп', nameKa: 'Суп', nameEn: 'Суп', grams: 250 },
      { id: '2', nameRu: 'Котлета', nameKa: 'Котлета', nameEn: 'Котлета', grams: 120 },
    ])
    expect(mealCompositionLabel(meals.catalog[0]!.composition![0], 'ru')).toBe('Суп — 250 г')
    expect(mealCompositionText(meals.catalog[0], 'ru')).toBe('Суп — 250 г · Котлета — 120 г')
  })

  it('has no Meat/Vegan defaults in the new catalog', () => {
    const meals = createDefaultMealsStore()
    expect(meals.catalog).toEqual([])
    expect(meals.weeks).toEqual([])
  })
})

describe('cook advance summary', () => {
  it('calculates received, spent, reserved and balance without manual expenses', () => {
    const meals = normalizeMealsStore({
      advances: [
        { id: 'a1', amountGel: 200, receivedAt: '2026-08-17T10:00:00.000Z', note: '' },
      ],
      orders: [
        {
          id: 'accepted',
          employeeId: 'e1',
          employeeName: 'A',
          date: '2026-08-18',
          status: 'accepted',
          createdAt: '',
          updatedAt: '',
          lines: [
            {
              optionId: 'base',
              kind: 'base',
              qty: 1,
              employeeUnitGel: 5,
              companyUnitGel: 5,
            },
          ],
        },
        {
          id: 'pending',
          employeeId: 'e2',
          employeeName: 'B',
          date: '2026-08-19',
          status: 'submitted',
          createdAt: '',
          updatedAt: '',
          lines: [
            {
              optionId: 'extra',
              kind: 'extra',
              qty: 2,
              employeeUnitGel: 4,
              companyUnitGel: 0,
            },
          ],
        },
      ],
      acceptedDays: [{ id: '2026-08-18', date: '2026-08-18', acceptedAt: '' }],
    })
    expect(cookAdvanceSummary(meals)).toEqual({
      receivedGel: 200,
      spentGel: 10,
      reservedGel: 8,
      balanceGel: 190,
      availableAfterReserveGel: 182,
    })
  })
})

describe('meal deadline', () => {
  const settings = createDefaultMealsStore().settings

  it('locks tomorrow after 18:00 Tbilisi', () => {
    const mondayNoon = new Date('2026-08-17T08:00:00.000Z') // 12:00 Tbilisi UTC+4
    expect(isMealOrderLocked(settings, [], '2026-08-18', mondayNoon)).toBe(false)
    const mondayEvening = new Date('2026-08-17T14:00:00.000Z') // 18:00 Tbilisi
    expect(isMealOrderLocked(settings, [], '2026-08-18', mondayEvening)).toBe(true)
    expect(isMealOrderLocked(settings, [], '2026-08-19', mondayEvening)).toBe(false)
  })

  it('locks an accepted day', () => {
    expect(
      isMealOrderLocked(settings, [{ id: '2026-08-18', date: '2026-08-18', acceptedAt: 'x' }], '2026-08-18'),
    ).toBe(true)
  })
})

describe('accepted meals payroll', () => {
  it('does not deduct submitted orders until the cook accepts the day', () => {
    const store = {
      meals: {
        ...createDefaultMealsStore(),
        orders: [
          {
            id: 'o1',
            employeeId: 'e1',
            employeeName: 'Ivan',
            date: '2026-08-18',
            lines: [{ optionId: 'meat', qty: 2 }],
            status: 'submitted' as const,
            createdAt: '',
            updatedAt: '',
          },
        ],
      },
    } as Pick<AppStore, 'meals'>
    expect(employeeAcceptedMealDeduction(store, 'e1', '2026-08')).toBe(0)
    store.meals!.orders[0].status = 'accepted'
    store.meals!.acceptedDays = [{ id: '2026-08-18', date: '2026-08-18', acceptedAt: 'x' }]
    expect(employeeAcceptedMealDeduction(store, 'e1', '2026-08')).toBe(15)
    expect(mealPortions(store.meals!.orders[0])).toBe(2)
  })
})

describe('1C meal benefit vs lunch withhold', () => {
  it('keeps column O as mealAllowanceGel only', () => {
    expect(mealBenefitFor1c({ mealAllowanceGel: 40 })).toBe(40)
    expect(mealBenefitFor1c({})).toBe(0)
  })
})

describe('meals access', () => {
  const access = createDefaultAccessStore()

  it('gives meals to employees and not to the timeclock kiosk', () => {
    // Baseline ACL: employee personal cabinet includes protocols (see roles.ts / permissions.ts).
    expect(viewsForUser(access, user('employee'))).toEqual(['tasks', 'my', 'meals', 'protocols'])
    expect(viewsForUser(access, user('timeclock'))).toEqual(['timeclock'])
    expect(viewsForUser(access, user('cook'))).toEqual(['tasks', 'meals', 'my'])
    expect(viewsForUser(access, user('hr'))).toContain('meals')
    expect(viewsForUser(access, user('hr'))).toContain('tasks')
  })

  it('shows kitchen totals to the cook while HR/finance views stay hidden', () => {
    expect(canSeeMealPrices(user('cook'))).toBe(true)
    expect(canCookMeals(user('cook'))).toBe(true)
    expect(canOrderMeals(user('cook'))).toBe(false)
    expect(canManageMealSettings(user('cook'))).toBe(false)
    expect(canManageMealSettings(user('sysadmin'))).toBe(true)
    expect(viewsForUser(access, user('cook'))).not.toContain('hr')
    expect(viewsForUser(access, user('cook'))).not.toContain('finance')
  })
})

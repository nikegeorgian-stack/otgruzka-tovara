import { appendAudit } from '@/lib/audit'
import { addDaysIso } from '@/lib/dates'
import { getMeals, normalizeMealsStore } from '@/lib/meals/init'
import {
  findPublishedMealWeek,
  isMealOrderLocked,
  mealDayExtraIds,
  weekStartIso,
} from '@/lib/meals/calc'
import type {
  MealCatalogItem,
  MealMenuWeek,
  MealOption,
  MealOrderLine,
  MealOrderStatus,
  MealSettings,
} from '@/lib/meals/types'
import type { AppStore } from '@/lib/types'
import type { StoreSliceDeps } from '../storeApi'

export function createMealsSlice({ setStore, getStore, getActor }: StoreSliceDeps) {
  const actorFields = () => {
    const a = getActor?.() ?? null
    return { by: a?.id, byName: a?.name }
  }

  const actorUser = () => {
    const id = getActor?.()?.id
    if (!id) return undefined
    return getStore().access?.users?.find((u) => u.id === id)
  }

  const canManageKitchen = () => {
    const role = actorUser()?.roleId
    return role === 'cook' || role === 'sysadmin'
  }

  return {
    upsertMealOrder(input: {
      employeeId: string
      employeeName: string
      date: string
      lines: MealOrderLine[]
    }): string | null {
      let orderId: string | null = null
      setStore((s) => {
        const meals = getMeals(s)
        const user = actorUser()
        // Повар управляет кухней и отчётами, но не оформляет заказы.
        if (user?.roleId === 'cook') return s
        if (user?.roleId === 'employee') {
          if (!user.employeeId || input.employeeId !== user.employeeId) return s
        }
        if (isMealOrderLocked(meals.settings, meals.acceptedDays, input.date)) return s
        const actor = actorFields()
        const now = new Date().toISOString()
        const publishedWeek = findPublishedMealWeek(meals, input.date)
        const menuDay = publishedWeek?.days.find((day) => day.date === input.date)
        const dayExtras = new Set(mealDayExtraIds(publishedWeek, input.date))
        const catalogById = new Map(meals.catalog.map((item) => [item.id, item]))
        const lines = publishedWeek
          ? input.lines.flatMap((line): MealOrderLine[] => {
              const item = catalogById.get(line.optionId)
              if (!item || !item.active || line.qty <= 0) return []
              if (item.kind === 'base') {
                if (menuDay?.baseItemId !== item.id) return []
                return [{
                  optionId: item.id,
                  kind: 'base',
                  qty: 1,
                  nameRu: item.nameRu,
                  nameKa: item.nameKa,
                  nameEn: item.nameEn,
                  employeeUnitGel: meals.settings.pricing.firstPortionEmployeeGel,
                  companyUnitGel: meals.settings.pricing.firstPortionCompanyGel,
                }]
              }
              if (!dayExtras.has(item.id)) return []
              return [{
                optionId: item.id,
                kind: 'extra',
                qty: Math.max(1, Math.round(line.qty)),
                nameRu: item.nameRu,
                nameKa: item.nameKa,
                nameEn: item.nameEn,
                employeeUnitGel: item.employeePriceGel,
                companyUnitGel: 0,
              }]
            })
          : input.lines.filter((line) => line.qty > 0)
        const existing = meals.orders.find(
          (o) =>
            o.employeeId === input.employeeId &&
            o.date === input.date &&
            o.status !== 'cancelled',
        )
        if (existing?.status === 'accepted') return s
        const id = existing?.id ?? crypto.randomUUID()
        orderId = id
        const nextOrder = {
          id,
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          date: input.date,
          lines,
          status: (lines.length ? 'submitted' : 'cancelled') as MealOrderStatus,
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? actor.by,
          createdByName: existing?.createdByName ?? actor.byName,
          updatedAt: now,
        }
        const orders = existing
          ? meals.orders.map((o) => (o.id === id ? nextOrder : o))
          : [...meals.orders, nextOrder]
        const next: AppStore = {
          ...s,
          meals: { ...meals, orders },
        }
        return appendAudit(next, {
          action: 'meals_order',
          dateKey: input.date,
          employeeId: input.employeeId,
          detail: lines.length
            ? `${input.employeeName}: ${lines.map((l) => `${l.optionId}×${l.qty}`).join(', ')}`
            : `${input.employeeName}: отмена`,
          ...actor,
        })
      })
      return orderId
    },

    upsertMealCatalogItem(item: MealCatalogItem): void {
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const normalized = normalizeMealsStore({
          ...meals,
          catalog: meals.catalog.some((row) => row.id === item.id)
            ? meals.catalog.map((row) => (row.id === item.id ? item : row))
            : [...meals.catalog, item],
        })
        const prev = meals.catalog.find((row) => row.id === item.id)
        const actor = actorFields()
        const oldName = prev?.nameRu ?? prev?.nameKa ?? prev?.nameEn
        const newName = item.nameRu ?? item.nameKa ?? item.nameEn
        return appendAudit(
          { ...s, meals: normalized },
          {
            action: 'meals_catalog',
            detail: prev
              ? `Комплекс: ${oldName || '—'} → ${newName || '—'}`
              : `Комплекс создан: ${newName || item.id}`,
            oldValue: oldName,
            newValue: newName,
            ...actor,
          },
        )
      })
    },

    setMealWeekBase(weekStart: string, date: string, baseItemId: string | null): void {
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const id = weekStartIso(weekStart)
        const now = new Date().toISOString()
        const existing = meals.weeks.find((week) => week.id === id)
        if (existing?.status === 'published') return s
        const week = normalizeMealsStore({
          weeks: [{
            ...(existing ?? {
              id,
              weekStart: id,
              status: 'draft',
              days: [],
              extraIds: [],
              createdAt: now,
            }),
            updatedAt: now,
          }],
        }).weeks[0]
        if (!week || !week.days.some((day) => day.date === date)) return s
        const nextWeek: MealMenuWeek = {
          ...week,
          days: week.days.map((day) =>
            day.date === date
              ? {
                  date: day.date,
                  ...(baseItemId ? { baseItemId } : {}),
                  ...(day.extraIds ? { extraIds: day.extraIds } : {}),
                }
              : day,
          ),
          updatedAt: now,
        }
        return {
          ...s,
          meals: {
            ...meals,
            weeks: existing
              ? meals.weeks.map((row) => (row.id === id ? nextWeek : row))
              : [...meals.weeks, nextWeek],
          },
        }
      })
    },

    setMealDayExtras(weekStart: string, date: string, extraIds: string[]): void {
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const id = weekStartIso(weekStart)
        const now = new Date().toISOString()
        const existing = meals.weeks.find((week) => week.id === id)
        if (existing?.status === 'published') return s
        const week = normalizeMealsStore({
          weeks: [{
            ...(existing ?? {
              id,
              weekStart: id,
              status: 'draft',
              days: [],
              extraIds: [],
              createdAt: now,
            }),
            updatedAt: now,
          }],
        }).weeks[0]
        if (!week || !week.days.some((day) => day.date === date)) return s
        const allowed = new Set(
          meals.catalog.filter((item) => item.active && item.kind === 'extra').map((item) => item.id),
        )
        const nextWeek: MealMenuWeek = {
          ...week,
          days: week.days.map((day) =>
            day.date === date
              ? { ...day, extraIds: [...new Set(extraIds.filter((extraId) => allowed.has(extraId)))] }
              : day,
          ),
          updatedAt: now,
        }
        return {
          ...s,
          meals: {
            ...meals,
            weeks: existing
              ? meals.weeks.map((row) => (row.id === id ? nextWeek : row))
              : [...meals.weeks, nextWeek],
          },
        }
      })
    },

    setMealWeekExtras(weekStart: string, extraIds: string[]): void {
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const id = weekStartIso(weekStart)
        const existing = meals.weeks.find((week) => week.id === id)
        if (existing?.status === 'published') return s
        const now = new Date().toISOString()
        const draft = existing ?? normalizeMealsStore({
          weeks: [{
            id,
            weekStart: id,
            status: 'draft',
            days: [],
            extraIds: [],
            createdAt: now,
            updatedAt: now,
          }],
        }).weeks[0]
        if (!draft) return s
        const allowed = new Set(
          meals.catalog.filter((item) => item.active && item.kind === 'extra').map((item) => item.id),
        )
        const next = {
          ...draft,
          extraIds: [...new Set(extraIds.filter((extraId) => allowed.has(extraId)))],
          updatedAt: new Date().toISOString(),
        }
        return {
          ...s,
          meals: {
            ...meals,
            weeks: existing
              ? meals.weeks.map((week) => (week.id === id ? next : week))
              : [...meals.weeks, next],
          },
        }
      })
    },

    copyPreviousMealWeek(weekStart: string): boolean {
      let ok = false
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const id = weekStartIso(weekStart)
        const previousId = addDaysIso(id, -7)
        const previous = meals.weeks.find((week) => week.id === previousId)
        if (!previous) return s
        const now = new Date().toISOString()
        const copied: MealMenuWeek = {
          id,
          weekStart: id,
          status: 'draft',
          days: previous.days.map((day, index) => ({
            date: addDaysIso(id, index),
            ...(day.baseItemId ? { baseItemId: day.baseItemId } : {}),
            ...(day.extraIds ? { extraIds: [...day.extraIds] } : {}),
          })),
          extraIds: [...previous.extraIds],
          createdAt: now,
          updatedAt: now,
          copiedFromWeekId: previous.id,
        }
        ok = true
        return {
          ...s,
          meals: {
            ...meals,
            weeks: meals.weeks.some((week) => week.id === id)
              ? meals.weeks.map((week) => (week.id === id ? copied : week))
              : [...meals.weeks, copied],
          },
        }
      })
      return ok
    },

    publishMealWeek(weekStart: string): boolean {
      let ok = false
      setStore((s) => {
        if (!canManageKitchen()) return s
        const meals = getMeals(s)
        const id = weekStartIso(weekStart)
        const existing = meals.weeks.find((week) => week.id === id)
        if (!existing || existing.days.some((day) => !day.baseItemId)) return s
        const actor = actorFields()
        const now = new Date().toISOString()
        const next: MealMenuWeek = {
          ...existing,
          status: 'published',
          publishedAt: now,
          publishedBy: actor.by,
          publishedByName: actor.byName,
          updatedAt: now,
        }
        ok = true
        return appendAudit(
          {
            ...s,
            meals: { ...meals, weeks: meals.weeks.map((week) => (week.id === id ? next : week)) },
          },
          {
            action: 'meals_week',
            dateKey: id,
            detail: `Опубликовано меню недели ${id}`,
            ...actor,
          },
        )
      })
      return ok
    },

    addMealAdvanceReceipt(input: { amountGel: number; receivedAt: string; note?: string }): string | null {
      let id: string | null = null
      setStore((s) => {
        if (!canManageKitchen() || !Number.isFinite(input.amountGel) || input.amountGel <= 0) return s
        const meals = getMeals(s)
        const actor = actorFields()
        const receiptId = crypto.randomUUID()
        id = receiptId
        return appendAudit(
          {
            ...s,
            meals: {
              ...meals,
              advances: [
                ...meals.advances,
                {
                  id: receiptId,
                  amountGel: Math.round(input.amountGel * 100) / 100,
                  receivedAt: input.receivedAt,
                  note: input.note?.trim() || undefined,
                  createdBy: actor.by,
                  createdByName: actor.byName,
                },
              ],
            },
          },
          {
            action: 'meals_advance',
            detail: `Аванс кухни ${Math.round(input.amountGel * 100) / 100} ₾`,
            newValue: String(Math.round(input.amountGel * 100) / 100),
            ...actor,
          },
        )
      })
      return id
    },

    acceptMealDay(date: string): boolean {
      let ok = false
      setStore((s) => {
        const meals = getMeals(s)
        const role = actorUser()?.roleId
        if (role !== 'cook' && role !== 'sysadmin') return s
        if (meals.acceptedDays.some((d) => d.date === date)) return s
        const actor = actorFields()
        const now = new Date().toISOString()
        const orders = meals.orders.map((o) =>
          o.date === date && o.status === 'submitted'
            ? { ...o, status: 'accepted' as const, updatedAt: now }
            : o,
        )
        const next: AppStore = {
          ...s,
          meals: {
            ...meals,
            orders,
            acceptedDays: [
              ...meals.acceptedDays,
              {
                id: date,
                date,
                acceptedAt: now,
                acceptedBy: actor.by,
                acceptedByName: actor.byName,
              },
            ],
          },
        }
        ok = true
        return appendAudit(next, {
          action: 'meals_accept',
          dateKey: date,
          detail: `принят день ${date}`,
          ...actor,
        })
      })
      return ok
    },

    unacceptMealDay(date: string): boolean {
      let ok = false
      setStore((s) => {
        const meals = getMeals(s)
        const role = actorUser()?.roleId
        if (role !== 'cook' && role !== 'sysadmin') return s
        if (!meals.acceptedDays.some((d) => d.date === date)) return s
        const actor = actorFields()
        const now = new Date().toISOString()
        const orders = meals.orders.map((o) =>
          o.date === date && o.status === 'accepted'
            ? { ...o, status: 'submitted' as const, updatedAt: now }
            : o,
        )
        const next: AppStore = {
          ...s,
          meals: {
            ...meals,
            orders,
            acceptedDays: meals.acceptedDays.filter((d) => d.date !== date),
          },
        }
        ok = true
        return appendAudit(next, {
          action: 'meals_unaccept',
          dateKey: date,
          detail: `снято принятие ${date}`,
          ...actor,
        })
      })
      return ok
    },

    updateMealSettings(patch: Partial<MealSettings>): void {
      setStore((s) => {
        if (actorUser()?.roleId !== 'sysadmin') return s
        const meals = getMeals(s)
        const settings = normalizeMealsStore({
          ...meals,
          settings: { ...meals.settings, ...patch },
        }).settings
        return {
          ...s,
          meals: { ...meals, settings },
        }
      })
    },

    upsertMealOption(option: MealOption): void {
      setStore((s) => {
        if (actorUser()?.roleId !== 'sysadmin') return s
        const meals = getMeals(s)
        const exists = meals.settings.options.some((o) => o.id === option.id)
        const options = exists
          ? meals.settings.options.map((o) => (o.id === option.id ? option : o))
          : [...meals.settings.options, option]
        return {
          ...s,
          meals: {
            ...meals,
            settings: { ...meals.settings, options },
          },
        }
      })
    },
  }
}

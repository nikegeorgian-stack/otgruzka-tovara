import type { AiExecutor } from '@/lib/ai/types'
import { resultJson } from '@/lib/ai/types'
import {
  findRowForEmployee,
  isApproved,
  matchBrigade,
  normalizeCode,
  normalizeTarget,
  parseDayRange,
  parseMonthArg,
  requestConfirmation,
  resolveEmployee,
} from '@/lib/ai/timesheetHelpers'
import { dispatchWarehousePick } from '@/lib/ai/warehousePickEvent'
import type { AppStore, DayCode, ScheduleType, ViewId } from '@/lib/types'
import { dayDateKey, parseMonthKey } from '@/lib/dates'
import { findEmployeeByVoiceName } from '@/lib/voiceNames'
import { suggestDocNumber } from '@/lib/warehouse/nomenclatureSearch'
import {
  computeAllBalances,
  findItemBySkuOrBarcode,
  formatQty,
  lowStockItems,
} from '@/lib/warehouse/stock'

export function createAiExecutor(args: {
  store: AppStore
  view: ViewId
  activeMonth: string
  onNavigate: (view: ViewId) => void
  onOpenMonth: (month: string) => void
  onPostWarehouseDoc: (doc: {
    type: 'receipt' | 'issue'
    number: string
    date: string
    warehouseId: string
    counterparty?: string
    brigade?: string
    comment?: string
    lines: { itemId: string; quantity: number }[]
  }) => void
  onSetMarksRange: (
    month: string,
    rowId: string,
    fromDay: number,
    toDay: number,
    mode: 'plan' | 'fact',
    code: DayCode,
  ) => void
  onSetMark: (
    month: string,
    rowId: string,
    dateKey: string,
    mode: 'plan' | 'fact',
    code: DayCode,
  ) => void
  onAssignPermanentToBrigade: (month: string, employeeId: string, brigade: string) => boolean
  onReplaceInBrigade: (
    month: string,
    brigade: string,
    fromEmployeeId: string,
    toEmployeeId: string,
  ) => boolean
  onSwapEmployeeRows: (month: string, employeeIdA: string, employeeIdB: string) => boolean
  onChangeScheduleFromDay: (
    month: string,
    employeeId: string,
    fromDay: number,
    schedule: ScheduleType,
  ) => boolean
}): AiExecutor {
  const {
    store,
    view,
    activeMonth,
    onNavigate,
    onOpenMonth,
    onPostWarehouseDoc,
    onSetMarksRange,
    onSetMark,
    onAssignPermanentToBrigade,
    onReplaceInBrigade,
    onSwapEmployeeRows,
    onChangeScheduleFromDay,
  } = args
  const wh = store.warehouse
  const mainWh = wh.locations[0]?.id ?? ''

  return {
    navigate(v, _ctx) {
      onNavigate(v)
      return resultJson({ ok: true, message: `Открыт раздел: ${v}` })
    },

    openMonth(month, _ctx) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return resultJson({ ok: false, error: 'Формат: YYYY-MM' })
      }
      onOpenMonth(month)
      onNavigate('month')
      return resultJson({ ok: true, message: `Открыт табель ${month}` })
    },

    getAppSummary(_ctx) {
      const balances = computeAllBalances(wh)
      const low = lowStockItems(
        wh.items.filter((i) => i.active),
        balances,
      )
      return resultJson({
        ok: true,
        data: {
          view,
          activeMonth,
          site: store.settings.site,
          employees: store.employees.filter((e) => e.active).length,
          brigades: store.brigades,
          warehouseItems: wh.items.filter((i) => i.active).length,
          lowStockCount: low.length,
          lowStockSample: low.slice(0, 10).map((i) => i.name),
        },
      })
    },

    searchEmployees(query, _ctx) {
      const q = query.trim()
      if (!q) return resultJson({ ok: false, error: 'Укажите фамилию' })
      const active = store.employees.filter((e) => e.active)
      const matches = active
        .filter((e) => findEmployeeByVoiceName([e], q) || e.fullName.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 10)
        .map((e) => ({
          id: e.id,
          name: e.fullName,
          brigade: e.brigade,
          schedule: e.schedule,
          tabNumber: e.tabNumber,
        }))
      return resultJson({
        ok: true,
        message:
          matches.length > 0
            ? matches.map((e) => `${e.name}${e.brigade ? ` (${e.brigade})` : ''}`).join('; ')
            : 'Никого не найдено',
        data: { count: matches.length, employees: matches },
      })
    },

    listBrigades(_ctx) {
      return resultJson({ ok: true, data: { brigades: store.brigades } })
    },

    warehouseBalance(query, _ctx) {
      const item = findItemBySkuOrBarcode(wh.items, query)
      if (!item) return resultJson({ ok: false, error: `Не найдено: ${query}` })
      const b = computeAllBalances(wh).get(item.id)
      return resultJson({
        ok: true,
        message: `${item.name}: ${formatQty(b?.balance ?? 0)} ${item.unit}`,
        data: {
          name: item.name,
          unit: item.unit,
          balance: b?.balance ?? 0,
          available: b?.available ?? 0,
        },
      })
    },

    listLowStock(_ctx) {
      const balances = computeAllBalances(wh)
      const items = lowStockItems(
        wh.items.filter((i) => i.active),
        balances,
      ).map((i) => ({
        name: i.name,
        available: balances.get(i.id)?.available ?? 0,
        minStock: i.minStock,
        unit: i.unit,
      }))
      return resultJson({ ok: true, data: { count: items.length, items } })
    },

    warehouseDocument({ type, lines, counterparty, brigade, comment, confirmationToken }, ctx) {
      const date = new Date().toISOString().slice(0, 10)
      const parsed: { itemId: string; quantity: number; name: string }[] = []
      const errors: string[] = []

      for (const line of lines) {
        const item = findItemBySkuOrBarcode(wh.items, line.name)
        if (!item) {
          errors.push(`Не найдено: ${line.name}`)
          continue
        }
        if (line.quantity <= 0) continue
        parsed.push({ itemId: item.id, quantity: line.quantity, name: item.name })
      }

      if (!parsed.length) {
        return resultJson({
          ok: false,
          error: errors.length ? errors.join('; ') : 'Нет строк',
        })
      }

      const docArgs = {
        type,
        lines,
        counterparty,
        brigade,
        comment,
        confirmationToken,
      }

      if (type === 'issue') {
        const balances = computeAllBalances(wh)
        const shortages = parsed.filter((p) => {
          const avail = balances.get(p.itemId)?.available ?? 0
          return p.quantity > avail
        })

        if (shortages.length > 0 && !isApproved(docArgs, ctx)) {
          const details = shortages
            .map((p) => {
              const avail = balances.get(p.itemId)?.available ?? 0
              return `${p.name}: расход ${p.quantity}, остаток ${avail}`
            })
            .join('; ')
          return resultJson(
            requestConfirmation(
              'warehouse_document',
              docArgs,
              `Расход больше доступного остатка: ${details}. Провести документ всё равно?`,
              'warehouse_overdraft',
            ),
          )
        }
      }

      const number = suggestDocNumber(wh.documents, type, date)
      onPostWarehouseDoc({
        type,
        number,
        date,
        warehouseId: mainWh,
        counterparty,
        brigade: type === 'issue' ? brigade : undefined,
        comment: comment ?? 'ИИ-помощник',
        lines: parsed.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
      })
      onNavigate('warehouse')

      return resultJson({
        ok: true,
        message: `Проведён документ ${number}`,
        data: {
          document: number,
          type,
          lines: parsed.map((p) => `${p.name} × ${p.quantity}`),
          warnings: errors,
        },
      })
    },

    setTimesheetCode(rawArgs, ctx) {
      try {
        const month = parseMonthArg(rawArgs, activeMonth)
        const { fromDay, toDay, count } = parseDayRange(rawArgs, month, true)
        const code = normalizeCode(rawArgs.code)
        const target = normalizeTarget(rawArgs.target)

        if (!code) {
          return resultJson({ ok: false, error: `Некорректный код: ${String(rawArgs.code)}` })
        }

        const empResult = resolveEmployee(store, rawArgs)
        if (!empResult.ok) return resultJson({ ok: false, error: empResult.error })

        const rowId = findRowForEmployee(store, month, empResult.employee.id)
        if (!rowId) {
          return resultJson({
            ok: false,
            error: `${empResult.employee.fullName} не в табеле ${month}. Назначьте в бригаду.`,
          })
        }

        if (count > 3 && !isApproved(rawArgs, ctx)) {
          return resultJson(
            requestConfirmation(
              'set_timesheet_code',
              rawArgs,
              `Поставить ${empResult.employee.fullName} код ${code} в ${target === 'fact' ? 'факте' : 'плане'} за ${fromDay}–${toDay}? (${count} ячеек)`,
              'mass_timesheet',
            ),
          )
        }

        onSetMarksRange(month, rowId, fromDay, toDay, target, code)
        onOpenMonth(month)
        onNavigate('month')

        return resultJson({
          ok: true,
          message: `${empResult.employee.fullName}: ${code} (${target}) ${fromDay}–${toDay} ${month}`,
        })
      } catch (e) {
        return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },

    assignEmployeeToBrigade(rawArgs, _ctx) {
      try {
        const month = parseMonthArg(rawArgs, activeMonth)
        const empResult = resolveEmployee(store, rawArgs)
        if (!empResult.ok) return resultJson({ ok: false, error: empResult.error })

        const brigadeQuery = String(rawArgs.brigade ?? '').trim()
        if (!brigadeQuery) return resultJson({ ok: false, error: 'Укажите бригаду' })

        let brigade: string
        try {
          brigade = matchBrigade(store, brigadeQuery) ?? brigadeQuery
        } catch (e) {
          return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }

        if (!store.brigades.includes(brigade)) {
          return resultJson({ ok: false, error: `Бригада не найдена: ${brigadeQuery}` })
        }

        const ok = onAssignPermanentToBrigade(month, empResult.employee.id, brigade)
        if (!ok) {
          return resultJson({ ok: false, error: 'Не удалось назначить в бригаду' })
        }

        onOpenMonth(month)
        onNavigate('month')

        return resultJson({
          ok: true,
          message: `${empResult.employee.fullName} → «${brigade}» (${month})`,
        })
      } catch (e) {
        return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },

    replaceInBrigade(rawArgs, _ctx) {
      try {
        const month = parseMonthArg(rawArgs, activeMonth)
        const fromResult = resolveEmployee(store, { employee: rawArgs.from })
        if (!fromResult.ok) return resultJson({ ok: false, error: fromResult.error })
        const toResult = resolveEmployee(store, { employee: rawArgs.to })
        if (!toResult.ok) return resultJson({ ok: false, error: toResult.error })

        const brigadeQuery = String(rawArgs.brigade ?? '').trim()
        if (!brigadeQuery) {
          const sheet = store.months[month]
          const rowBrigade = sheet?.rows.find((r) => r.employeeId === fromResult.employee.id)?.brigade
          if (!rowBrigade) {
            return resultJson({ ok: false, error: 'Укажите бригаду, например: пропитка 1.1' })
          }
          const ok = onReplaceInBrigade(
            month,
            rowBrigade,
            fromResult.employee.id,
            toResult.employee.id,
          )
          if (!ok) {
            return resultJson({
              ok: false,
              error: `${fromResult.employee.fullName.split(' ')[0]} не найден в строке бригады «${rowBrigade}»`,
            })
          }
          onOpenMonth(month)
          onNavigate('month')
          return resultJson({
            ok: true,
            message: `${fromResult.employee.fullName.split(' ')[0]} → ${toResult.employee.fullName.split(' ')[0]} · ${rowBrigade} · ${month}`,
          })
        }

        let brigade: string
        try {
          brigade = matchBrigade(store, brigadeQuery) ?? brigadeQuery
        } catch (e) {
          return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
        }

        if (!store.brigades.includes(brigade)) {
          return resultJson({ ok: false, error: `Бригада не найдена: ${brigadeQuery}` })
        }

        const ok = onReplaceInBrigade(
          month,
          brigade,
          fromResult.employee.id,
          toResult.employee.id,
        )
        if (!ok) {
          return resultJson({
            ok: false,
            error: `${fromResult.employee.fullName.split(' ')[0]} не в бригаде «${brigade}» в ${month}`,
          })
        }

        onOpenMonth(month)
        onNavigate('month')

        return resultJson({
          ok: true,
          message: `${fromResult.employee.fullName.split(' ')[0]} → ${toResult.employee.fullName.split(' ')[0]} · ${brigade} · ${month}`,
        })
      } catch (e) {
        return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },

    swapEmployeeRows(rawArgs, _ctx) {
      try {
        const month = parseMonthArg(rawArgs, activeMonth)
        const aResult = resolveEmployee(store, { employee: rawArgs.employeeA })
        if (!aResult.ok) return resultJson({ ok: false, error: aResult.error })
        const bResult = resolveEmployee(store, { employee: rawArgs.employeeB })
        if (!bResult.ok) return resultJson({ ok: false, error: bResult.error })

        const ok = onSwapEmployeeRows(month, aResult.employee.id, bResult.employee.id)
        if (!ok) {
          return resultJson({ ok: false, error: 'Оба сотрудника должны быть назначены в табеле' })
        }

        onOpenMonth(month)
        onNavigate('month')

        return resultJson({
          ok: true,
          message: `${aResult.employee.fullName.split(' ')[0]} ⇄ ${bResult.employee.fullName.split(' ')[0]} · ${month}`,
        })
      } catch (e) {
        return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },

    changeScheduleFromDay(rawArgs, ctx) {
      try {
        const month = parseMonthArg(rawArgs, activeMonth)
        const fromDay = Number(rawArgs.fromDay)
        if (!fromDay) return resultJson({ ok: false, error: 'Укажите fromDay' })

        const empResult = resolveEmployee(store, rawArgs)
        if (!empResult.ok) return resultJson({ ok: false, error: empResult.error })

        const schedule = rawArgs.schedule as ScheduleType | undefined
        const pattern = String(rawArgs.pattern ?? '')
        const target = normalizeTarget(rawArgs.target ?? 'plan')

        const { toDay, count } = parseDayRange(
          { ...rawArgs, fromDay, toDay: rawArgs.toDay ?? undefined },
          month,
          true,
        )

        if (count > 3 && !isApproved(rawArgs, ctx)) {
          return resultJson(
            requestConfirmation(
              'change_schedule_from_day',
              rawArgs,
              `Изменить график ${empResult.employee.fullName} с ${fromDay} по ${toDay} (${count} дней)?`,
              'mass_timesheet',
            ),
          )
        }

        if (schedule === '5/2 8ч' || schedule === '2/2 11ч' || schedule === '1/1 11ч') {
          const ok = onChangeScheduleFromDay(month, empResult.employee.id, fromDay, schedule)
          if (!ok) return resultJson({ ok: false, error: 'Не удалось сменить график' })
          onOpenMonth(month)
          onNavigate('month')
          return resultJson({
            ok: true,
            message: `График ${schedule} для ${empResult.employee.fullName} с ${fromDay} числа`,
          })
        }

        if (pattern === 'same_code' || rawArgs.code) {
          const code = normalizeCode(rawArgs.code)
          if (!code) return resultJson({ ok: false, error: 'Укажите code' })

          const rowId = findRowForEmployee(store, month, empResult.employee.id)
          if (!rowId) {
            return resultJson({ ok: false, error: 'Сотрудник не в табеле месяца' })
          }

          onSetMarksRange(month, rowId, fromDay, toDay, target, code)
          onOpenMonth(month)
          onNavigate('month')
          return resultJson({
            ok: true,
            message: `Код ${code} (${target}) ${fromDay}–${toDay} для ${empResult.employee.fullName}`,
          })
        }

        // Проставление кодов по одному дню (если модель не указала schedule/pattern)
        const code = normalizeCode(rawArgs.code ?? '8')
        if (!code) return resultJson({ ok: false, error: 'Укажите schedule или code' })

        const rowId = findRowForEmployee(store, month, empResult.employee.id)
        if (!rowId) return resultJson({ ok: false, error: 'Сотрудник не в табеле' })

        const { year, month: mo } = parseMonthKey(month)
        for (let d = fromDay; d <= toDay; d += 1) {
          onSetMark(month, rowId, dayDateKey(year, mo, d), target, code)
        }

        onOpenMonth(month)
        onNavigate('month')
        return resultJson({
          ok: true,
          message: `Коды ${fromDay}–${toDay} для ${empResult.employee.fullName}`,
        })
      } catch (e) {
        return resultJson({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },

    openWarehousePickModal(rawArgs, _ctx) {
      const query = String(rawArgs.query ?? '').trim()
      if (!query) return resultJson({ ok: false, error: 'Укажите строку поиска' })

      const type = rawArgs.type as 'receipt' | 'issue' | undefined
      const quantity = Number(rawArgs.quantity) || undefined

      onNavigate('warehouse')
      dispatchWarehousePick({ query, type, quantity })

      return resultJson({ ok: true, message: `Открыт подбор: ${query}` })
    },

    confirmAction(rawArgs, _ctx) {
      const action = String(rawArgs.action ?? '') as Parameters<typeof requestConfirmation>[0]
      const message = String(rawArgs.message ?? 'Подтвердите действие.')
      const payload =
        rawArgs.args && typeof rawArgs.args === 'object'
          ? (rawArgs.args as Record<string, unknown>)
          : {}

      if (!action) return resultJson({ ok: false, error: 'confirm_action: нет action' })

      return resultJson(requestConfirmation(action, payload, message, 'manual'))
    },
  }
}

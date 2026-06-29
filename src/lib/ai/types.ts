import type { ViewId } from '@/lib/types'

export const TIMESHEET_CODES = ['8', '11', 'Н', '22', 'В', 'ОТ', 'ОО', 'Б', 'X', 'ПР'] as const

export type TimesheetCode = (typeof TIMESHEET_CODES)[number]
export type TimesheetTarget = 'plan' | 'fact'

export type AiToolName =
  | 'navigate'
  | 'open_month'
  | 'get_app_summary'
  | 'search_employees'
  | 'list_brigades'
  | 'warehouse_balance'
  | 'list_low_stock'
  | 'warehouse_document'
  | 'set_timesheet_code'
  | 'assign_employee_to_brigade'
  | 'replace_in_brigade'
  | 'swap_employee_rows'
  | 'change_schedule_from_day'
  | 'open_warehouse_pick_modal'
  | 'confirm_action'

export type AiPendingConfirmation = {
  token: string
  action: AiToolName
  args: Record<string, unknown>
  message: string
  danger?: 'warehouse_overdraft' | 'mass_timesheet' | 'mass_brigade' | 'manual'
  createdAt: number
}

export type AiToolResult = {
  ok: boolean
  message?: string
  data?: unknown
  error?: string
  requiresConfirmation?: boolean
  confirmation?: AiPendingConfirmation
}

export type AiChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; tool_call_id: string; content: string }

export type AiToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type AiExecutorContext = {
  isConfirmationApproved: (token: string) => boolean
}

export type AiExecutor = {
  navigate: (view: ViewId, ctx: AiExecutorContext) => string
  openMonth: (month: string, ctx: AiExecutorContext) => string
  getAppSummary: (ctx: AiExecutorContext) => string
  searchEmployees: (query: string, ctx: AiExecutorContext) => string
  listBrigades: (ctx: AiExecutorContext) => string
  warehouseBalance: (query: string, ctx: AiExecutorContext) => string
  listLowStock: (ctx: AiExecutorContext) => string
  warehouseDocument: (
    args: {
      type: 'receipt' | 'issue'
      lines: { name: string; quantity: number }[]
      counterparty?: string
      brigade?: string
      comment?: string
      confirmationToken?: string
    },
    ctx: AiExecutorContext,
  ) => string
  setTimesheetCode: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  assignEmployeeToBrigade: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  replaceInBrigade: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  swapEmployeeRows: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  changeScheduleFromDay: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  openWarehousePickModal: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
  confirmAction: (args: Record<string, unknown>, ctx: AiExecutorContext) => string
}

export type AiSettingsResolved = {
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
}

const codeSchema = {
  type: 'string',
  enum: ['8', '11', 'Н', '22', 'В', 'ОТ', 'ОО', 'Б', 'X', 'ПР'],
  description: 'Код табеля',
}

const targetSchema = {
  type: 'string',
  enum: ['plan', 'fact'],
  description: 'plan — план, fact — факт',
}

export const AI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'navigate',
      description: 'Перейти: month, employees, warehouse, summary, settings, codes, pay',
      parameters: {
        type: 'object',
        properties: {
          view: {
            type: 'string',
            enum: [
              'month',
              'directories',
              'employees',
              'warehouse',
              'summary',
              'settings',
              'codes',
              'pay',
              'hr',
              'production',
            ],
          },
        },
        required: ['view'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_month',
      description: 'Открыть табель YYYY-MM',
      parameters: {
        type: 'object',
        properties: { month: { type: 'string' } },
        required: ['month'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_app_summary',
      description: 'Сводка: экран, месяц, сотрудники, склад',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_employees',
      description: 'Поиск сотрудников по фамилии',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_brigades',
      description: 'Список бригад',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'warehouse_balance',
      description: 'Остаток по названию/артикулу',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_low_stock',
      description: 'Позиции ниже минимума',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'warehouse_document',
      description: 'Провести приход/расход',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['receipt', 'issue'] },
          lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, quantity: { type: 'number' } },
              required: ['name', 'quantity'],
            },
          },
          counterparty: { type: 'string' },
          brigade: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['type', 'lines'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_timesheet_code',
      description:
        'Поставить код сотруднику за день или диапазон. Сначала search_employees если ФИО неполное.',
      parameters: {
        type: 'object',
        properties: {
          employee: { type: 'string' },
          month: { type: 'string', description: 'YYYY-MM' },
          day: { type: 'integer', minimum: 1, maximum: 31 },
          fromDay: { type: 'integer', minimum: 1, maximum: 31 },
          toDay: { type: 'integer', minimum: 1, maximum: 31 },
          code: codeSchema,
          target: targetSchema,
        },
        required: ['employee', 'code', 'target'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'assign_employee_to_brigade',
      description: 'Назначить сотрудника в бригаду в табеле месяца',
      parameters: {
        type: 'object',
        properties: {
          employee: { type: 'string' },
          brigade: { type: 'string' },
          month: { type: 'string' },
        },
        required: ['employee', 'brigade'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'replace_in_brigade',
      description: 'В бригаде заменить одного сотрудника на другого в табеле месяца',
      parameters: {
        type: 'object',
        properties: {
          brigade: { type: 'string' },
          from: { type: 'string', description: 'Кого заменить (фамилия)' },
          to: { type: 'string', description: 'На кого заменить (фамилия)' },
          month: { type: 'string', description: 'YYYY-MM' },
        },
        required: ['from', 'to'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'swap_employee_rows',
      description: 'Поменять местами двух сотрудников в табеле',
      parameters: {
        type: 'object',
        properties: {
          employeeA: { type: 'string' },
          employeeB: { type: 'string' },
          month: { type: 'string' },
        },
        required: ['employeeA', 'employeeB'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'change_schedule_from_day',
      description:
        'Изменить график с дня: schedule 5/2 8ч, 2/2 11ч или 1/1 11ч; либо pattern same_code с code для проставления кодов по дням',
      parameters: {
        type: 'object',
        properties: {
          employee: { type: 'string' },
          month: { type: 'string' },
          fromDay: { type: 'integer' },
          toDay: { type: 'integer' },
          target: targetSchema,
          schedule: { type: 'string', enum: ['5/2 8ч', '2/2 11ч', '1/1 11ч'] },
          pattern: { type: 'string', enum: ['same_code'] },
          code: codeSchema,
        },
        required: ['employee', 'fromDay'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'open_warehouse_pick_modal',
      description: 'Открыть подбор номенклатуры на складе',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          type: { type: 'string', enum: ['receipt', 'issue'] },
          quantity: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'confirm_action',
      description: 'Запросить подтверждение опасного действия',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          message: { type: 'string' },
          args: { type: 'object' },
        },
        required: ['action', 'message', 'args'],
      },
    },
  },
]

export const AI_SYSTEM_PROMPT = `Ты — ИИ-помощник FiberCell «Табель + Склад» (пропитка, Грузия). Отвечай по-русски, кратко.

Правила:
- Факты только через tools. Не выдумывай остатки и табель.
- Коды: 8, 11, Н (ночная/ночь), 22, В (выходной), ОТ (оплачиваемый отпуск), ОО (неоплачиваемый отпуск), Б (больничный), X, ПР (прогул).
- «в факте» = target fact, «в плане» = target plan.
- Если день не указан — уточни. Месяц — из get_app_summary или текущий.
- Несколько похожих сотрудников — уточни через search_employees.
- Больше 3 ячеек табеля или расход > остатка — confirm_action или executor вернёт requiresConfirmation.
- Не удаляй данные и не сбрасывай базу.

Склад: warehouse_balance, list_low_stock, warehouse_document, open_warehouse_pick_modal.
Табель: set_timesheet_code, assign_employee_to_brigade, replace_in_brigade, swap_employee_rows, change_schedule_from_day.`

export function buildSystemPrompt(): string {
  return AI_SYSTEM_PROMPT
}

export function resultJson(r: AiToolResult): string {
  return JSON.stringify(r)
}

export function parseToolResult(raw: string): AiToolResult {
  try {
    const parsed = JSON.parse(raw) as AiToolResult
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed
  } catch {
    // legacy plain json
  }
  return { ok: true, message: raw }
}

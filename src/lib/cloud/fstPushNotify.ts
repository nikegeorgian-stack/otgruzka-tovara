import type { AccessStore } from '@/lib/access/types'
import type { AppStore, DayCode } from '@/lib/types'
import { sendFstPush } from './fstPush'

export type PersonalDayKind = 'rest' | 'unpaid' | 'idle' | 'violation' | 'night'

/** Коды, о которых человеку пишем в пуш (часы смены — нет, иначе спам). */
export function personalPushKind(
  code: DayCode,
): 'sick' | 'vacation' | PersonalDayKind | null {
  if (code === 'Б') return 'sick'
  if (code === 'ОТ') return 'vacation'
  if (code === 'В') return 'rest'
  if (code === 'ОО') return 'unpaid'
  if (code === 'ПР') return 'idle'
  if (code === 'X') return 'violation'
  if (code === 'Н') return 'night'
  return null
}

/** Логины (email) учёток, привязанных к сотрудникам. */
export function emailsForEmployeeIds(access: AccessStore, employeeIds: string[]): string[] {
  const want = new Set(employeeIds.filter(Boolean))
  if (!want.size) return []
  const out: string[] = []
  for (const u of access.users) {
    if (!u.active || !u.employeeId || !want.has(u.employeeId)) continue
    const login = u.login.trim().toLowerCase()
    if (login.includes('@')) out.push(login)
  }
  return [...new Set(out)]
}

export async function notifyEmployeesPush(
  access: AccessStore,
  employeeIds: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const emails = emailsForEmployeeIds(access, employeeIds)
  if (!emails.length) return
  const result = await sendFstPush({ emails, title, body, data })
  if (!result.ok) {
    console.warn('FST push notify failed', title)
  }
}

/** Логин-email учётки по id (для push после ответа админа на ОС). */
export function loginEmailForAccessUserId(
  access: AccessStore,
  userId: string | null | undefined,
): string | null {
  const id = userId?.trim()
  if (!id) return null
  const u = access.users.find((x) => x.id === id && x.active)
  const login = u?.login?.trim().toLowerCase() ?? ''
  return login.includes('@') ? login : null
}

export type FeedbackSenderRef = {
  userId?: string | null
  userLogin?: string | null
  userName?: string | null
}

/** Email отправителя обращения: login из записи, затем access по id / имени. */
export function resolveFeedbackSenderEmail(
  access: AccessStore,
  ref: FeedbackSenderRef,
): string | null {
  const fromLogin = ref.userLogin?.trim().toLowerCase() ?? ''
  if (fromLogin.includes('@')) return fromLogin

  const byId = loginEmailForAccessUserId(access, ref.userId)
  if (byId) return byId

  const maybeEmail = ref.userId?.trim().toLowerCase() ?? ''
  if (maybeEmail.includes('@')) {
    const u = access.users.find((x) => x.active && x.login.trim().toLowerCase() === maybeEmail)
    if (u?.login.includes('@')) return u.login.trim().toLowerCase()
    return maybeEmail
  }

  const name = ref.userName?.trim() ?? ''
  if (name && name !== '—') {
    const matches = access.users.filter(
      (x) => x.active && x.displayName.trim() === name && x.login.includes('@'),
    )
    if (matches.length === 1) return matches[0]!.login.trim().toLowerCase()
  }
  return null
}

export type FeedbackReplyNotifyResult = {
  email: string | null
  pushOk: boolean
  pushSent: number
  reason?: string
}

/** Push отправителю: админ ответил на ошибку/предложение. */
export async function notifyFeedbackReplyPush(
  access: AccessStore,
  ref: FeedbackSenderRef,
  replyPreview: string,
): Promise<FeedbackReplyNotifyResult> {
  const email = resolveFeedbackSenderEmail(access, ref)
  if (!email) {
    return { email: null, pushOk: false, pushSent: 0, reason: 'no_email' }
  }
  const body =
    replyPreview.trim().slice(0, 180) ||
    'Администратор ответил на ваше обращение. Откройте «Отчёт» → «Мои обращения».'
  const result = await sendFstPush({
    emails: [email],
    title: 'Ответ администратора',
    body,
    data: { kind: 'feedback_reply' },
  })
  if (!result.ok) {
    console.warn('FST push: feedback reply failed')
    return { email, pushOk: false, pushSent: 0, reason: 'push_failed' }
  }
  const sent = result.sent ?? 0
  return {
    email,
    pushOk: true,
    pushSent: sent,
    reason: sent > 0 ? undefined : 'no_tokens',
  }
}

export function employeeIdsInMonth(store: AppStore, month: string): string[] {
  const sheet = store.months[month]
  if (!sheet) return []
  return [...new Set(sheet.rows.map((r) => r.employeeId).filter(Boolean))] as string[]
}

export function employeeIdForRow(
  store: AppStore,
  month: string,
  rowId: string,
): string | undefined {
  const id = store.months[month]?.rows.find((r) => r.id === rowId)?.employeeId
  return id || undefined
}

/** Подтверждение / снятие больничного или отпуска. */
export function notifyAbsenceDecisionPush(
  access: AccessStore,
  employeeId: string,
  kind: 'sick' | 'vacation',
  confirmed: boolean,
  month: string,
): void {
  const sick = kind === 'sick'
  const title = confirmed
    ? sick
      ? 'Больничный подтверждён'
      : 'Отпуск подтверждён'
    : sick
      ? 'Больничный: подтверждение снято'
      : 'Отпуск: подтверждение снято'
  const body = confirmed
    ? sick
      ? 'HR или финансы подтвердили больничный. Часы учтутся как по плану. Откройте «Моё».'
      : 'HR или финансы подтвердили отпуск. Часы учтутся как по плану. Откройте «Моё».'
    : 'Подтверждение снято. Без него дни считаются как прогул. Откройте «Моё».'
  void notifyEmployeesPush(access, [employeeId], title, body, {
    kind: sick ? 'sick' : 'vacation',
    status: confirmed ? 'confirmed' : 'unconfirmed',
    month,
  })
}

/** В табеле отметили Б/ОТ — ждёт подтверждения. */
export function notifyAbsencePendingPush(
  access: AccessStore,
  employeeId: string,
  kind: 'sick' | 'vacation',
  month: string,
): void {
  const sick = kind === 'sick'
  void notifyEmployeesPush(
    access,
    [employeeId],
    sick ? 'Больничный в табеле' : 'Отпуск в табеле',
    sick
      ? 'Отмечен больничный. После подтверждения HR/финансов часы зачтутся. Откройте «Моё».'
      : 'Отмечен отпуск. После подтверждения HR/финансов часы зачтутся. Откройте «Моё».',
    { kind: sick ? 'sick' : 'vacation', status: 'pending', month },
  )
}

export type SchedulePushReason =
  | 'month_closed'
  | 'assigned'
  | 'plan_changed'
  | 'day_added'
  | 'roster'

/** Изменения графика / состава / закрытие месяца. */
export function notifySchedulePush(
  access: AccessStore,
  employeeIds: string[],
  month: string,
  reason: SchedulePushReason,
): void {
  const copy: Record<SchedulePushReason, { title: string; body: string }> = {
    month_closed: {
      title: 'Месяц закрыт',
      body: 'Табель за месяц зафиксирован. План и факт больше не меняются. Откройте «Моё».',
    },
    assigned: {
      title: 'Вас поставили в бригаду',
      body: 'Вас добавили в состав на месяц. Проверьте график в «Моё».',
    },
    plan_changed: {
      title: 'График обновлён',
      body: 'План смен пересчитан. Откройте «Моё», чтобы посмотреть дни выхода.',
    },
    day_added: {
      title: 'Смена в табеле',
      body: 'Вас поставили на смену. Откройте «Моё», чтобы посмотреть день.',
    },
    roster: {
      title: 'Состав бригады',
      body: 'Вас включили в состав бригады на месяц. Проверьте график в «Моё».',
    },
  }
  const { title, body } = copy[reason]
  void notifyEmployeesPush(access, employeeIds, title, body, {
    kind: 'schedule',
    reason,
    month,
  })
}

const PERSONAL_DAY_COPY: Record<PersonalDayKind, { title: string; body: string }> = {
  rest: {
    title: 'Выходной в табеле',
    body: 'Вам поставили выходной. Откройте «Моё», чтобы посмотреть день.',
  },
  unpaid: {
    title: 'Отпуск без сохранения',
    body: 'В табеле отмечен отпуск без сохранения. Откройте «Моё».',
  },
  idle: {
    title: 'Простой в табеле',
    body: 'Вам отметили простой. Откройте «Моё».',
  },
  violation: {
    title: 'Отметка в табеле',
    body: 'В табеле стоит отметка о нарушении. Откройте «Моё».',
  },
  night: {
    title: 'Ночная смена',
    body: 'Вас поставили на ночную смену. Откройте «Моё».',
  },
}

export function notifyPersonalDayPush(
  access: AccessStore,
  employeeId: string,
  kind: PersonalDayKind,
  month: string,
): void {
  const { title, body } = PERSONAL_DAY_COPY[kind]
  void notifyEmployeesPush(access, [employeeId], title, body, {
    kind: 'timesheet_day',
    reason: kind,
    month,
  })
}

/** Бригадир: постоянный или на день/месяц. */
export function notifyBrigadierPush(
  access: AccessStore,
  employeeId: string,
  on: boolean,
  month: string,
): void {
  void notifyEmployeesPush(
    access,
    [employeeId],
    on ? 'Вас назначили бригадиром' : 'Бригадирство снято',
    on
      ? 'Вас отметили бригадиром. Доплата и обязанности — в «Моё».'
      : 'Отметка бригадира снята. Откройте «Моё».',
    { kind: 'brigadier', status: on ? 'on' : 'off', month },
  )
}

/** Пуш человеку по коду дня (Б/ОТ — как раньше, остальные личные статусы). */
export function notifyForTimesheetCode(
  access: AccessStore,
  employeeId: string,
  month: string,
  code: DayCode,
): void {
  const kind = personalPushKind(code)
  if (!kind) return
  if (kind === 'sick' || kind === 'vacation') {
    notifyAbsencePendingPush(access, employeeId, kind, month)
    return
  }
  notifyPersonalDayPush(access, employeeId, kind, month)
}
